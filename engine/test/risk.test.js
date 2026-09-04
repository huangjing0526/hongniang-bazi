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
