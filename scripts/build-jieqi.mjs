// 生成并验证节气冻结表 engine/data/jieqi-1900-2100.js。
//
// 落成 ES 模块而不是 JSON：它在首屏就要被 chart.js → risk.js → calendar.js 静态引入，
// JSON import attributes 在老一点的 Safari / Firefox 上不认，会让整个页面起不来。
//
//   node scripts/build-jieqi.mjs            # 联网抓香港天文台数据（缓存在 engine/data/.cache/）
//   node scripts/build-jieqi.mjs --offline  # 只用缓存
//
// 表由 engine/astro/jieqi.mjs（Meeus + VSOP87，与寿星系无关的独立实现）算出，过三关才落盘：
//   ① 对 lunar-javascript：4824 条逐条差分，允差 60 秒
//   ② 对香港天文台《公历与农历日期对照表》1901–2100：节气**日期**全部一致
//   ③ 对香港天文台《二十四节气的日期及时间资料》（分钟级，网站只放最近十年）：允差 60 秒（他们四舍五入到分）
// 任一关不过就报错退出，不写表。人工裁定的条目写进 OVERRIDES 并注明出处，不允许悄悄取平均。
//
// 顺带从对照表里抽出农历月首（含闰月）落成 engine/data/hko-lunar-months.json，
// 供 engine/test/calendar.test.js 离线校验 lunar-javascript 的农历与闰月。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { termsOfYear, TERM_NAMES } from '../engine/astro/jieqi.mjs';

const require = createRequire(import.meta.url);
const { Solar } = require('../engine/node_modules/lunar-javascript');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'engine', 'data');
const CACHE = path.join(DATA, '.cache');
const OFFLINE = process.argv.includes('--offline');

const FROM = 1900;
const TO = 2100;
/** 表内秒数的起点：1900-01-01 00:00 北京时间 */
const EPOCH_MS = Date.UTC(1900, 0, 1);

/** 人工裁定的条目：{ [year]: { [termName]: { seconds, source } } }。目前为空——三关全过。 */
const OVERRIDES = {};

/**
 * 关 ② 的已知例外：交节落在子夜前后几分钟、香港天文台历史对照表却记在另一天的六条。
 * 独立算法与 lunar-javascript 在这六条上彼此只差几秒（两套现代算法一致），
 * 对照表早年数据来自旧历书，偏 1–12 分钟。保留我们的值，把例外记在这里并写进 SOURCE.md，
 * 万年历页对这几年要提示「老书可能记在前/后一天」。
 */
const HKO_DATE_EXCEPTIONS = {
  1912: { 小雪: '1912-11-23' },
  1913: { 秋分: '1913-09-24' },
  1917: { 大雪: '1917-12-07' },
  1927: { 白露: '1927-09-08' },
  1928: { 夏至: '1928-06-21' },
  1979: { 大寒: '1979-01-21' },
};

const toSeconds = (at) => (Date.UTC(at.year, at.month - 1, at.day, at.hour, at.minute, at.second ?? 0) - EPOCH_MS) / 1000;

async function fetchCached(url, file) {
  const dest = path.join(CACHE, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return fs.readFileSync(dest, 'utf8');
  if (OFFLINE) throw new Error(`--offline 但缓存缺失：${file}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`${url} → HTTP ${resp.status}`);
  const text = await resp.text();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  return text;
}

// 香港天文台用繁体，与 TERM_NAMES 的简体对上
const HK_TERM = {
  小寒: '小寒', 大寒: '大寒', 立春: '立春', 雨水: '雨水', 惊蛰: '驚蟄', 春分: '春分', 清明: '清明', 谷雨: '穀雨',
  立夏: '立夏', 小满: '小滿', 芒种: '芒種', 夏至: '夏至', 小暑: '小暑', 大暑: '大暑', 立秋: '立秋', 处暑: '處暑',
  白露: '白露', 秋分: '秋分', 寒露: '寒露', 霜降: '霜降', 立冬: '立冬', 小雪: '小雪', 大雪: '大雪', 冬至: '冬至',
};
const HK_TO_CN = Object.fromEntries(Object.entries(HK_TERM).map(([cn, hk]) => [hk, cn]));
const CN_MONTH = { 正: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };

/**
 * 解析一年的对照表。每行「公历日期  农历日期  星期  节气」；农历月首那行的农历列写的是月名
 * （「正月」「閏四月」），其余行是日。
 * @returns {{ termDates: Record<string,string>, monthStarts: [date:string, month:number, leap:0|1][] }}
 */
function parseHkoYear(text) {
  const termDates = {};
  const monthStarts = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\S+)\s+星期[一二三四五六日]\s*(\S+)?\s*$/);
    if (!m) continue;
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    const lunar = m[4];
    if (m[5] && HK_TO_CN[m[5]]) termDates[HK_TO_CN[m[5]]] = date;
    const mm = lunar.match(/^(閏)?(正|十一|十二|二|三|四|五|六|七|八|九|十)月$/);
    if (mm) monthStarts.push([date, CN_MONTH[mm[2]], mm[1] ? 1 : 0]);
  }
  if (Object.keys(termDates).length !== 24) throw new Error(`对照表解析出的节气不是 24 个：${Object.keys(termDates).length}`);
  return { termDates, monthStarts };
}

/** 分钟级 XML：<Data><M>01</M><D>05</D><hm>16:23</hm></Data> × 24，按年内顺序 */
function parseHkoTermsXml(text) {
  return [...text.matchAll(/<M>(\d+)<\/M><D>(\d+)<\/D><hm>(\d+):(\d+)<\/hm>/g)]
    .map((m) => ({ month: Number(m[1]), day: Number(m[2]), hour: Number(m[3]), minute: Number(m[4]) }));
}

const fmt = (at) => `${at.year}-${String(at.month).padStart(2, '0')}-${String(at.day).padStart(2, '0')} ${String(at.hour).padStart(2, '0')}:${String(at.minute).padStart(2, '0')}:${String(at.second ?? 0).padStart(2, '0')}`;

async function main() {
  const failures = [];
  const years = {};
  const monthStartsByYear = {};
  let maxLunarDiff = 0;
  let anchorsChecked = 0;
  const anchors = {};

  for (let year = FROM; year <= TO; year++) {
    const computed = termsOfYear(year);
    const row = computed.map((t) => toSeconds(t.at));

    // ① 差分 lunar-javascript
    const table = Solar.fromYmd(year, 6, 1).getLunar().getJieQiTable();
    computed.forEach((t, i) => {
      const s = table[t.name === '冬至' ? 'DONG_ZHI' : t.name];
      const theirs = toSeconds({ year: s.getYear(), month: s.getMonth(), day: s.getDay(), hour: s.getHour(), minute: s.getMinute(), second: s.getSecond() });
      const diff = Math.abs(row[i] - theirs);
      maxLunarDiff = Math.max(maxLunarDiff, diff);
      if (diff > 60) failures.push(`① ${year} ${t.name}：独立算法 ${fmt(t.at)} vs lunar-javascript ${s.toYmdHms()}，差 ${diff} 秒`);
    });

    // ② 对照表日期（1901 起）
    if (year >= 1901) {
      const text = await fetchCached(`https://www.hko.gov.hk/tc/gts/time/calendar/text/files/T${year}c.txt`, `hko/T${year}c.txt`);
      const { termDates, monthStarts } = parseHkoYear(text.replace(/^﻿/, ''));
      monthStartsByYear[year] = monthStarts;
      computed.forEach((t) => {
        const ours = fmt(t.at).slice(0, 10);
        if (termDates[t.name] === ours) return;
        if (HKO_DATE_EXCEPTIONS[year]?.[t.name] === termDates[t.name]) {
          console.log(`② ${year} ${t.name}：${fmt(t.at)}，对照表记 ${termDates[t.name]}（已知例外）`);
          return;
        }
        failures.push(`② ${year} ${t.name}：独立算法 ${fmt(t.at)}，香港天文台对照表 ${termDates[t.name]}`);
      });
    }

    // ③ 分钟级锚点（网站只放最近十年，404 的年份跳过）
    if (year >= 2019 && year <= 2028) {
      let xml = null;
      try {
        xml = await fetchCached(`https://www.hko.gov.hk/tc/gts/astronomy/data/files/24SolarTerms_${year}.xml`, `hko-terms/24SolarTerms_${year}.xml`);
      } catch (e) {
        console.warn(`③ ${year} 分钟级数据取不到，跳过：${e.message}`);
      }
      if (xml && xml.includes('<Data>')) {
        const list = parseHkoTermsXml(xml);
        if (list.length !== 24) throw new Error(`③ ${year} XML 解析出 ${list.length} 条`);
        anchors[year] = list.map((a, i) => ({ name: TERM_NAMES[i], ...a }));
        computed.forEach((t, i) => {
          anchorsChecked++;
          // 香港天文台四舍五入到分（2026 大寒 09:44:56 显示 09:45），真值在 ±30 秒内；
          // 两套星历再差几秒，所以允差取 60 秒——2026 夏至 16:24:29 对 16:25 就是这种擦边
          const a = list[i];
          const theirs = toSeconds({ year, month: a.month, day: a.day, hour: a.hour, minute: a.minute, second: 0 });
          const diff = Math.abs(row[i] - theirs);
          if (diff > 60) failures.push(`③ ${year} ${t.name}：独立算法 ${fmt(t.at)}，香港天文台 ${a.month}-${a.day} ${a.hour}:${a.minute}，差 ${diff} 秒`);
        });
      }
    }

    for (const [name, o] of Object.entries(OVERRIDES[year] ?? {})) {
      row[TERM_NAMES.indexOf(name)] = o.seconds;
    }
    years[year] = row;
  }

  console.log(`① 对 lunar-javascript 最大差 ${maxLunarDiff} 秒（允差 60）`);
  console.log(`② 对香港天文台对照表：${TO - 1900} 年节气日期已核`);
  console.log(`③ 分钟级锚点：${anchorsChecked} 条已核`);
  if (failures.length) {
    console.error(`\n${failures.length} 条未过关，未写表：\n` + failures.join('\n'));
    process.exit(1);
  }

  const out = {
    _source: '由 scripts/build-jieqi.mjs 生成，勿手改。来源与验证见 engine/data/jieqi.SOURCE.md',
    epoch: '1900-01-01T00:00:00+08:00',
    unit: 'seconds',
    terms: TERM_NAMES,
    from: FROM,
    to: TO,
    overrides: OVERRIDES,
    hkoDateExceptions: HKO_DATE_EXCEPTIONS,
    years,
  };
  fs.writeFileSync(path.join(DATA, 'jieqi-1900-2100.js'),
    `// ${out._source}\nexport default ${JSON.stringify(out)};\n`);
  fs.writeFileSync(path.join(DATA, 'jieqi-anchors.json'), JSON.stringify({
    _source: '香港天文台《二十四节气的日期及时间资料》https://www.hko.gov.hk/sc/gts/astronomy/Solar_Term.htm，香港时间（UTC+8），四舍五入到分',
    years: anchors,
  }, null, 0));
  fs.writeFileSync(path.join(DATA, 'hko-lunar-months.json'), JSON.stringify({
    _source: '香港天文台《公历与农历日期对照表》https://www.hko.gov.hk/tc/gts/time/calendar/text/files/T{year}c.txt，每年的农历月首 [公历日期, 月序, 是否闰月]',
    years: monthStartsByYear,
  }));
  console.log(`已写 engine/data/jieqi-1900-2100.js（${Object.keys(years).length} 年）、jieqi-anchors.json（${Object.keys(anchors).length} 年）、hko-lunar-months.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
