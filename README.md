# 红娘八字排盘

给红娘机构用的四柱排盘工具。当前：**B 档 MVP 可跑，等老师试用**。

```bash
node web/server.js   # → http://localhost:5173
```

| 文件 | 说明 |
|---|---|
| **[docs/给老师的试用说明.md](docs/给老师的试用说明.md)** | **给试用老师的一页纸**，怎么用、看什么、怎么反馈 |
| [docs/2026-09-03-红娘八字排盘-调研与MVP方案.md](docs/2026-09-03-红娘八字排盘-调研与MVP方案.md) | 调研、口径、神煞表、朱砂卷宗、实现路径 |
| [docs/2026-09-03-任务计划-B档第2步.md](docs/2026-09-03-任务计划-B档第2步.md) | 三轨并行分工、防撞规则、集成验收记录 |
| [web/](web/README.md) | 朱砂卷宗排盘页（快速录入 / 分歧风险条 / 细盘 / 老师裁定 / 对照） |
| [prototype/index.html](prototype/index.html) | UI 设计稿（可点击，朱砂卷宗） |
| [prototype/refs/wenzhen-chart.jpg](prototype/refs/wenzhen-chart.jpg) | 问真细盘截图（信息架构参考） |
| [engine/](engine/README.md) | 历法引擎：夏令时 / 真太阳时 / 子时两派 + 神煞 + 风险判据 + 审计。23 条回归 |
| [docs/reviews/](docs/reviews/) | 2026-09-03 Grok / Codex / Antigravity 三方对抗审查、交叉裁决、问真实机验证 |

## 部署 A：自有服务器（香港轻量，免备案）

面向大陆老师的主用方案——`workers.dev` 在大陆被墙，Cloudflare 免费版也不稳。
业务逻辑与 Worker 共用 `cloud/src/api.mjs`，数据库由 `cloud/src/d1-sqlite.mjs`
用 `node:sqlite` 顶替 D1（只用到 prepare / bind / first / batch 四个接口）。

需要 **Node 22+**（`node:sqlite` 内置）。

```bash
# 服务器上
git clone <repo> /srv/hongniang-bazi && cd /srv/hongniang-bazi
npm --prefix engine install      # 历法底座
npm run build                    # 生成 dist/

# 首次启动会自动建表（cloud/migrations/*.sql 逐个执行并记录）
sudo cp deploy/hongniang-bazi.service /etc/systemd/system/
sudo systemctl enable --now hongniang-bazi

# HTTPS：改掉 Caddyfile 里的域名后
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

**开一位老师**：

```bash
sudo -u www-data node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/srv/hongniang-bazi/data/hongniang-bazi.sqlite');
db.prepare(\"INSERT INTO teachers (id,name,active,created_at) VALUES ('lz-wang','王老师',1,datetime('now'))\").run();
"
# 把 https://paipan.locxai.com/?t=lz-wang 发给他
```

**备份**：整个 `data/` 目录就是全部数据，`sqlite3 ... .backup` 或直接 cp（WAL 模式下建议用前者）。

**本机跑一遍**：`npm start`（build + 起服务，默认 127.0.0.1:8080）

---

## 部署 B：Cloudflare Workers + D1

老师用的线上版：`https://paipan.dsxzai.com`。排盘仍全在浏览器里算，服务端只负责发静态资源和收数据。

```bash
npm install                      # 装 wrangler
npm --prefix engine install      # 历法底座，dist 需要它

# 首次：建库，把返回的 database_id 填进 wrangler.jsonc
npx wrangler d1 create hongniang-bazi-db
npm run db:migrate               # 建表（--remote）

npm run deploy                   # build + 发布
```

**发一位老师上线**（邀请码即身份，吊销把 active 置 0）：

```bash
npx wrangler d1 execute hongniang-bazi-db --remote --command \
  "INSERT INTO teachers (id, name, active, created_at) VALUES ('lz-wang', '王老师', 1, datetime('now'));"
# 把 https://paipan.dsxzai.com/?t=lz-wang 发给他
```

**看收上来的数据**：

```bash
npx wrangler d1 execute hongniang-bazi-db --remote --command \
  "SELECT chart_id, disputed_pillars, teacher_gan_zhi, school, reason FROM verdicts ORDER BY created_at DESC;"
```

`dist/` 由 `scripts/build.mjs` 按**白名单**组装，`docs/` 与 `engine/test/` 永远不会被发布。

---

打开原型：

```bash
open "/Users/kp/workspace/projects/八字排盘/prototype/index.html"
```
