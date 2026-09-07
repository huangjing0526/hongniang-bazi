// scripts/build-cities.mjs
// 重建 engine/data/cities.json：名录以民政部行政区划代码表为准，坐标按三级取源。
//
// 为什么不直接用 GeoNames 的 ADM 层：它只有 2938 个县级条目且明显过时——
// 民政部 2023 年表有 2842 个县级单位，其中 545 个在 GeoNames ADM3 里找不到
// （123 个是撤县设区没跟上，422 个整条没有，红谷滩区就在里面），抽出来的名字还混着
// 日文省名、拼错层级的条目。地名录不是区划主数据，名录得另找权威源。
//
// 坐标来源（依次回退，命中即止）：
//   1. GeoNames ADM3 同名（同省，优先同地级市）
//   2. GeoNames 同名的乡镇 / 居民点（ADM4 / PPLA* / PPL），同省且离地级市不远
//   3. Wikidata 同名条目（CC0），同样要求离地级市不远
//   4. 都没有 → 用地级市坐标并标 approx: true，界面上会提示「坐标待补」
//
// 用法：node scripts/build-cities.mjs [--offline]
//   输入缓存在 engine/data/.cache/（不入库）：CN.txt（GeoNames）、mca.html（民政部）、wikidata.json。
//   --offline 时缺什么就报错，不联网。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { SUFFIX } from '../engine/src/city.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'engine', 'data', '.cache');
const OUT = path.join(ROOT, 'engine', 'data', 'cities.json');
const OFFLINE = process.argv.includes('--offline');

const GEONAMES_URL = 'https://download.geonames.org/export/dump/CN.zip';
// 民政部「中华人民共和国行政区划代码」，按年更新；换年份时把这一行和 SOURCE.md 一起改
const MCA_URL = 'https://www.mca.gov.cn/mzsj/xzqh/2023/202301xzqh.html';
const MCA_YEAR = '2023';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const UA = 'hongniang-bazi-build/0.1 (https://paipan.locxai.com)';

fs.mkdirSync(CACHE, { recursive: true });

async function fetchToFile(url, file, { binary = false } = {}) {
  if (fs.existsSync(file)) return;
  if (OFFLINE) throw new Error(`--offline 但缓存缺失：${file}`);
  console.log(`下载 ${url}`);
  const resp = await fetch(url, { headers: { 'user-agent': UA } });
  if (!resp.ok) throw new Error(`下载失败 ${url}: HTTP ${resp.status}`);
  fs.writeFileSync(file, binary ? Buffer.from(await resp.arrayBuffer()) : await resp.text());
}

// ---------------------------------------------------------------------------
// 1. 民政部名录
// ---------------------------------------------------------------------------

const MUNICIPALITIES = new Set(['11', '12', '31', '50']);
// 港澳台不在 GeoNames 的 CN 包里，本版不收
const SKIP_PROV = new Set(['71', '81', '82']);

function parseMca(html) {
  const cells = [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;| /g, ' ').trim());
  const rows = [];
  for (let i = 0; i < cells.length - 1; i++) {
    if (/^\d{6}$/.test(cells[i]) && cells[i + 1] && !/^\d{6}$/.test(cells[i + 1])) {
      // 表里省直辖的县级市带 * 号
      rows.push({ code: cells[i], name: cells[i + 1].replace(/\*+$/, '') });
    }
  }
  return rows;
}

/** 名录 → 三层结构。返回 [{ level, code, name(展示名), prov, pref, county }] */
function buildRegistry(rows) {
  const prov = new Map();
  const pref = new Map();
  for (const r of rows) {
    if (r.code.endsWith('0000')) prov.set(r.code.slice(0, 2), r.name);
    else if (r.code.endsWith('00')) pref.set(r.code.slice(0, 4), r.name);
  }
  const entries = [];
  for (const r of rows) {
    const p = r.code.slice(0, 2);
    if (SKIP_PROV.has(p)) continue;
    const provName = prov.get(p);
    if (r.code.endsWith('0000')) {
      entries.push({ level: 1, name: provName, prov: provName });
    } else if (r.code.endsWith('00')) {
      entries.push({ level: 2, name: `${provName} ${r.name}`, prov: provName, pref: r.name });
    } else {
      const prefName = MUNICIPALITIES.has(p) ? provName : pref.get(r.code.slice(0, 4));
      // 直辖市：「北京市 北京市 东城区」（沿用旧数据的写法，老师存的命例里就是这样）；
      // 省直辖县级：「湖北省 仙桃市」
      const name = prefName ? `${provName} ${prefName} ${r.name}` : `${provName} ${r.name}`;
      entries.push({ level: 3, name, prov: provName, pref: prefName ?? null, county: r.name });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// 2. GeoNames 索引
// ---------------------------------------------------------------------------

const stem = (n) => n.replace(SUFFIX, '') || n;
const isZh = (s) => /[一-鿿]/.test(s);

function loadGeoNames(file) {
  const byName = new Map();   // 中文名 → [{fcode, a1, lat, lng}]
  const byStem = new Map();   // 词干 → 带后缀的中文名列表（找撤县设区的旧名用）
  const adm1 = new Map();     // admin1 code → 中文名列表
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split('\n')) {
    const c = line.split('\t');
    if (c.length < 13) continue;
    const [, , , alts, lat, lng, fclass, fcode, , , a1] = c;
    if (fclass !== 'A' && fclass !== 'P') continue;
    const names = alts.split(',').filter(isZh);
    if (!names.length) continue;
    const rec = { fcode, a1, lat: Number(lat), lng: Number(lng) };
    for (const n of new Set(names)) {
      if (!byName.has(n)) {
        byName.set(n, []);
        if (SUFFIX.test(n)) {
          if (!byStem.has(stem(n))) byStem.set(stem(n), []);
          byStem.get(stem(n)).push(n);
        }
      }
      byName.get(n).push(rec);
    }
    if (fcode === 'ADM1') adm1.set(a1, names);
  }
  return { byName, byStem, adm1 };
}

const dist = (a, b) => Math.hypot(a.lng - b.lng, a.lat - b.lat);
/**
 * 「离本地级市不远」的半径（度）。东部 2.5°（约 200km）够用；
 * 西部的地级市/自治州动辄横跨 6–8°（敦煌离酒泉质心 4°，库尔勒离巴州质心更远），
 * 用东部的尺子会把真条目当成同名的别处扔掉。参照点是省级时再放宽。
 */
const WIDE_PROVINCES = new Set(['内蒙古自治区', '黑龙江省']);   // 呼伦贝尔、锡林郭勒盟东西跨 8°
function nearRadius(near) {
  if (!near) return Infinity;
  if (near.level === 1) return 8;
  return near.lng < 105 || WIDE_PROVINCES.has(near.prov) ? 6 : 2.5;
}
const isNear = (rec, near) => !near || dist(rec, near) <= nearRadius(near);

// 取坐标的优先级：行政区 > 驻地 > 普通居民点
const FCODE_RANK = { ADM1: 0, ADM2: 0, ADM3: 0, ADM4: 1, PPLA: 2, PPLA2: 2, PPLA3: 3, PPLA4: 4, PPL: 5 };

function pickFrom(list, { a1, near, fcodes }) {
  const ok = list
    .filter((r) => r.a1 === a1 && fcodes.has(r.fcode) && isNear(r, near))
    .sort((x, y) => (FCODE_RANK[x.fcode] ?? 9) - (FCODE_RANK[y.fcode] ?? 9)
      || (near ? dist(x, near) - dist(y, near) : 0));
  return ok[0] ?? null;
}

/**
 * 按「层级 × 名字」的顺序找：每一层先试全名再试词干，这层没有再降到下一层。
 * 全名必须先于词干：「和田市」的词干「和田」会撞上和田地区，按离地级市远近排序时
 * 地区本身永远最近，不分先后县级市就被它顶掉了。
 * @param {string[][]} tiers 每层允许的 fcode
 * @returns {{rec: object} | null}
 */
function pickTiered(byName, names, tiers, { a1, near }) {
  for (const tier of tiers) {
    const fcodes = new Set(tier);
    for (const n of names) {
      const rec = pickFrom(byName.get(n) ?? [], { a1, near, fcodes });
      if (rec) return { rec };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. Wikidata（只查前两级没找到的那些）
// ---------------------------------------------------------------------------

async function wikidataLookup(names) {
  const file = path.join(CACHE, 'wikidata.json');
  const cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const todo = names.filter((n) => !(n in cache));
  if (todo.length && OFFLINE) throw new Error(`--offline 但 Wikidata 缓存缺 ${todo.length} 条`);
  for (let i = 0; i < todo.length; i += 40) {
    const batch = todo.slice(i, i + 40);
    const values = batch.map((n) => `"${n}"@zh`).join(' ');
    const query = `SELECT ?label ?coord WHERE {
      VALUES ?label { ${values} }
      ?item rdfs:label ?label; wdt:P625 ?coord; wdt:P17 wd:Q148.
    }`;
    const url = `${WIKIDATA_SPARQL}?query=${encodeURIComponent(query)}`;
    const resp = await fetch(url, { headers: { accept: 'application/sparql-results+json', 'user-agent': UA } });
    if (!resp.ok) throw new Error(`Wikidata HTTP ${resp.status}`);
    const body = await resp.json();
    for (const n of batch) cache[n] = [];
    for (const b of body.results.bindings) {
      const m = b.coord.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/);
      if (m) cache[b.label.value].push({ lng: Number(m[1]), lat: Number(m[2]) });
    }
    fs.writeFileSync(file, JSON.stringify(cache, null, 1));
    console.log(`Wikidata ${Math.min(i + 40, todo.length)}/${todo.length}`);
  }
  return cache;
}

// ---------------------------------------------------------------------------
// 4. 组装
// ---------------------------------------------------------------------------

async function main() {
  const mcaFile = path.join(CACHE, `mca-${MCA_YEAR}.html`);
  const zipFile = path.join(CACHE, 'CN.zip');
  const txtFile = path.join(CACHE, 'CN.txt');
  await fetchToFile(MCA_URL, mcaFile);
  if (!fs.existsSync(txtFile)) {
    await fetchToFile(GEONAMES_URL, zipFile, { binary: true });
    execFileSync('unzip', ['-o', '-q', zipFile, 'CN.txt', '-d', CACHE]);
  }

  const registry = buildRegistry(parseMca(fs.readFileSync(mcaFile, 'utf8')));
  const geo = loadGeoNames(txtFile);
  const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  const oldByName = new Map(old.map((c) => [c.name, c]));

  // 省名 → GeoNames admin1 code。GeoNames 的中文别名里可能是「内蒙古」「内モンゴル自治区」，按词干对
  const a1ByProv = new Map();
  for (const [a1, names] of geo.adm1) {
    for (const e of registry.filter((r) => r.level === 1)) {
      if (names.some((n) => stem(n) === stem(e.name) || n.includes(stem(e.name).slice(0, 2)))) {
        if (!a1ByProv.has(e.name)) a1ByProv.set(e.name, a1);
      }
    }
  }

  const out = [];
  const stats = { adm: 0, ppl: 0, wikidata: 0, approx: 0, renamed: 0 };
  const coordOf = new Map();   // 展示名 → {lng,lat}，下级找「附近」时用

  const place = (e, rec, src) => {
    const item = { name: e.name, lng: +rec.lng.toFixed(4), lat: +rec.lat.toFixed(4) };
    if (src === 'approx') item.approx = true;
    // level 只给「附近」判定用，不进输出
    coordOf.set(e.name, { ...item, level: e.level, prov: e.prov });
    out.push(item);
    stats[src] += 1;
    return item;
  };

  // 省、市先落，县级要靠它们判「附近」
  for (const e of registry.filter((r) => r.level <= 2)) {
    const a1 = a1ByProv.get(e.prov);
    const parentNear = e.level === 2 ? coordOf.get(e.prov) : null;
    // 行政区（ADM）一层先于驻地（PPLA）：GeoNames 的中文别名可能只有「酒泉」没有「酒泉市」，
    // 不分层会先撞上叫「酒泉市」的驻地居民点，把行政区质心漏掉
    const own = e.level === 1 ? e.name : e.pref;
    const tiers = e.level === 1 ? [['ADM1']] : [['ADM2', 'ADM3'], ['PPLA', 'PPLA2']];
    let rec = pickTiered(geo.byName, [...new Set([own, stem(own)])], tiers, { a1, near: null })?.rec ?? null;
    if (!rec) rec = oldByName.get(e.name) ?? null;
    if (!rec && parentNear) rec = parentNear;
    if (!rec) throw new Error(`省市级找不到坐标：${e.name}`);
    place(e, rec, 'adm');
  }

  const counties = registry.filter((r) => r.level === 3);
  const pending = [];
  for (const e of counties) {
    const a1 = a1ByProv.get(e.prov);
    const near = coordOf.get(e.pref ? `${e.prov} ${e.pref}` : e.prov) ?? coordOf.get(e.prov);
    const names = [e.county];
    if (stem(e.county).length >= 2) names.push(stem(e.county));

    // 先只认 ADM3；ADM2 只在与地区同名（全名命中）时兜底；再降到乡镇 / 居民点
    const opts = { a1, near };
    const hit = pickTiered(geo.byName, names, [['ADM3']], opts)
      ?? pickTiered(geo.byName, [e.county], [['ADM2']], opts)
      ?? pickTiered(geo.byName, names, [['ADM4', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPL']], opts);
    if (!hit) { pending.push(e); continue; }
    const isAdm = hit.rec.fcode === 'ADM3' || hit.rec.fcode === 'ADM2';
    const item = place(e, hit.rec, isAdm ? 'adm' : 'ppl');
    // 撤县设区之类：全名在 GeoNames 里没有、靠词干命中了行政区，把带旧后缀的名字记成别名，
    // 老师批量粘贴旧名还认得出
    if (isAdm && !geo.byName.has(e.county)) {
      const oldNames = (geo.byStem.get(stem(e.county)) ?? []).filter((k) => k !== e.county);
      if (oldNames.length) { item.aliases = oldNames.slice(0, 3); stats.renamed += 1; }
    }
  }

  const wd = await wikidataLookup(pending.map((e) => e.county));
  for (const e of pending) {
    const near = coordOf.get(e.pref ? `${e.prov} ${e.pref}` : e.prov) ?? coordOf.get(e.prov);
    const hit = (wd[e.county] ?? []).filter((c) => isNear(c, near))
      .sort((x, y) => dist(x, near) - dist(y, near))[0];
    if (hit) place(e, hit, 'wikidata');
    else place(e, near, 'approx');
  }

  // 展示名唯一 & 坐标落在国内
  const seen = new Set();
  for (const c of out) {
    if (seen.has(c.name)) throw new Error(`展示名重复：${c.name}`);
    seen.add(c.name);
    if (!(c.lng >= 73 && c.lng <= 136 && c.lat >= 3 && c.lat <= 54)) throw new Error(`坐标出界：${c.name} ${c.lng},${c.lat}`);
  }

  out.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`);
  console.log(`cities.json 已重建：${out.length} 条`, stats);
  const approx = out.filter((c) => c.approx).map((c) => c.name);
  if (approx.length) console.log('坐标待补（按地级市）：', approx.join('、'));
}

main().catch((err) => { console.error(err); process.exit(1); });
