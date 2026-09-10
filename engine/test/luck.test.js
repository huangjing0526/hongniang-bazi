import test from 'node:test';
import assert from 'node:assert/strict';
import { computeChart } from '../src/chart.js';

// 易百查截图（docs/资料/竞品流通指示-2026-09-10/05）：己卯 甲戌 辛丑 丁酉 男，
// 起运 2 年 6 个月 23 天 10 小时，交运 2002-05-10 04:30，大运 2002 癸酉 4 岁起、逆行。
// 截图没给出生分钟，按分钟折算每分钟差 2 小时，所以只对到「天」。
const input = { year: 1999, month: 10, day: 16, hour: 18, minute: 30, longitude: 120, applyTrueSolar: false, applyDst: false, gender: 'male' };

test('易百查样盘（默认按分钟口径）：逆行、起运时长、交运日期、十步大运与流年', () => {
  const chart = computeChart(input).charts[0];
  assert.equal(chart.ganZhi, '己卯 甲戌 辛丑 丁酉');
  const { luck } = chart;
  assert.equal(luck.forward, false);
  assert.equal(luck.luckSect, 2);
  assert.deepEqual([luck.start.years, luck.start.months, luck.start.days], [2, 6, 23]);
  assert.deepEqual([luck.startAt.year, luck.startAt.month, luck.startAt.day], [2002, 5, 10]);
  assert.equal(luck.daYun.length, 10);
  assert.equal(luck.daYun[0].ganZhi, '');
  assert.deepEqual(luck.daYun.slice(1, 4).map((d) => `${d.startYear}${d.ganZhi}${d.startAge}`), ['2002癸酉4', '2012壬申14', '2022辛未24']);
  assert.equal(luck.daYun[9].ganZhi, '乙丑');
  assert.equal(luck.daYun[1].zhuXing, '食神');   // 辛日见癸
  assert.equal(luck.daYun[1].xingYun, '临官');   // 辛在酉
  assert.deepEqual(luck.daYun[1].liuNian.slice(0, 2).map((l) => `${l.year}${l.ganZhi}${l.age}`), ['2002壬午4', '2003癸未5']);
  assert.equal(luck.daYun[1].liuNian.length, 10);
  // 小运：时柱丁酉，男顺行：1 岁戊戌、2 岁己亥、3 岁庚子（不是历法库的阴男逆推）
  assert.deepEqual(luck.daYun[0].xiaoYun.map((x) => `${x.age}${x.ganZhi}`), ['1戊戌', '2己亥', '3庚子']);
});

test('整时辰口径可切：尾数丢弃，交运只到日', () => {
  const chart = computeChart({ ...input, luckSect: 1 }).charts[0];
  assert.equal(chart.luck.luckSect, 1);
  assert.deepEqual([chart.luck.start.years, chart.luck.start.months, chart.luck.start.days, chart.luck.start.hours], [2, 6, 20, 0]);
  assert.deepEqual([chart.luck.startAt.year, chart.luck.startAt.month, chart.luck.startAt.day], [2002, 5, 6]);
  assert.equal(chart.luck.daYun[1].ganZhi, '癸酉', '折算口径不改大运干支');
});

test('阳男顺行；真太阳时不改起运', () => {
  const base = { year: 1996, month: 8, day: 10, hour: 12, minute: 3, longitude: 103.825, gender: 'male', applyDst: false };
  const a = computeChart({ ...base, applyTrueSolar: false }).charts[0].luck;
  const b = computeChart({ ...base, applyTrueSolar: true }).charts[0].luck;
  assert.equal(a.forward, true);   // 丙子年 阳干 男
  assert.deepEqual(a.start, b.start);
  // 女命小运逆推：同盘女造，时柱庚午 → 1 岁己巳；男造顺推 → 1 岁辛未
  const f = computeChart({ ...base, gender: 'female' }).charts[0].luck;
  assert.equal(f.daYun[0].xiaoYun[0].ganZhi, '己巳');
  assert.equal(a.daYun[0].xiaoYun[0].ganZhi, '辛未');
  assert.deepEqual(a.daYun.map((d) => d.ganZhi), b.daYun.map((d) => d.ganZhi));
});
