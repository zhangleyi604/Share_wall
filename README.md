# 🧱 一起贴贴 · 实时协作墙

一个可以发给朋友互动玩的前端小项目：进同一个**房间链接**，大家一起实时贴便签、在共享画板上手绘、拖动、换颜色。顶部显示在线人数，一键复制房间链接甩群里。

技术栈：Node.js + `ws`（WebSocket）做后端房间同步，纯 HTML/CSS/JS 做前端，零框架。

---

## 本地跑起来

```bash
cd shared-wall
npm install      # 只依赖一个 ws
npm start        # 默认 http://localhost:3000
```

打开两个浏览器标签，都进同一个房间号，在一个里贴便签 / 画画，另一个会实时出现。

---

## 部署上线（发给朋友玩）

协作墙需要后端在线才能同步，部署到公网服务后把房间链接发朋友。

### 推荐：GitHub + Railway（免费、长期公网、自动识别 Node）
1. 把 `shared-wall` 推到 GitHub 仓库（已 `git init` 并提交，`.gitignore` 已排除 `node_modules`）。
2. 去 [Railway](https://railway.app) 用 GitHub 登录 → New Project → Deploy a GitHub repo → 选这个仓库。
3. Railway 会自动 `npm install` + `npm start`，并注入 `PORT`（代码已兼容，无需改动）。
4. 部署完成拿到域名，打开 `https://你的域名/?room=派对之夜`，把链接发朋友。
   - 改房间号即可开不同房间，多人进同一房间号就在一起玩。

### 备选：Render
步骤同上，在 [Render](https://render.com) 新建 Web Service 连 GitHub 仓库即可，Build 用 `npm install`、Start 用 `npm start`。

### 备选：WorkBuddy 一键发布
本工具「发布为应用」也能发（首次发布需后端域名绑定正常）。

---

## 玩法说明（给用户看）

- 打开链接 → 填昵称 + 房间号 → 进入。
- 「＋ 贴便签」新建一张；**双击便签写字**、**拖顶部条移动**、点左下角小圆点**换颜色**、点 × **删除**。
- 墙底层是**共享画板**：左下角工具条选颜色 / 粗细 / 橡皮随手画，笔画实时同步给所有人；「清画板」只清画板、不影响便签。
- 顶部「复制房间链接」把当前房间发给朋友，Ta 进来就能一起贴 + 画。
- 房间空了便签和画板都会保留，下次进还能看到。

---

## 文件结构

```
shared-wall/
├── package.json
├── server.js          # HTTP 静态托管 + WebSocket 房间同步 + 画板笔画同步
├── public/
│   ├── index.html     # 进入面板 + 墙界面 + 画板工具条
│   ├── style.css
│   └── app.js         # 实时同步、拖拽、编辑、手绘逻辑
└── README.md
```

## 可扩展方向

- 许愿池 / 留言墙模式
- 房间密码、便签点赞、@提醒
- 便签 / 画板内容持久化（接数据库，重启不丢）
