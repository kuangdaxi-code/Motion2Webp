# 推送到 GitHub — 三步走

本地仓库已经初始化完毕，只差最后推到 GitHub。

## 1. 在 GitHub 创建仓库

打开 https://github.com/new，填：

- **Repository name**: `motion2webp`（随意）
- **Description**: `零配置的 WebP 批量转换工具`
- **Public / Private**: 都行
- ⚠️ **不要勾选** "Add a README file"、"Add .gitignore"、"Add license"（本地已经有了）

点 **Create repository**。

## 2. 复制新仓库 URL

创建后 GitHub 会显示两行 remote 命令，复制 URL：

- HTTPS: `https://github.com/<你的用户名>/motion2webp.git`
- SSH:   `git@github.com:<你的用户名>/motion2webp.git`

（推荐 SSH，如果没配 SSH key 就用 HTTPS，推送时输入 token 即可）

## 3. 在项目目录执行

```bash
cd "/Users/kuangdaxi/Downloads/Motion To Webp"

# 用 SSH：
git remote add origin git@github.com:<你的用户名>/motion2webp.git

# 或 HTTPS：
# git remote add origin https://github.com/<你的用户名>/motion2webp.git

git push -u origin main
```

推送后打开 GitHub 仓库主页，应该能看到全部文件。

---

## 之后如何更新样式

```bash
# 1. 改 public/index.html 或其它文件
# 2. 提交推送
git add .
git commit -m "feat: 调整样式"
git push
```

如果已经在 Render / Fly.io 上部署了，push 后会**自动重新构建部署**，几分钟后公网地址就是新版本。

---

## GitHub Actions（已自动包含）

- `.github/workflows/build.yml`  — 每次 push / PR 自动验证 Dockerfile 能否构建成功
- `.github/workflows/deploy-fly.yml` — 每次 push 自动部署到 Fly.io（**需要先在 GitHub 仓库 Settings → Secrets 里添加 `FLY_API_TOKEN`**）

不用 Fly.io 的话，`deploy-fly.yml` 可以删掉。

## 邮箱建议

首次 commit 用了本地占位邮箱 `you@local`。如果想改成你 GitHub 上的邮箱：

```bash
git config user.email "your@github.com"
git config user.name "Your Name"
# 修正最后一次 commit 的作者信息
git commit --amend --reset-author --no-edit
```
