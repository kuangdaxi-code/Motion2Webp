# Motion2WebP

零配置的 WebP 批量转换工具。拖入视频（mp4 / mov / webm / gif / …）或 ZIP，一键批量转成 WebP 动图，自动下载。

- 🎯 零配置：默认参数已针对设计周报 / 竞品分析 / 开眼周刊等场景调优
- 🗜 自动压缩：多轮 pass 保证输出 ≤ 100MB
- ⏸ 单文件级：暂停 / 继续 / 取消
- 📥 完成后自动下载，多文件自动打包 ZIP
- 🎨 Apple HIG 风格 UI，支持深/浅色

## 本地运行

```bash
# 依赖：node 18+ 和 ffmpeg
brew install ffmpeg
npm install
node server.js
# 打开 http://localhost:5173
```

## Docker 运行

```bash
docker build -t motion2webp .
docker run --rm -p 5173:5173 motion2webp
```

## 部署到公网

见 [`DEPLOY.md`](./DEPLOY.md)，支持 Render / Fly.io / Railway / 云服务器多种方案。

推荐 **Render**：连接 GitHub 后每次 `git push` 自动更新。

## 更新样式

修改 `public/index.html` → `git push` → Render 自动重新构建并部署（约 3 分钟）。

## License

MIT
