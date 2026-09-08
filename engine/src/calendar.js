import { Solar } from 'lunar-javascript';
import table from '../data/jieqi-1900-2100.js';
import { GAN, ZHI } from './tables.js';

// 万年历底座：节气时刻的唯一出口，外加一套**不经 lunar-javascript** 的四柱推算。
//
// 节气时刻读 engine/data/jieqi-1900-2100.js——由独立算法（Meeus + VSOP87）生成、
// 对 lunar-javascript / 香港天文台两处交叉验证过的冻结表（见 data/jieqi.SOURCE.md）。
// 表外年份退回 lunar-javascript 并标 source='lunar'，调用方据此报「未经验证」。
//
// 时刻一律是**标准北京时间**（UTC+8），与年月柱交节用的钟一致。

/** 24 节气按公历年内顺序：小寒起、冬至止。偶数位是「节」（换月），奇数位是「气」。 */
export const TERM_NAMES = /** @type {const} */ ([
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
  '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
]);

export const JIE_NAMES = new Set(TERM_NAMES.filter((_, i) => i % 2 === 0));

export const TABLE_RANGE = { from: table.from, to: table.to };

/** 香港天文台历史对照表与现代算法记在不同日期的几条（{year:{term:date}}），万年历页要提示 */
export const HKO_DATE_EXCEPTIONS = table.hkoDateExceptions ?? {};

const EPOCH_MS = Date.UTC(1900, 0, 1);

/** `{year,month,day,hour,minute[,second]}` → 自 UTC 纪元起的秒数（把北京时当作无时区的墙上时间算） */
export const toEpochSecond = (t) => Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second ?? 0) / 1000;
/** 同上，分钟 */
export const toEpochMinute = (t) => toEpochSecond(t) / 60;

function atFromEpochSecond(sec) {
  const d = new Date(sec * 1000);
  return {
    year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(),
    hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(),
  };
}

/**
 * @typedef {object} Term
 * @property {string} name
 * @property {number} index   在 TERM_NAMES 中的序号
 * @property {{year:number,month:number,day:number,hour:number,minute:number,second:number}} at  北京时间
 * @property {number} seconds  toEpochSecond(at)
 * @property {number} minutes  toEpochMinute(at)
 * @property {'table'|'lunar'} source
 */

/** lunar-javascript 算的一年节气（表外年份的退路，也是运行期差分的另一方） */
export function jieQiTableFromLunar(year) {
  // 6 月一定落在同一个农历年，取到的表里「小寒…大雪」就是本公历年的，本年冬至在 DONG_ZHI 键下
  const t = Solar.fromYmd(year, 6, 1).getLunar().getJieQiTable();
  return TERM_NAMES.map((name, index) => {
    const s = t[name === '冬至' ? 'DONG_ZHI' : name];
    const at = { year: s.getYear(), month: s.getMonth(), day: s.getDay(), hour: s.getHour(), minute: s.getMinute(), second: s.getSecond() };
    const seconds = toEpochSecond(at);
    return { name, index, at, seconds, minutes: seconds / 60, source: 'lunar' };
  });
}

const cache = new Map();

/**
 * 某公历年的 24 节气。
 * @param {number} year
 * @returns {Term[]} 按 TERM_NAMES 顺序
 */
export function jieQiTableOf(year) {
  if (cache.has(year)) return cache.get(year);
  const row = table.years[year];
  const terms = row
    ? row.map((offset, index) => {
      const seconds = (EPOCH_MS / 1000) + offset;
      return { name: TERM_NAMES[index], index, at: atFromEpochSecond(seconds), seconds, minutes: seconds / 60, source: 'table' };
    })
    : jieQiTableFromLunar(year);
  cache.set(year, terms);
  return terms;
}

export const isYearVerified = (year) => Boolean(table.years[year]);

/**
 * 运行期差分：冻结表与 lunar-javascript 对本年任一节气相差超过 60 秒即为不一致。
 * 正常永远为空；它存在的意义是出了问题不会静默。
 * @returns {{name:string, table:Term, lunar:Term, diffSeconds:number}[]}
 */
export function calendarMismatches(year) {
  if (!isYearVerified(year)) return [];
  const ours = jieQiTableOf(year);
  const theirs = jieQiTableFromLunar(year);
  return ours
    .map((t, i) => ({ name: t.name, table: t, lunar: theirs[i], diffSeconds: Math.abs(t.seconds - theirs[i].seconds) }))
    .filter((m) => m.diffSeconds > 60);
}

/** 出生日（北京时的公历日期）当天有没有节气交节；有则返回那一条。24 项都算，不只 12 节。 */
export function jieQiOfDay(beijing) {
  return jieQiTableOf(beijing.year).find(
    (t) => t.at.year === beijing.year && t.at.month === beijing.month && t.at.day === beijing.day,
  ) ?? null;
}

/** 前后三年的「节」（换月的 12 个），按时间排好 */
function jieAround(year) {
  return [year - 1, year, year + 1]
    .flatMap((y) => jieQiTableOf(y))
    .filter((t) => JIE_NAMES.has(t.name));
}

/** 距最近的「节」有多少分钟。跨年时把前后年的表一并看。 */
export function nearestJie(beijing) {
  const now = toEpochMinute(beijing);
  return jieAround(beijing.year)
    .map((t) => ({ ...t, distance: Math.abs(now - t.minutes) }))
    .sort((a, b) => a.distance - b.distance)[0];
}

/** 某时刻所在的月令：最后一个 ≤ 该时刻的「节」 */
export function jieBefore(beijing) {
  const now = toEpochSecond(beijing);
  return jieAround(beijing.year).filter((t) => t.seconds <= now).pop();
}

const pad = (n) => String(n).padStart(2, '0');
/** `2026-09-07 22:41:16`——带秒，因为各家万年历有的截断有的四舍五入，只给到分老师会对不上 */
export const fmtTerm = (t) => `${t.at.year}-${pad(t.at.month)}-${pad(t.at.day)} ${pad(t.at.hour)}:${pad(t.at.minute)}:${pad(t.at.second ?? 0)}`;

// ---------------------------------------------------------------------------
// 万年历式四柱推算：不经 lunar-javascript，用节气表 + 干支算术，给排盘结果当对照。
// ---------------------------------------------------------------------------

const ganZhiOf = (index) => GAN[((index % 10) + 10) % 10] + ZHI[((index % 12) + 12) % 12];

/** 公历 → 儒略日数（正午为整），Meeus 7.1 */
export function julianDayNumber(year, month, day) {
  let y = year;
  let m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524;
}

/** 日干支：儒略日连续纪日，锚点 2000-01-01 = 戊午（六十甲子第 54 位） */
export function dayGanZhiByJdn(year, month, day) {
  return ganZhiOf(julianDayNumber(year, month, day) + 49);
}

/** 年干支：以立春交节时刻换年，1984 = 甲子 */
export function yearGanZhiAt(beijing) {
  const liChun = jieQiTableOf(beijing.year).find((t) => t.name === '立春');
  const year = toEpochSecond(beijing) < liChun.seconds ? beijing.year - 1 : beijing.year;
  return { ganZhi: ganZhiOf(year - 4), year };
}

/** 月干支：以「节」换月，五虎遁起月干 */
export function monthGanZhiAt(beijing) {
  const jie = jieBefore(beijing);
  const zhiIndex = (jie.index / 2 + 1) % 12;          // 小寒→丑、立春→寅 … 大雪→子
  const yearGanIndex = GAN.indexOf(yearGanZhiAt(beijing).ganZhi[0]);
  const ganIndex = ((yearGanIndex % 5) * 2 + 2 + ((zhiIndex - 2 + 12) % 12)) % 10;
  return { ganZhi: GAN[ganIndex] + ZHI[zhiIndex], jie };
}

/** 小时 → 时辰地支序号。23 与 0 都是子（0），1、2 是丑（1）… */
export const hourZhiIndex = (hour) => Math.floor(((hour + 1) % 24) / 2);

function shiftDay(t, days) {
  const d = new Date(Date.UTC(t.year, t.month - 1, t.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * 日柱与时柱。sect 1 子初换日：23 时起算次日；sect 2 早晚子时：23 时日柱不换，
 * 时柱按次日日干起（与 lunar-javascript 一致，晚子时的时干等于流派 1 的结果）。
 */
export function dayTimeGanZhiAt(trueSolar, sect = 1) {
  const late = trueSolar.hour === 23;
  const dayDate = late && sect === 1 ? shiftDay(trueSolar, 1) : trueSolar;
  const hourDayDate = late ? shiftDay(trueSolar, 1) : trueSolar;
  const day = dayGanZhiByJdn(dayDate.year, dayDate.month, dayDate.day);
  const hourDayGan = GAN.indexOf(dayGanZhiByJdn(hourDayDate.year, hourDayDate.month, hourDayDate.day)[0]);
  const zhiIndex = hourZhiIndex(trueSolar.hour);
  const time = GAN[((hourDayGan % 5) * 2 + zhiIndex) % 10] + ZHI[zhiIndex];   // 五鼠遁
  return { day, time };
}

/**
 * 万年历推法的四柱：年月按北京时交节，日时按真太阳时——与 chart.js 冻结口径同。
 * @returns {{year:string, month:string, day:string, time:string}}
 */
export function almanacPillars({ beijing, trueSolar, sect = 1 }) {
  const { day, time } = dayTimeGanZhiAt(trueSolar, sect);
  return { year: yearGanZhiAt(beijing).ganZhi, month: monthGanZhiAt(beijing).ganZhi, day, time };
}
