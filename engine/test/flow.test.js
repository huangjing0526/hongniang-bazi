import test from 'node:test';
import assert from 'node:assert/strict';
import { stemBranchFlow, dayMasterFlows, stemRelations } from '../src/flow.js';
import { elementRelation } from '../src/tables.js';

const pillarsOf = (gz) => Object.fromEntries(['year', 'month', 'day', 'time'].map((k, i) => [k, { gan: gz[i][0], zhi: gz[i][1] }]));
const labels = (flows) => flows.map((f) => f.label);

test('elementRelation 以主语为准', () => {
  assert.equal(elementRelation(0, 1), '生');   // 木生火
  assert.equal(elementRelation(1, 0), '被生');
  assert.equal(elementRelation(0, 2), '克');   // 木克土
  assert.equal(elementRelation(2, 0), '被克');
  assert.equal(elementRelation(3, 3), '同');
});

test('小南斗例一 丁丑 庚戌 壬寅 庚子：与截图的灰线逐条一致', () => {
  const flows = stemBranchFlow(pillarsOf(['丁丑', '庚戌', '壬寅', '庚子']));
  assert.equal(flows.length, 4 + 3 + 3);
  const l = labels(flows);
  for (const expected of ['丁生丑', '戌生庚', '壬生寅', '庚生子', '庚生壬', '庚生壬', '子生寅', '丑戌同气']) {
    assert.ok(l.includes(expected), `缺 ${expected}：${l.join(' ')}`);
  }
  // 克不画线但要给数据：丁克庚（年月天干）、寅克戌（月日地支）
  assert.ok(l.includes('丁克庚'));
  assert.ok(l.includes('寅克戌'));
  // 方向归一化：戌生庚 的 from 是地支
  const f = flows.find((x) => x.label === '戌生庚');
  assert.deepEqual([f.from.slot, f.to.slot, f.from.pillar], ['zhi', 'gan', 'month']);
  // 天干五合：丁壬合木，隔一位照列
  const rel = stemRelations(pillarsOf(['丁丑', '庚戌', '壬寅', '庚子']));
  assert.deepEqual(rel, [{ kind: '五合', label: '丁壬合木', element: '木', positions: ['year', 'day'], stems: ['丁', '壬'] }]);
});

test('小南斗例二 己卯 丁丑 癸酉 癸丑：克的文字行与相冲数据', () => {
  const flows = stemBranchFlow(pillarsOf(['己卯', '丁丑', '癸酉', '癸丑']));
  const l = labels(flows);
  for (const expected of ['丁生己', '丁生丑', '酉生癸', '丑生酉', '丑生酉', '癸癸同气', '癸克丁', '卯克己', '丑克癸']) {
    assert.ok(l.includes(expected), `缺 ${expected}：${l.join(' ')}`);
  }
  assert.ok(!l.includes('己克癸'), '己与癸隔一位，不在相邻三处里');
  // 小南斗页底「天干本命：己克癸 癸克丁」= 各天干对日主，不论距离
  const dm = dayMasterFlows(pillarsOf(['己卯', '丁丑', '癸酉', '癸丑']));
  assert.deepEqual(dm.map((f) => f.label), ['己克癸', '癸克丁', '癸癸同气']);
  assert.deepEqual(dm.filter((f) => f.type === '克').map((f) => f.label), ['己克癸', '癸克丁']);
  const rel = stemRelations(pillarsOf(['己卯', '丁丑', '癸酉', '癸丑']));
  assert.deepEqual(rel.map((r) => r.label), ['丁癸相冲', '丁癸相冲']);
  assert.equal(rel[0].element, undefined);
  // 标签按天干序念，位置仍按柱序
  const r9 = stemRelations(pillarsOf(['丙子', '癸巳', '辛酉', '戊子']));
  assert.deepEqual(r9.map((r) => r.label), ['丙辛合水', '戊癸合火']);
  assert.deepEqual(r9[1].stems, ['癸', '戊']);
});
