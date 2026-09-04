import { computeChart } from './chart.js';

const ROWS = [
  ['主星', (p) => p.zhuXing],
  ['天干', (p) => p.gan],
  ['地支', (p) => p.zhi],
  ['藏干', (p) => p.cangGan.join(' ')],
  ['副星', (p) => p.fuXing.join(' ')],
  ['星运', (p) => p.xingYun],
  ['自坐', (p) => p.ziZuo],
  ['空亡', (p) => p.xunKong],
  ['纳音', (p) => p.naYin],
];
const KEYS = ['year', 'month', 'day', 'time'];

const width = (s) => [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
const pad = (s, w) => s + ' '.repeat(Math.max(0, w - width(s)));

function printChart(c) {
  console.log(`  农历 ${c.lunar}`);
  console.log(`  四柱 ${c.ganZhi}`);
  console.log('');
  console.log(`  ${pad('', 6)}${['年柱', '月柱', '日柱', '时柱'].map((h) => pad(h, 16)).join('')}`);
  for (const [label, get] of ROWS) {
    console.log(`  ${pad(label, 6)}${KEYS.map((k) => pad(get(c.pillars[k]), 16)).join('')}`);
  }
  console.log('');
  console.log('  朱批（计算过程）');
  for (const a of c.audit) console.log(`    ${pad(a.step, 12)}${pad(a.value, 34)}${a.note}`);
}

const CASES = [
  {
    title: '① 黄金用例 · Alanzhou 坤造 · 1996-08-10 12:03 · 真太阳时关（对齐问真截图）',
    input: { year: 1996, month: 8, day: 10, hour: 12, minute: 3, longitude: 120, applyTrueSolar: false, gender: 'female' },
    expect: '丙子 丙申 己卯 庚午',
  },
  {
    title: '② 同盘 · 兰州 103.82°E · 真太阳时开 → 时柱变 己巳（主星比肩，不是正官）',
    input: { year: 1996, month: 8, day: 10, hour: 12, minute: 3, longitude: 103.82, applyTrueSolar: true, gender: 'female' },
    expect: '丙子 丙申 己卯 己巳',
  },
  {
    title: '③ 夏令时 · 1988-07-15 09:30 北京 · 开关关（= 问真 Web 版实测行为）',
    input: { year: 1988, month: 7, day: 15, hour: 9, minute: 30, longitude: 116.4, applyDst: false, applyTrueSolar: false },
    expect: '戊辰 己未 辛未 癸巳',
  },
  {
    title: '④ 夏令时 · 同上 · 开关开 → 回拨 1 小时，时柱 癸巳 → 壬辰',
    input: { year: 1988, month: 7, day: 15, hour: 9, minute: 30, longitude: 116.4, applyDst: true, applyTrueSolar: false },
    expect: '戊辰 己未 辛未 壬辰',
  },
  {
    title: '⑤ 1988 起日陷阱 · 04-14 09:30 · 正确表(4-17)下不回拨；若抄 4-10 会错排',
    input: { year: 1988, month: 4, day: 14, hour: 9, minute: 30, longitude: 116.4, applyDst: true, applyTrueSolar: false },
    expect: '戊辰 丙辰 己亥 己巳',
  },
  {
    title: '⑥ 立秋交节 · 1996-08-07 08:00 · 未过节，月柱乙未',
    input: { year: 1996, month: 8, day: 7, hour: 8, minute: 0, longitude: 120, applyTrueSolar: false },
    expect: '丙子 乙未 丙子 壬辰',
  },
  {
    title: '⑦ 立秋交节 · 同日 14:00 · 已过节，月柱丙申',
    input: { year: 1996, month: 8, day: 7, hour: 14, minute: 0, longitude: 120, applyTrueSolar: false },
    expect: '丙子 丙申 丙子 乙未',
  },
  {
    title: '⑧ 子时两派 · 1996-08-10 23:30 · 流派1 子初换日 → 日柱庚辰',
    input: { year: 1996, month: 8, day: 10, hour: 23, minute: 30, longitude: 120, applyTrueSolar: false, sect: 1 },
    expect: '丙子 丙申 庚辰 丙子',
  },
  {
    title: '⑨ 子时两派 · 同上 · 流派2 早晚子时 → 日柱仍己卯',
    input: { year: 1996, month: 8, day: 10, hour: 23, minute: 30, longitude: 120, applyTrueSolar: false, sect: 2 },
    expect: '丙子 丙申 己卯 丙子',
  },
  {
    title: '⑩ 夏令时结束日重复小时 · 1988-09-11 01:30 · fold 未知 → 输出双盘',
    input: { year: 1988, month: 9, day: 11, hour: 1, minute: 30, longitude: 120, applyDst: true, applyTrueSolar: false },
    expect: null,
  },
];


let failed = 0;
for (const c of CASES) {
  console.log('\n' + '═'.repeat(96));
  console.log(c.title);
  console.log('═'.repeat(96));
  const { charts, warnings } = computeChart(c.input);
  for (const w of warnings) console.log(`  ⚠ ${w}`);
  charts.forEach((chart, i) => {
    if (charts.length > 1) console.log(`\n  —— 候选 ${i + 1}（timeFold=${chart.input.timeFold}）——`);
    printChart(chart);
    if (c.expect) {
      const ok = chart.ganZhi === c.expect;
      if (!ok) failed++;
      console.log(`  ${ok ? '✓' : '✗'} 期望 ${c.expect} / 实得 ${chart.ganZhi}`);
    }
  });
}
console.log('\n' + (failed ? `✗ ${failed} 个断言未通过` : '✓ 所有带期望值的用例通过'));
process.exit(failed ? 1 : 0);
