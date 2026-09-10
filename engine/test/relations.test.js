import test from 'node:test';
import assert from 'node:assert/strict';
import { branchRelations } from '../src/branch-relations.js';
import { computeChart } from '../src/chart.js';

const pillarsOf = (zhis) => Object.fromEntries(['year', 'month', 'day', 'time'].map((k, i) => [k, { zhi: zhis[i] }]));
const find = (rels, kind) => rels.filter((r) => r.kind === kind);
const sig = (r) => `${r.kind}:${r.positions.join('')}`;

test('案例：丙子 癸巳 辛酉 戊子 —— 伏吟、生旺半合、六破', () => {
  const rels = branchRelations(pillarsOf(['子', '巳', '酉', '子']));
  const sigs = rels.map(sig);
  assert.ok(sigs.includes('伏吟:yeartime'));
  assert.ok(sigs.includes('生旺半合:monthday'));
  assert.equal(find(rels, '生旺半合')[0].label, '生旺半合（半合金）');
  assert.ok(sigs.includes('六破:yearday'), '年日 子酉 破');
  assert.ok(sigs.includes('六破:daytime'), '日时 酉子 破');
  assert.equal(find(rels, '自刑').length, 0, '子重见不是自刑');
  assert.equal(find(rels, '墓库').length, 0);
});

test('案例：乙亥 己丑 戊申 乙卯 —— 隔两位的半合、隔位的害、丑为金库', () => {
  const rels = branchRelations(pillarsOf(['亥', '丑', '申', '卯']));
  const half = find(rels, '生旺半合')[0];
  assert.equal(sig(half), '生旺半合:yeartime');
  assert.equal(half.distance.code, 'D12');
  assert.equal(half.distance.event, 0);
  assert.equal(half.distance.life, 0);
  const hai = find(rels, '六害')[0];
  assert.equal(sig(hai), '六害:yearday');
  assert.equal(hai.distance.code, 'D11');
  assert.equal(hai.distance.event, 40);
  assert.equal(hai.distance.life, 70);
  const tomb = find(rels, '墓库')[0];
  assert.deepEqual([tomb.positions[0], tomb.label, tomb.category, tomb.nature], ['month', '金库', 'tag', 'neutral']);
  assert.ok(!rels.some((r) => r.kind === '三会'), '亥丑缺子，不成三会');
});

test('三合成局后不再重复标半合；三支相连与有隔分别标出', () => {
  const rels = branchRelations(pillarsOf(['亥', '卯', '未', '子']));
  const he = find(rels, '三合')[0];
  assert.equal(he.label, '三合（合木局）');
  assert.equal(he.distance.label, '三支相连');
  assert.equal(find(rels, '生旺半合').length + find(rels, '旺墓半合').length + find(rels, '暗拱').length, 0);

  const gapped = branchRelations(pillarsOf(['亥', '子', '卯', '未']));
  assert.equal(find(gapped, '三合')[0].distance.label, '三支有隔');
  assert.equal(find(gapped, '生旺半合').length, 0);
});

test('三会、三刑、争合', () => {
  const hui = branchRelations(pillarsOf(['寅', '卯', '辰', '午']));
  assert.equal(find(hui, '三会')[0].label, '三会（会木）');
  assert.ok(hui.some((r) => r.kind === '六害' && r.branches.join('') === '卯辰'), '三会内部的六害照样标');

  const xing = branchRelations(pillarsOf(['寅', '巳', '申', '子']));
  assert.equal(find(xing, '三刑')[0].label, '三刑（恃势之刑）');
  assert.equal(find(xing, '三刑')[0].nature, 'clash');
  assert.equal(find(xing, '相刑').length, 0, '三刑成组后不重复标两两相刑');
  assert.ok(xing.some((r) => r.kind === '六冲' && r.branches.join('') === '寅申'));
  assert.ok(xing.some((r) => r.kind === '六害' && r.branches.join('') === '寅巳'));

  const two = branchRelations(pillarsOf(['丑', '戌', '子', '子']));
  assert.equal(find(two, '相刑')[0].label, '无恩之刑');
  assert.equal(find(two, '相刑')[0].branches.join(''), '丑戌');

  const zheng = branchRelations(pillarsOf(['丑', '子', '丑', '午']));
  const z = find(zheng, '争合')[0];
  assert.deepEqual(z.positions, ['month', 'year', 'day'], '被争的支排第一');
  assert.equal(z.category, 'triple');
  assert.equal(z.distance, undefined);
  assert.equal(find(zheng, '六合').length, 2, '两条六合照标，争合是加标不是替代');
});

test('自刑可关；暗合标待老师确认；无礼之刑', () => {
  const on = branchRelations(pillarsOf(['午', '午', '寅', '丑']));
  assert.equal(find(on, '自刑').length, 1);
  assert.equal(find(on, '伏吟').length, 1);
  const anhe = find(on, '暗合')[0];
  assert.equal(anhe.branches.join(''), '寅丑');
  assert.equal(anhe.pendingTeacherConfirm, true);

  const off = branchRelations(pillarsOf(['午', '午', '寅', '丑']), { selfPunish: false });
  assert.equal(find(off, '自刑').length, 0);
  assert.equal(find(off, '伏吟').length, 1, '关自刑不影响伏吟');

  const wuli = branchRelations(pillarsOf(['子', '卯', '辰', '申']));
  assert.equal(find(wuli, '相刑')[0].label, '无礼之刑');
  assert.equal(find(wuli, '三合')[0].label, '三合（合水局）');
  assert.equal(find(wuli, '暗拱').length, 0, '申辰在申子辰三合之内，不再单标暗拱');

  const gong = branchRelations(pillarsOf(['寅', '戌', '子', '丑']));
  assert.equal(find(gong, '暗拱')[0].label, '暗拱（拱午）');
});

test('排序：强者在前；每条都带出处与层级', () => {
  const rels = branchRelations(pillarsOf(['亥', '卯', '未', '丑']));
  assert.equal(rels[0].kind, '三合');
  assert.equal(rels[rels.length - 1].kind, '墓库');
  for (const r of rels) {
    assert.equal(r.layer, 'T00');
    assert.equal(typeof r.source, 'string');
    assert.equal(r.positions.length, r.branches.length);
    assert.equal(typeof r.code, 'string');
    assert.equal(typeof r.label, 'string');
    assert.ok(['bond', 'clash', 'neutral'].includes(r.nature));
  }
});

test('computeChart 输出挂 relations，且 selfPunish 开关透传', () => {
  const input = { year: 1996, month: 5, day: 23, hour: 23, minute: 3, longitude: 120, applyTrueSolar: false, gender: 'female' };
  const chart = computeChart(input).charts[0];
  assert.ok(Array.isArray(chart.relations));
  assert.equal(chart.input.selfPunish, true);
  const off = computeChart({ ...input, selfPunish: false }).charts[0];
  assert.equal(off.input.selfPunish, false);
});
