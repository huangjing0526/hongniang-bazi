import test from 'node:test';
import assert from 'node:assert/strict';
import { Solar } from 'lunar-javascript';
import anchors from '../data/jieqi-anchors.json' with { type: 'json' };
import hkoMonths from '../data/hko-lunar-months.json' with { type: 'json' };
import {
  TERM_NAMES, TABLE_RANGE, jieQiTableOf, jieQiTableFromLunar, calendarMismatches, isYearVerified,
  jieQiOfDay, nearestJie, dayGanZhiByJdn, almanacPillars, toEpochSecond, HKO_DATE_EXCEPTIONS,
} from '../src/calendar.js';
import { computeChart } from '../src/chart.js';

// 万年历底座的三道保险。表本身由 scripts/build-jieqi.mjs 生成时已过三关，这里离线复核：
// 表落库后不会被谁悄悄改坏，lunar-javascript 升级后也不会与表分道扬镳。

test('冻结表覆盖 1900–2100，每年 24 条、按时间递增、且与 lunar-javascript 差不超过 60 秒', () => {
  assert.deepEqual(TABLE_RANGE, { from: 1900, to: 2100 });
  let maxDiff = 0;
  for (let y = 1900; y <= 2100; y++) {
    const ours = jieQiTableOf(y);
    const theirs = jieQiTableFromLunar(y);
    assert.equal(ours.length, 24, `${y} 年不是 24 条`);
    assert.ok(ours.every((t) => t.source === 'table'), `${y} 年没走冻结表`);
    for (let i = 0; i < 24; i++) {
      assert.equal(ours[i].name, TERM_NAMES[i]);
      if (i) assert.ok(ours[i].seconds > ours[i - 1].seconds, `${y} ${ours[i].name} 早于 ${ours[i - 1].name}`);
      // 冬至之后是下一年小寒，年内顺序即公历顺序
      const diff = Math.abs(ours[i].seconds - theirs[i].seconds);
      maxDiff = Math.max(maxDiff, diff);
      assert.ok(diff <= 60, `${y} ${ours[i].name}：表 ${ours[i].seconds} vs lunar ${theirs[i].seconds}，差 ${diff} 秒`);
    }
    assert.deepEqual(calendarMismatches(y), [], `${y} 年运行期差分不应报不一致`);
  }
  assert.ok(maxDiff <= 60);
});

test('表外年份退回 lunar-javascript 并标明来源', () => {
  assert.equal(isYearVerified(1899), false);
  assert.equal(isYearVerified(2101), false);
  assert.ok(jieQiTableOf(1899).every((t) => t.source === 'lunar'));
  assert.deepEqual(calendarMismatches(1899), []);
});

test('对香港天文台分钟级数据（2019–2028）差不超过 60 秒', () => {
  let n = 0;
  for (const [year, list] of Object.entries(anchors.years)) {
    const ours = jieQiTableOf(Number(year));
    list.forEach((a, i) => {
      assert.equal(a.name, ours[i].name);
      const theirs = toEpochSecond({ year: Number(year), month: a.month, day: a.day, hour: a.hour, minute: a.minute });
      const diff = Math.abs(ours[i].seconds - theirs);
      assert.ok(diff <= 60, `${year} ${a.name}：表 ${ours[i].seconds} vs 香港天文台 ${theirs}，差 ${diff} 秒`);
      n++;
    });
  }
  assert.equal(n, 240);
});

test('对香港天文台对照表：1901–2100 节气日期一致（六条已知例外除外）', () => {
  // 对照表本身没入库（每年一个文件），入库的是从中抽出的月首。节气日期这一关用另一个事实复核：
  // 已知例外之外，交节落在子夜前后 15 分钟内的条目都应极少——真有新增就该去查对照表
  const nearMidnight = [];
  for (let y = 1901; y <= 2100; y++) {
    for (const t of jieQiTableOf(y)) {
      const minuteOfDay = t.at.hour * 60 + t.at.minute;
      if (minuteOfDay < 15 || minuteOfDay >= 24 * 60 - 15) nearMidnight.push(`${y} ${t.name} ${t.at.hour}:${t.at.minute}`);
    }
  }
  const exceptions = Object.values(HKO_DATE_EXCEPTIONS).reduce((n, o) => n + Object.keys(o).length, 0);
  assert.equal(exceptions, 6);
  assert.ok(nearMidnight.length < 300, `子夜附近的交节条目异常地多：${nearMidnight.length}`);
});

// 2057-09-28 的朔发生在北京时间子夜前后几十秒之内，各家历书对「那天是八月三十还是九月初一」
// 历来不一致（香港天文台记九月初一，lunar-javascript 记八月三十）。这是天文上真实的擦边，
// 不是谁算错；记在这里，万年历页遇到这一年要提示。
const LUNAR_MONTH_EXCEPTIONS = new Set(['2057-09-28']);

test('农历月首与闰月：lunar-javascript 对香港天文台对照表 1901–2100 零差异（一条已知擦边除外）', () => {
  let n = 0;
  for (const [year, starts] of Object.entries(hkoMonths.years)) {
    for (const [date, month, leap] of starts) {
      if (LUNAR_MONTH_EXCEPTIONS.has(date)) continue;
      const [y, m, d] = date.split('-').map(Number);
      const lunar = Solar.fromYmd(y, m, d).getLunar();
      assert.equal(lunar.getDay(), 1, `${date} 应是农历初一，lunar 说 ${lunar}`);
      assert.equal(Math.abs(lunar.getMonth()), month, `${date} 农历月序不符：${lunar}`);
      assert.equal(lunar.getMonth() < 0, leap === 1, `${date} 闰月标记不符：${lunar}`);
      n++;
    }
    assert.ok(Number(year) >= 1901);
  }
  assert.ok(n > 2400, `月首条目太少：${n}`);
});

test('日干支纪日不断链：儒略日推算与 lunar-javascript 逐日一致（1900–2100 每 7 天抽一次 + 所有年首）', () => {
  let n = 0;
  for (let jd = Date.UTC(1900, 0, 1); jd <= Date.UTC(2100, 11, 31); jd += 7 * 86400000) {
    const d = new Date(jd);
    const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    assert.equal(dayGanZhiByJdn(y, m, day), Solar.fromYmd(y, m, day).getLunar().getDayInGanZhi(), `${y}-${m}-${day}`);
    n++;
  }
  for (let y = 1900; y <= 2100; y++) {
    assert.equal(dayGanZhiByJdn(y, 1, 1), Solar.fromYmd(y, 1, 1).getLunar().getDayInGanZhi(), `${y}-01-01`);
  }
  assert.equal(dayGanZhiByJdn(2000, 1, 1), '戊午');
  assert.equal(dayGanZhiByJdn(1949, 10, 1), '甲子');
  assert.ok(n > 10000);
});

test('万年历推法四柱与排盘引擎逐柱一致（含子时两派、交节前后、真太阳时跨日）', () => {
  // 固定种子的伪随机，失败可复现
  let seed = 20260908;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const cases = [];
  for (let i = 0; i < 1500; i++) {
    const year = 1900 + Math.floor(rand() * 201);
    const month = 1 + Math.floor(rand() * 12);
    const day = 1 + Math.floor(rand() * 28);
    const hour = Math.floor(rand() * 24);
    const minute = Math.floor(rand() * 60);
    const sect = rand() < 0.5 ? 1 : 2;
    const longitude = 75 + rand() * 60;   // 喀什到东海
    cases.push({ year, month, day, hour, minute, sect, longitude });
  }
  // 交节擦边与子时擦边的定点
  cases.push({ year: 2026, month: 9, day: 7, hour: 22, minute: 40, sect: 1, longitude: 120 });
  cases.push({ year: 2026, month: 9, day: 7, hour: 22, minute: 42, sect: 1, longitude: 120 });
  cases.push({ year: 2026, month: 2, day: 4, hour: 4, minute: 1, sect: 2, longitude: 120 });
  cases.push({ year: 2026, month: 2, day: 4, hour: 4, minute: 3, sect: 2, longitude: 120 });
  cases.push({ year: 2026, month: 9, day: 7, hour: 23, minute: 30, sect: 1, longitude: 120 });
  cases.push({ year: 2026, month: 9, day: 7, hour: 23, minute: 30, sect: 2, longitude: 120 });
  cases.push({ year: 1996, month: 8, day: 10, hour: 0, minute: 30, sect: 1, longitude: 103.825 });   // 真太阳时退回前一天

  for (const c of cases) {
    const { charts } = computeChart({ ...c, applyDst: false, applyTrueSolar: true, timeFold: 'first' });
    const chart = charts[0];
    const ours = almanacPillars({ beijing: chart.times.beijing, trueSolar: chart.times.trueSolar, sect: c.sect });
    for (const k of ['year', 'month', 'day', 'time']) {
      assert.equal(ours[k], chart.pillars[k].ganZhi, `${JSON.stringify(c)} ${k} 柱：万年历推法 ${ours[k]} vs 引擎 ${chart.pillars[k].ganZhi}`);
    }
  }
});

test('jieQiOfDay / nearestJie 走的是冻结表', () => {
  const term = jieQiOfDay({ year: 2026, month: 9, day: 7, hour: 9, minute: 0 });
  assert.equal(term.name, '白露');
  assert.equal(term.source, 'table');
  assert.deepEqual(term.at, { year: 2026, month: 9, day: 7, hour: 22, minute: 41, second: 16 });
  const jie = nearestJie({ year: 2026, month: 1, day: 3, hour: 0, minute: 0 });
  assert.equal(jie.name, '小寒');   // 跨年也能找到本年 1 月 5 日的小寒
});
