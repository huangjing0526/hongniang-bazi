import test from 'node:test';
import assert from 'node:assert/strict';
import { pillarRelations } from '../src/pillar-relations.js';
import { siLing } from '../src/siling.js';
import { computeChart } from '../src/chart.js';
import { Solar } from 'lunar-javascript';

const pillarsOf = (gz) => Object.fromEntries(['year', 'month', 'day', 'time'].map((k, i) => [k, { gan: gz[i][0], zhi: gz[i][1], ganZhi: gz[i] }]));

test('盖头、截脚、天合地合、天克地冲、干支伏吟', () => {
  const rels = pillarRelations(pillarsOf(['庚寅', '壬子', '甲子', '丁丑']));
  const labels = rels.map((r) => r.label);
  assert.ok(labels.includes('庚寅 盖头'), '庚金克寅木');
  assert.ok(labels.includes('壬子 天合地合') === false);
  assert.ok(labels.includes('壬子 丁丑 天合地合'), '丁壬合、子丑合');
  assert.ok(!labels.some((l) => l.includes('截脚')), '甲子、丁丑、壬子都不是截脚');

  const r2 = pillarRelations(pillarsOf(['甲子', '庚午', '甲子', '丙子']));
  const l2 = r2.map((r) => r.label);
  assert.ok(l2.includes('甲子 庚午 天克地冲（反吟）'));
  assert.ok(l2.includes('甲子 甲子 干支伏吟'));
  assert.ok(l2.includes('丙子 截脚'), '子水克丙火');
  assert.equal(r2.find((r) => r.kind === '天克地冲').positions.join(), 'year,month');
});

test('司令：节后天数落在分野表的哪一段', () => {
  // 1999-10-16 18:30，寒露 10-09 01:48 → 节后第 8 日（daysAfterJie = 7），戌月：辛 9 日
  const lunar = Solar.fromYmdHms(1999, 10, 16, 18, 30, 0).getLunar();
  const s = siLing(lunar, '戌');
  assert.equal(s.daysAfterJie, 7);
  assert.equal(s.gan, '辛');
  assert.equal(s.pendingTeacherConfirm, true);
  // 节后第 12 日 → 丁（9+3）；第 13 日起 → 戊
  assert.equal(siLing(Solar.fromYmdHms(1999, 10, 20, 12, 0, 0).getLunar(), '戌').gan, '丁');
  assert.equal(siLing(Solar.fromYmdHms(1999, 10, 21, 12, 0, 0).getLunar(), '戌').gan, '戊');
  // 易百查截图（05）该盘显示「司令：辛」
  const chart = computeChart({ year: 1999, month: 10, day: 16, hour: 18, minute: 30, longitude: 120, applyTrueSolar: false, gender: 'male' }).charts[0];
  assert.equal(chart.siLing.gan, '辛');
  assert.ok(Array.isArray(chart.pillarRelations));
});
