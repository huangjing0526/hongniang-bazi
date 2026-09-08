// 组装 dist/：Workers 只发布这个目录。
//
// 用**白名单**而不是「排除若干目录」——本机 web/server.js 的兜底逻辑会把整个项目根目录
// 通过 HTTP 暴露出去（docs/reviews/ 里的对抗审查、对外话术红线都能直接读到）。线上不能
// 重演。新增静态资源必须显式加进下面的清单，漏加只会 404，不会意外泄露。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

/** @type {[string, string][]} [源文件相对项目根路径, dist 内目标路径] */
const FILES = [
  ['web/index.html', 'index.html'],
  ['web/app.js', 'app.js'],
  ['web/lunar-esm.js', 'lunar-esm.js'],
  ['web/components/datetime-picker.js', 'components/datetime-picker.js'],
  ['web/components/region-picker.js', 'components/region-picker.js'],
  // 历法引擎：页面用裸模块路径 import，目标路径必须与本机开发时一致，否则 importmap 失效
  ['engine/src/calendar.js', 'engine/src/calendar.js'],
  ['engine/src/chart.js', 'engine/src/chart.js'],
  ['engine/src/city.js', 'engine/src/city.js'],
  ['engine/src/contract.js', 'engine/src/contract.js'],
  ['engine/src/dst.js', 'engine/src/dst.js'],
  ['engine/src/risk.js', 'engine/src/risk.js'],
  ['engine/src/shensha.js', 'engine/src/shensha.js'],
  ['engine/src/solartime.js', 'engine/src/solartime.js'],
  ['engine/src/tables.js', 'engine/src/tables.js'],
  ['engine/data/cities.json', 'engine/data/cities.json'],
  ['engine/node_modules/lunar-javascript/lunar.js', 'engine/node_modules/lunar-javascript/lunar.js'],
];

function copyOne(from, to) {
  const src = path.join(ROOT, from);
  if (!fs.existsSync(src)) {
    throw new Error(`构建失败：缺少源文件 ${from}（engine 依赖未安装？先跑 npm --prefix engine install）`);
  }
  const dest = path.join(DIST, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return fs.statSync(dest).size;
}

fs.rmSync(DIST, { recursive: true, force: true });

let total = 0;
for (const [from, to] of FILES) total += copyOne(from, to);

console.log(`dist/ 已就绪：${FILES.length} 个文件，${(total / 1024).toFixed(0)} KB`);
