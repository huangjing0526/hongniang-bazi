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
