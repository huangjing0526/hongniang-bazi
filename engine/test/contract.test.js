import test from 'node:test';
import assert from 'node:assert/strict';
import { assertChart } from '../src/contract.js';
import { computeChart } from '../src/chart.js';

test('computeChart 出口满足契约，坏形状会早失败', () => {
  const chart = computeChart({year:2000,month:1,day:1,hour:12,minute:0}).charts[0];
  assert.equal(assertChart(chart), chart);
  assert.throws(() => assertChart({...chart, risks:null}), /risks 必须是数组/);
});
