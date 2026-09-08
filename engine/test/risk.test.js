import test from 'node:test';
import assert from 'node:assert/strict';
import { computeChart } from '../src/chart.js';

const kinds = (input) => computeChart(input).charts[0].risks.map((risk) => risk.kind);

test('六种风险均由对应边界触发', () => {
  assert.ok(kinds({year:1988,month:7,day:15,hour:9,minute:30,applyTrueSolar:false}).includes('dst'));
  assert.ok(kinds({year:1988,month:9,day:11,hour:1,minute:30,applyTrueSolar:false,timeFold:'first'}).includes('dst_fold'));
  assert.ok(kinds({year:1988,month:4,day:17,hour:2,minute:30,applyTrueSolar:false}).includes('dst_gap'));
  assert.ok(kinds({year:1996,month:8,day:10,hour:12,minute:3,longitude:103.825}).includes('true_solar'));
  assert.ok(kinds({year:1996,month:8,day:10,hour:23,minute:30,applyTrueSolar:false}).includes('zi_shi'));
  assert.ok(kinds({year:1996,month:8,day:7,hour:13,minute:48,applyTrueSolar:false}).includes('jie_qi'));
});

test('出生地未知必须报风险，不能让「不在分歧区」的绿灯亮起来', () => {
  // 经度兜底成 120 时真太阳时偏移只剩均时差，TRUE_SOLAR 判据不会触发；
  // 若不单独报一条，界面会把一个出生地未知的盘说成「各家排法一致」。
  const unknown = { year: 1996, month: 6, day: 20, hour: 9, minute: 30, longitude: 120, cityKnown: false };
  assert.deepEqual(kinds({ ...unknown, cityKnown: true }), [], '这个盘在出生地已知时本来就没有风险');
  assert.deepEqual(kinds(unknown), ['city_unknown']);
});

test('节气当天报 jie_qi_day，24 项都算，按北京时日期判', () => {
  // 2026-09-07 22:41 白露（节）；2026-09-23 秋分（气）也要报
  const bailu = kinds({ year: 2026, month: 9, day: 7, hour: 9, minute: 0, applyTrueSolar: false });
  assert.ok(bailu.includes('jie_qi_day'));
  assert.ok(!bailu.includes('jie_qi'), '上午九点距交节 13 小时，不该同时报「不足六小时」');
  assert.ok(kinds({ year: 2026, month: 9, day: 23, hour: 9, minute: 0, applyTrueSolar: false }).includes('jie_qi_day'));
  assert.ok(!kinds({ year: 2026, month: 9, day: 8, hour: 0, minute: 30, applyTrueSolar: false }).includes('jie_qi_day'));

  // 兰州 9 月 8 日 00:30 的真太阳时落在 9 月 7 日，但「当天」按北京时判，不算节气日
  assert.ok(!kinds({ year: 2026, month: 9, day: 8, hour: 0, minute: 30, longitude: 103.825 }).includes('jie_qi_day'));

  const risk = computeChart({ year: 2026, month: 9, day: 7, hour: 23, minute: 30, applyTrueSolar: false })
    .charts[0].risks.find((r) => r.kind === 'jie_qi_day');
  assert.equal(risk.level, 'info');
  assert.equal(risk.term.name, '白露');
  assert.deepEqual(risk.term.at, { year: 2026, month: 9, day: 7, hour: 22, minute: 41, second: 16 });
});
