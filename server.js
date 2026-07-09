const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const { spawn } = require('child_process');
const archiver = require('archiver');
const unzipper = require('unzipper');
const crypto = require('crypto');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 5173;

const WORK_DIR = path.join(os.tmpdir(), 'motion2webp');
fs.mkdirSync(WORK_DIR, { recursive: true });

// In-memory job store
const jobs = new Map();

const upload = multer({
  dest: path.join(WORK_DIR, 'uploads'),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2GB per file
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function sanitizeName(name) {
  const base = path.basename(name).replace(/\.[^.]+$/, '');
  return base.replace(/[^\w\u4e00-\u9fa5\-. ]+/g, '_').replace(/\s+/g, '_') || 'file';
}

const VIDEO_EXTS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.gif'];

async function collectVideos(files, jobDir) {
  // files: array of { originalname, path }
  const videos = []; // { name, path }
  for (const f of files) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (ext === '.zip') {
      const extractDir = path.join(jobDir, 'extracted_' + crypto.randomBytes(4).toString('hex'));
      await fsp.mkdir(extractDir, { recursive: true });
      await fs.createReadStream(f.path).pipe(unzipper.Extract({ path: extractDir })).promise();
      await walkVideos(extractDir, videos);
    } else if (VIDEO_EXTS.includes(ext)) {
      videos.push({ name: f.originalname, path: f.path });
    }
  }
  return videos;
}

async function walkVideos(dir, out) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkVideos(full, out);
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (VIDEO_EXTS.includes(ext)) out.push({ name: entry.name, path: full });
    }
  }
}

function ffprobeDuration(input) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', input]);
    let out = '';
    p.stdout.on('data', d => out += d);
    p.on('close', () => resolve(parseFloat(out.trim()) || 0));
    p.on('error', () => resolve(0));
  });
}

const MAX_OUTPUT_BYTES = 100 * 1024 * 1024; // 100MB target ceiling

function ffprobeInfo(input) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'default=noprint_wrappers=1', input]);
    let out = '';
    p.stdout.on('data', d => out += d);
    p.on('close', () => {
      const info = { width: 0, height: 0, duration: 0 };
      out.split('\n').forEach(line => {
        const [k, v] = line.split('=');
        if (k === 'width') info.width = parseInt(v, 10) || 0;
        else if (k === 'height') info.height = parseInt(v, 10) || 0;
        else if (k === 'duration') info.duration = parseFloat(v) || 0;
      });
      resolve(info);
    });
    p.on('error', () => resolve({ width: 0, height: 0, duration: 0 }));
  });
}

function convertToWebP(input, output, opts, onProgress, onProc) {
  return new Promise((resolve, reject) => {
    const fps = opts.fps || 30;
    const quality = opts.quality != null ? opts.quality : 80;
    const vfParts = [`fps=${fps}`];
    if (opts.resize) vfParts.push(`scale=${opts.resize}:-2:flags=lanczos`);
    else if (opts.maxWidth) vfParts.push(`scale='min(${opts.maxWidth},iw)':-2:flags=lanczos`);
    const args = [
      '-y',
      '-i', input,
      '-vcodec', 'libwebp',
      '-vf', vfParts.join(','),
      '-lossless', opts.lossless ? '1' : '0',
      '-compression_level', '6',
      '-q:v', String(quality),
      '-loop', '0',
      '-preset', 'picture',
      '-an',
      '-progress', 'pipe:2',
      output
    ];
    const p = spawn('ffmpeg', args);
    if (onProc) onProc(p);
    let stderr = '';
    p.stderr.on('data', chunk => {
      const s = chunk.toString();
      stderr += s;
      const m = s.match(/out_time_ms=(\d+)/);
      if (m && onProgress) onProgress(parseInt(m[1], 10) / 1e6);
    });
    p.on('close', code => {
      if (code === 0) resolve();
      else if (p._abortedByUser) resolve({ aborted: true });
      else reject(new Error('ffmpeg exited with ' + code + '\n' + stderr.slice(-500)));
    });
    p.on('error', reject);
  });
}

app.post('/api/convert', upload.array('files'), async (req, res) => {
  try {
    const jobId = crypto.randomBytes(8).toString('hex');
    const jobDir = path.join(WORK_DIR, jobId);
    const outDir = path.join(jobDir, 'output');
    await fsp.mkdir(outDir, { recursive: true });

    const opts = {
      fps: parseInt(req.body.fps || '30', 10),
      quality: parseInt(req.body.quality || '80', 10),
      resize: req.body.resize ? parseInt(req.body.resize, 10) : null,
      lossless: req.body.lossless === 'true' || req.body.lossless === '1'
    };

    const videos = await collectVideos(req.files, jobDir);

    const items = videos.map(v => ({
      name: v.name,
      outName: sanitizeName(v.name) + '.webp',
      status: 'pending', // pending | running | done | failed | paused | canceled
      progress: 0,
      size: 0,
      error: null,
      warning: null,
      paused: false,
      canceled: false,
      _path: v.path,
      _proc: null
    }));

    const job = {
      id: jobId,
      dir: jobDir,
      outDir,
      total: videos.length,
      done: 0,
      failed: 0,
      currentIndex: -1,
      startTime: Date.now(),
      status: 'running',
      items,
      opts
    };
    jobs.set(jobId, job);

    res.json({ jobId, total: videos.length });

    // Async processing
    (async () => {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        job.currentIndex = i;
        if (it.canceled) { it.status = 'canceled'; job.done++; continue; }
        // Wait if paused (via pauseAll)
        while (job.pausedAll || it.paused) {
          if (it.canceled) break;
          await new Promise(r => setTimeout(r, 200));
        }
        if (it.canceled) { it.status = 'canceled'; job.done++; continue; }
        it.status = 'running';
        it.progress = 0;
        const duration = await ffprobeDuration(it._path);
        const outPath = path.join(outDir, it.outName);
        try {
          const info = await ffprobeInfo(it._path);
          const baseFps = job.opts.fps || 30;
          const baseQ = job.opts.quality != null ? job.opts.quality : 80;
          const baseW = info.width || 0;
          const attempts = [
            { fps: baseFps, quality: baseQ, maxWidth: null },
            { fps: Math.max(20, baseFps - 5), quality: Math.max(55, baseQ - 15), maxWidth: baseW ? Math.min(baseW, 1600) : 1600 },
            { fps: 18, quality: 45, maxWidth: 1280 },
            { fps: 15, quality: 35, maxWidth: 960 }
          ];
          let finalSize = 0;
          let lastErr = null;
          let aborted = false;
          for (let a = 0; a < attempts.length; a++) {
            if (it.canceled) { aborted = true; break; }
            const at = attempts[a];
            const passOpts = { ...job.opts, fps: at.fps, quality: at.quality, maxWidth: at.maxWidth, resize: at.maxWidth ? null : job.opts.resize };
            try {
              const r = await convertToWebP(it._path, outPath, passOpts, (t) => {
                const base = a / attempts.length;
                const cur = duration ? Math.min(1, t / duration) : 0;
                it.progress = Math.min(1, base + cur / attempts.length);
              }, (proc) => {
                it._proc = proc;
                if (it.paused || job.pausedAll) { try { proc.kill('SIGSTOP'); } catch(e){} }
              });
              if (r && r.aborted) { aborted = true; break; }
            } catch (e) {
              lastErr = e;
              continue;
            }
            const stat = await fsp.stat(outPath);
            finalSize = stat.size;
            if (finalSize <= MAX_OUTPUT_BYTES) break;
          }
          it._proc = null;
          if (aborted || it.canceled) {
            it.status = 'canceled';
            try { await fsp.unlink(outPath); } catch(e){}
          } else {
            if (finalSize === 0 && lastErr) throw lastErr;
            it.size = finalSize;
            it.status = 'done';
            it.progress = 1;
            if (finalSize > MAX_OUTPUT_BYTES) {
              it.warning = `已尽量压缩，仍为 ${(finalSize/1024/1024).toFixed(1)}MB`;
            }
          }
        } catch (e) {
          it._proc = null;
          it.status = 'failed';
          it.error = e.message;
          job.failed++;
        }
        job.done++;
      }
      job.status = 'done';
      job.currentIndex = -1;
    })().catch(err => {
      job.status = 'error';
      job.error = err.message;
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  const elapsed = (Date.now() - job.startTime) / 1000;
  const currentItem = job.currentIndex >= 0 ? job.items[job.currentIndex] : null;
  const currentProgress = currentItem ? (currentItem.progress || 0) : 0;
  // progress in units of "items". Includes fractional progress of current running item.
  const effectiveDone = job.done + currentProgress;
  let eta = 0;
  if (job.status === 'done') {
    eta = 0;
  } else if (effectiveDone > 0.01) {
    const perUnit = elapsed / effectiveDone;
    const remaining = Math.max(0, job.total - effectiveDone);
    eta = perUnit * remaining;
  } else if (elapsed > 2 && job.total > 0) {
    // Rough fallback: assume ~10s/file until we have a real sample
    eta = 10 * job.total;
  }
  res.json({
    id: job.id,
    total: job.total,
    done: job.done,
    failed: job.failed,
    current: currentItem ? currentItem.name : '',
    currentProgress,
    status: job.status,
    elapsed,
    eta,
    items: job.items.map(({ _path, ...rest }) => rest)
  });
});

app.post('/api/control/:id', express.json(), (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  const { action, index } = req.body || {};
  // Batch-level actions
  if (index == null || index === -1) {
    if (action === 'pause') {
      job.pausedAll = true;
      for (const it of job.items) {
        if (it.status === 'running' && it._proc) {
          try { it._proc.kill('SIGSTOP'); } catch(e){}
        }
      }
    } else if (action === 'resume') {
      job.pausedAll = false;
      for (const it of job.items) {
        if (it.status === 'running' && it._proc && !it.paused) {
          try { it._proc.kill('SIGCONT'); } catch(e){}
        }
      }
    } else if (action === 'cancel') {
      for (const it of job.items) {
        if (it.status === 'pending' || it.status === 'running' || it.status === 'paused') {
          it.canceled = true;
          if (it._proc) {
            try { it._proc._abortedByUser = true; it._proc.kill('SIGCONT'); } catch(e){}
            try { it._proc.kill('SIGKILL'); } catch(e){}
          }
        }
      }
    }
    return res.json({ ok: true });
  }
  // Item-level actions
  const it = job.items[index];
  if (!it) return res.status(404).json({ error: 'item not found' });
  if (action === 'pause') {
    it.paused = true;
    if (it.status === 'running' && it._proc) {
      try { it._proc.kill('SIGSTOP'); } catch(e){}
      it.status = 'paused';
    }
  } else if (action === 'resume') {
    it.paused = false;
    if (it.status === 'paused' && it._proc) {
      try { it._proc.kill('SIGCONT'); } catch(e){}
      it.status = 'running';
    }
  } else if (action === 'cancel') {
    if (it.status === 'pending' || it.status === 'running' || it.status === 'paused') {
      it.canceled = true;
      if (it._proc) {
        try { it._proc._abortedByUser = true; it._proc.kill('SIGCONT'); } catch(e){}
        try { it._proc.kill('SIGKILL'); } catch(e){}
      }
    }
  }
  res.json({ ok: true });
});

app.get('/api/download/:id/:name', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).send('not found');
  const file = path.join(job.outDir, path.basename(req.params.name));
  if (!fs.existsSync(file)) return res.status(404).send('not found');
  res.download(file);
});

app.get('/api/download-all/:id', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).send('not found');
  res.attachment(`motion2webp_${job.id}.zip`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);
  const files = await fsp.readdir(job.outDir);
  for (const f of files) {
    archive.file(path.join(job.outDir, f), { name: f });
  }
  archive.finalize();
});

function getLanIps() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nMotion2WebP running:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const ip of getLanIps()) {
    console.log(`  Network: http://${ip}:${PORT}`);
  }
  console.log(`\nShare the Network URL with others on the same Wi-Fi/LAN.\n`);
});
