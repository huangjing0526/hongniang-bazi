import test from 'node:test';
import assert from 'node:assert/strict';
import { computeChart } from '../src/chart.js';
import { classifyDst, DST_STATUS, DST_PERIODS } from '../src/dst.js';
import { trueSolarOffsetMinutes, shiftMinutes, fmt } from '../src/solartime.js';

const gz = (input) => computeChart(input).charts[0].ganZhi;

test('黄金用例 · 对齐问真截图（真太阳时关）', () => {
  assert.equal(
    gz({ year: 1996, month: 8, day: 10, hour: 12, minute: 3, longitude: 120, applyTrueSolar: false, gender: 'female' }),
    '丙子 丙申 己卯 庚午',
  );
});

test('黄金用例细盘十行 · 逐字段', () => {
  const c = computeChart({ year: 1996, month: 8, day: 10, hour: 12, minute: 3, longitude: 120, applyTrueSolar: false, gender: 'female' }).charts[0];
  const K = ['year', 'month', 'day', 'time'];
  assert.deepEqual(K.map((k) => c.pillars[k].zhuXing), ['正印', '正印', '元女', '伤官']);
  assert.deepEqual(c.pillars.month.cangGan, ['庚', '壬', '戊']);
  assert.deepEqual(c.pillars.month.fuXing, ['伤官', '正财', '劫财']);
  assert.deepEqual(K.map((k) => c.pillars[k].xingYun), ['绝', '沐浴', '病', '临官']);
  // 自坐 ≠ 星运：日干 vs 本柱支 是星运，本柱干 vs 本柱支 才是自坐
  assert.deepEqual(K.map((k) => c.pillars[k].ziZuo), ['胎', '病', '病', '沐浴']);
  assert.deepEqual(K.map((k) => c.pillars[k].xunKong), ['申酉', '辰巳', '申酉', '戌亥']);
  assert.deepEqual(K.map((k) => c.pillars[k].naYin), ['涧下水', '山下火', '城头土', '路旁土']);
});

test('兰州真太阳时 · 时柱庚午 → 己巳，主星比肩而非正官', () => {
  const c = computeChart({ year: 1996, month: 8, day: 10, hour: 12, minute: 3, longitude: 103.82, applyTrueSolar: true, gender: 'female' }).charts[0];
  assert.equal(c.ganZhi, '丙子 丙申 己卯 己巳');
  assert.equal(c.pillars.time.zhuXing, '比肩');
  assert.equal(c.pillars.time.naYin, '大林木');
  assert.equal(c.pillars.time.xingYun, '帝旺');
  assert.equal(c.pillars.time.ziZuo, '帝旺');
});

test('夏令时开关改变时柱', () => {
  const base = { year: 1988, month: 7, day: 15, hour: 9, minute: 30, longitude: 116.4, applyTrueSolar: false };
  assert.equal(gz({ ...base, applyDst: false }), '戊辰 己未 辛未 癸巳');
  assert.equal(gz({ ...base, applyDst: true }), '戊辰 己未 辛未 壬辰');
});

test('1988 起日必须是 04-17，不是 04-10', () => {
  assert.deepEqual(DST_PERIODS.find((p) => p.year === 1988).start, [4, 17]);
  // 04-10..04-16 落在错误表的窗口里，正确表下必须不回拨
  for (const day of [10, 11, 12, 13, 14, 15, 16]) {
    const s = classifyDst({ year: 1988, month: 4, day, hour: 9, minute: 30 });
    assert.equal(s.status, DST_STATUS.OUTSIDE, `1988-04-${day} 不应命中夏令时`);
  }
  assert.equal(classifyDst({ year: 1988, month: 4, day: 17, hour: 9, minute: 30 }).status, DST_STATUS.INSIDE);
});

test('夏令时边界 · 起始日跳过的小时与结束日重复的小时', () => {
  assert.equal(classifyDst({ year: 1988, month: 4, day: 17, hour: 2, minute: 30 }).status, DST_STATUS.NONEXISTENT);
  assert.equal(classifyDst({ year: 1988, month: 9, day: 11, hour: 1, minute: 30 }).status, DST_STATUS.AMBIGUOUS);
  assert.equal(classifyDst({ year: 1988, month: 9, day: 11, hour: 3, minute: 0 }).status, DST_STATUS.OUTSIDE);
});

test('重复小时且 fold 未知 → 输出双盘而不是猜一个', () => {
  const r = computeChart({ year: 1988, month: 9, day: 11, hour: 1, minute: 30, longitude: 120, applyDst: true, applyTrueSolar: false });
  assert.equal(r.charts.length, 2);
  assert.notEqual(r.charts[0].ganZhi, r.charts[1].ganZhi);
  assert.ok(r.warnings.some((w) => w.includes('双盘')));
});

test('立秋交节 · 同日上下午月柱不同', () => {
  const base = { year: 1996, month: 8, day: 7, longitude: 120, applyTrueSolar: false, minute: 0 };
  assert.equal(gz({ ...base, hour: 8 }).split(' ')[1], '乙未');
  assert.equal(gz({ ...base, hour: 14 }).split(' ')[1], '丙申');
});

test('子时两派 · 23:30 日柱不同', () => {
  const base = { year: 1996, month: 8, day: 10, hour: 23, minute: 30, longitude: 120, applyTrueSolar: false };
  assert.equal(gz({ ...base, sect: 1 }).split(' ')[2], '庚辰');
  assert.equal(gz({ ...base, sect: 2 }).split(' ')[2], '己卯');
});

test('真太阳时对齐问真 Web 版实测读数（兰州 103.825）', () => {
  const cases = [
    [{ year: 1988, month: 7, day: 15, hour: 9, minute: 30 }, '1988-07-15 08:19'],
    [{ year: 1988, month: 7, day: 15, hour: 11, minute: 0 }, '1988-07-15 09:49'],
  ];
  for (const [t, expected] of cases) {
    const o = trueSolarOffsetMinutes(t, 103.825);
    assert.equal(fmt(shiftMinutes(t, o.totalMinutes)), expected);
  }
});

test('年月柱走标准北京时，日时柱走真太阳时', () => {
  // 兰州，钟表 00:30；真太阳时回到前一日 23:19 → 日柱应按前一日算，年月柱不受影响
  const c = computeChart({ year: 1996, month: 8, day: 11, hour: 0, minute: 30, longitude: 103.82, applyTrueSolar: true }).charts[0];
  assert.equal(c.times.beijing.day, 11);
  assert.equal(c.times.trueSolar.day, 10);
  assert.equal(c.ganZhi.split(' ')[1], '丙申'); // 月柱由北京时间交节，未受真太阳时影响
});

// ── 以下用例的期望值来自 2026-09-03 对问真在线版的实机读数，不是手推 ──

test('对账问真 · 子时两派（1993-03-27 23:30）', () => {
  const base = { year: 1993, month: 3, day: 27, minute: 30, longitude: 120, applyTrueSolar: false, applyDst: false };
  // 问真 yzs=0（不勾早晚子时）：23 时起日柱换次日
  assert.equal(gz({ ...base, hour: 23, sect: 1 }), '癸酉 乙卯 戊申 壬子');
  // 问真 yzs=1（勾早晚子时）：日柱不换，但时干仍按次日五鼠遁 → 壬子而非丁日该出的庚子
  assert.equal(gz({ ...base, hour: 23, sect: 2 }), '癸酉 乙卯 丁未 壬子');
  // 亥时不受该开关影响
  assert.equal(gz({ ...base, hour: 22, minute: 59, sect: 1 }), '癸酉 乙卯 丁未 辛亥');
  assert.equal(gz({ ...base, hour: 22, minute: 59, sect: 2 }), '癸酉 乙卯 丁未 辛亥');
});

test('对账问真 · 交节按时刻而非按日（2026 立秋 08-07 19:42）', () => {
  const base = { year: 2026, month: 8, day: 7, minute: 0, longitude: 120, applyTrueSolar: false };
  // 交节在晚上，所以当天上午与下午月柱相同——若测试只写「上午 vs 下午」会误判为「软件按日切」
  assert.equal(gz({ ...base, hour: 8 }).split(' ')[1], '乙未');
  assert.equal(gz({ ...base, hour: 18 }).split(' ')[1], '乙未');
  assert.equal(gz({ ...base, hour: 20 }).split(' ')[1], '丙申');
});

test('羊刃 · 阴干用逆行一派，且必须标为待老师确认', () => {
  const c = computeChart({ year: 1996, month: 8, day: 10, hour: 12, minute: 3, longitude: 103.82, applyTrueSolar: true, gender: 'female' }).charts[0];
  const yangRen = c.pillars.time.shenSha.find((s) => s.name === '羊刃');
  // 日干己、禄在午；本表取逆行 → 刃在巳。若哪天改成顺行派（刃在未），这条会红，提醒是刻意换派而非手滑
  assert.ok(yangRen, '己日巳时应命中羊刃（逆行派）');
  assert.equal(yangRen.pendingTeacherConfirm, true, '阴干羊刃有三派，必须标待确认');
  assert.ok(yangRen.source.includes('三派'), '出处须披露分歧，不能只给一句口诀');
});
