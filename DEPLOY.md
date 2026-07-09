# Motion2WebP — 部署指南（永久公网 HTTPS，不依赖本机）

> 目标：得到一个**永久的公网 HTTPS 地址**，别人随时能访问，不受你电脑开机 / Wi-Fi / 网络切换影响。
>
> 核心思路：把这个 Node 服务丢到 **云平台** 跑，平台自带 HTTPS + 固定域名。

本项目已内置 `Dockerfile`，任何支持 Docker 的平台都能一键部署。

---

## 方案 A：Render.com（**最推荐，最省心，免费额度够用**）

Render 是国外的 PaaS，直接从 GitHub 拉代码构建，自带 HTTPS 和 `xxx.onrender.com` 固定域名。

### 步骤

1. 把项目推到 GitHub（如果还没有）：
   ```bash
   cd "/Users/kuangdaxi/Downloads/Motion To Webp"
   git init
   git add .
   git commit -m "init"
   git branch -M main
   # 到 GitHub 新建仓库 motion2webp，然后：
   git remote add origin git@github.com:<你的用户名>/motion2webp.git
   git push -u origin main
   ```

2. 打开 https://render.com → 用 GitHub 登录 → **New +** → **Web Service** → 选中 `motion2webp` 仓库。

3. 表单配置：
   - **Environment**：`Docker`（会自动识别 Dockerfile）
   - **Region**：`Singapore`（国内访问最快）
   - **Instance Type**：`Free`（512MB / 0.1 CPU，转小视频够用；付费升级更快）
   - **Health Check Path**：`/`
   - 其它默认

4. 点 **Create Web Service**，等 3~5 分钟构建完成。

5. 得到永久 HTTPS 地址：
   ```
   https://motion2webp-xxxx.onrender.com
   ```

6. 之后每次 `git push`，Render 会自动重新构建部署。

⚠️ **免费实例**特点：15 分钟没请求会休眠，下次访问需要 ~30 秒冷启动；付费 $7/月 就永远在线。

---

## 方案 B：Fly.io（**免费额度大，速度快，全球边缘**）

1. 安装 CLI：
   ```bash
   brew install flyctl
   ```

2. 登录：
   ```bash
   fly auth signup   # 或 fly auth login
   ```

3. 部署（在项目目录）：
   ```bash
   cd "/Users/kuangdaxi/Downloads/Motion To Webp"
   fly launch --now --region sin
   ```
   一路回车即可。它会读 Dockerfile 自动构建，几分钟后返回：
   ```
   https://motion2webp-xxxx.fly.dev
   ```

4. 之后更新：
   ```bash
   fly deploy
   ```

---

## 方案 C：Railway（一键、界面友好）

1. 打开 https://railway.app → GitHub 登录
2. **New Project** → **Deploy from GitHub repo** → 选中 `motion2webp`
3. 自动识别 Dockerfile → 部署完成
4. 在 **Settings → Networking → Generate Domain**，得到：
   ```
   https://motion2webp.up.railway.app
   ```

Railway 免费额度 $5/月，超出后按量计费；国内访问速度中等。

---

## 方案 D：国内云 —— 阿里云 / 腾讯云 轻量服务器（**最稳，国内快，需备案才能上 https 自定义域名**）

1. 买一台 2 核 2G 的轻量服务器（约 24 元/月）
2. SSH 上去装 Docker：
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. 上传代码后：
   ```bash
   docker build -t motion2webp .
   docker run -d --restart=always -p 80:5173 --name m2w motion2webp
   ```
4. 用服务器 IP 直接访问（HTTP）。想要 HTTPS：
   - 备案个域名，配 Nginx + Let's Encrypt，或
   - 直接套一层 Cloudflare（免费 HTTPS + CDN）。

---

## 推荐决策

| 需求 | 选 |
|---|---|
| 最省心、能接受偶尔冷启动 | **Render Free** |
| 想全球速度都快、免费额度更大 | **Fly.io** |
| 只服务国内、要求稳定低延迟 | **阿里云/腾讯云 + Cloudflare** |

---

## 部署后本地开发照旧

```bash
node server.js
# 或
docker build -t motion2webp . && docker run --rm -p 5173:5173 motion2webp
```
