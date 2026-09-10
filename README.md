# 红娘八字排盘

给红娘机构用的四柱排盘工具。当前：**B 档 MVP（试用版）可跑，老师试用中；一期在同仓库另起目录开发。**

## 目录分工（2026-09-11 决策 D-0，见 `docs/plans/DECISIONS-wenzhen-bazi-phase-one.md`）

| 目录 | 归属 | 状态 |
|---|---|---|
| `engine/` | **共享**。历法、神煞、地支关系、干支流通、大运流年、司令 | 活跃；改契约走独立 worktree + 定向提交。标签 `trial-freeze` = 试用版基线（一期 PRD D-3） |
| `web/`、`cloud/`、`deploy/`、`data/` | **试用版**（老师在用的） | 冻结到一期上线后一个月，只修 bug（D-10） |
| `app/` | **一期前端**（账号、命例、基本排盘、命盘详解、研判记录） | 起步，见 `app/README.md` |
| `server/` | **一期服务**（邮箱验证码账号、命例归属、研判记录、试用版 JSON 导入） | 起步，见 `server/README.md` |
| `prototype/` | 设计稿（Antigravity） | 试用版与一期共用视觉体系 |
| `docs/plans/` | 一期 PRD、两份子 PRD、决策表 | 决策表只由 Claude 维护、Jing 裁定 |

```bash
node web/server.js   # → http://localhost:5173
```

| 文件 | 说明 |
|---|---|
| **[docs/给老师的试用说明.md](docs/给老师的试用说明.md)** | **给试用老师的一页纸**，怎么用、看什么、怎么反馈 |
| [docs/2026-09-03-红娘八字排盘-调研与MVP方案.md](docs/2026-09-03-红娘八字排盘-调研与MVP方案.md) | 调研、口径、神煞表、朱砂卷宗、实现路径 |
| [docs/2026-09-03-任务计划-B档第2步.md](docs/2026-09-03-任务计划-B档第2步.md) | 三轨并行分工、防撞规则、集成验收记录 |
| [web/](web/README.md) | 朱砂卷宗排盘页（快速录入 / 分歧风险条 / 细盘 / 老师裁定 / 对照） |
| [web/calendar-page.js](web/calendar-page.js) | 万年历核盘页（月历、交节时刻、十二时辰与四柱自动对照） |
| [prototype/index.html](prototype/index.html) | UI 设计稿（可点击，朱砂卷宗） |
| [prototype/refs/wenzhen-chart.jpg](prototype/refs/wenzhen-chart.jpg) | 问真细盘截图（信息架构参考） |
| [engine/](engine/README.md) | 历法引擎：夏令时 / 真太阳时 / 子时两派 + 神煞 + 风险判据 + 审计。23 条回归 |
| [docs/reviews/](docs/reviews/) | 2026-09-03 Grok / Codex / Antigravity 三方对抗审查、交叉裁决、问真实机验证 |

## 部署：自有服务器（香港轻量，免备案）

线上：`https://paipan.locxai.com`（47.76.95.3）。排盘全在浏览器里算，
服务端只负责发静态资源和收数据。数据库是 `data/` 下的一份 sqlite，由
`cloud/src/d1-sqlite.mjs` 用 `node:sqlite` 驱动。

需要 **Node 22+**（`node:sqlite` 内置）。生产机上装在 `/opt/node-v22`，
与系统 node 分开——那台机器还跑着别的服务，不能为本服务升系统 node。

> Cloudflare Workers + D1 那条备用线已于 2026-09-05 从代码库移除：
> `workers.dev` 在大陆被墙，老师根本打不开，维护两套后端只是白搭。
> 云上的 Worker 与 D1 实例暂时留着没删，但仓库里不再有它们的配置和入口。

### 首次部署

`deploy/install.sh` 在**目标服务器**上以 root 运行，从当前 bundle 目录取产物。
它只做新增（新目录、新 systemd 服务、新 nginx vhost、单独签证书），
不碰机器上已有的站点，可重复执行。

```bash
npm --prefix engine install      # 历法底座，dist 需要它
npm run build                    # 生成 dist/

rsync -a dist cloud deploy package.json root@47.76.95.3:/tmp/hongniang-bundle/
ssh root@47.76.95.3 'bash /tmp/hongniang-bundle/deploy/install.sh'
```

### 更新（改了代码之后）

服务器上**没有 git 仓库**，只放产物（`dist/` + `cloud/` + `data/`），
所以别去那边 `git pull`——推产物、重启即可。迁移在服务进程启动时自动补齐。

```bash
npm run build
rsync -a dist cloud package.json root@47.76.95.3:/srv/hongniang-bazi/   # 注意：不含 data/
ssh root@47.76.95.3 '
  chown -R nginx:nginx /srv/hongniang-bazi/dist /srv/hongniang-bazi/cloud
  systemctl restart hongniang-bazi
  journalctl -u hongniang-bazi -n 10 --no-pager'   # 看迁移有没有应用
curl -s https://paipan.locxai.com/api/health
```

### 开一位老师

默认不需要——老师自己在页面上填个称呼就能开始回传（落 `source='self'`），
`/api/register` 按 IP 哈希限流，一小时 5 个。

要手工开一位正式老师（`source='invite'`）时，邀请码即身份，吊销把 active 置 0：

```bash
sudo -u nginx /opt/node-v22/bin/node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/srv/hongniang-bazi/data/hongniang-bazi.sqlite');
db.prepare(\"INSERT INTO teachers (id,name,active,created_at,source) VALUES ('lz-wang','王老师',1,datetime('now'),'invite')\").run();
"
# 把 https://paipan.locxai.com/?t=lz-wang 发给他
```

### 看收上来的数据

裁定要和命例 join 着看才有意义（`verdicts.chart_id` 就是 `cases.id`），
`our_gan_zhi` 是当时工具排出的四柱、`options` 是当时三个开关的状态——
少了这两样，同一条裁定说不清老师认可的是哪一种排法。

```bash
sudo -u nginx /opt/node-v22/bin/node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/srv/hongniang-bazi/data/hongniang-bazi.sqlite');
console.table(db.prepare(\`
  SELECT t.name AS teacher, t.source, c.name, c.birth_at, c.city_name,
         v.disputed_pillars, v.teacher_gan_zhi, v.our_gan_zhi, v.options,
         v.time_source, v.school, v.reason, v.shensha_disputed, v.shensha_note
  FROM verdicts v
  JOIN cases c    ON c.teacher_id = v.teacher_id AND c.id = v.chart_id
  JOIN teachers t ON t.id = v.teacher_id
  ORDER BY v.created_at DESC\`).all());
"
```

> `teachers.source` 区分来路：`invite` 是我们手工开的正式老师，`self` 是页面自助登记的。
> 两者份量不同，统计时分开看，别混在一起算比例。
>
> 0002 迁移之前收上来的裁定，`our_gan_zhi` / `options` / `city_name` 为 NULL，
> 且 `chart_id` 是旧格式、join 不到命例——分析时按「口径未知」剔除。
> `shensha_disputed`（JSON 数组）/ `shensha_note` 是 0004 加的神煞表源异议，老师对
> 德秀贵人 / 福星贵人 / 学堂 / 羊刃 该用哪一派的意见就在这两列。

**备份**：整个 `data/` 目录就是全部数据，`sqlite3 ... .backup` 或直接 cp
（WAL 模式下建议用前者）。

**本机跑一遍**：`npm start`（build + 起服务，默认 127.0.0.1:8080）

---

`dist/` 由 `scripts/build.mjs` 按**白名单**组装，`docs/` 与 `engine/test/` 永远不会被发布。

---

打开原型：

```bash
open "/Users/kp/workspace/projects/八字排盘/prototype/index.html"
```
