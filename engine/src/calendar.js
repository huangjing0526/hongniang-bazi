import { Solar } from 'lunar-javascript';

// 节气时刻的唯一出口。risk.js 与前端万年历都从这里取，不各自去问 lunar-javascript——
// 之后换成经验证的冻结表时，只改这一个文件。
//
// 时刻一律是**标准北京时间**（UTC+8），与年月柱交节用的钟一致。

/** 24 节气按公历年内顺序：小寒起、冬至止。偶数位是「节」（换月），奇数位是「气」。 */
export const TERM_NAMES = /** @type {const} */ ([
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
  '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
]);

export const JIE_NAMES = new Set(TERM_NAMES.filter((_, i) => i % 2 === 0));

/** `{year,month,day,hour,minute}` → 自 UTC 纪元起的分钟数（把北京时当作无时区的墙上时间算） */
export const toEpochMinute = (t) => Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute) / 60000;

/**
 * @typedef {object} Term
 * @property {string} name
 * @property {{year:number,month:number,day:number,hour:number,minute:number}} at  北京时间，精确到分
 * @property {number} minutes  toEpochMinute(at)
 */

const cache = new Map();

/**
 * 某公历年的 24 节气。
 * @param {number} year
 * @returns {Term[]} 按 TERM_NAMES 顺序
 */
export function jieQiTableOf(year) {
  if (cache.has(year)) return cache.get(year);
  // 6 月一定落在同一个农历年，取到的表里「小寒…大雪」就是本公历年的，本年冬至在 DONG_ZHI 键下
  const table = Solar.fromYmd(year, 6, 1).getLunar().getJieQiTable();
  const terms = TERM_NAMES.map((name) => {
    const solar = table[name === '冬至' ? 'DONG_ZHI' : name];
    const at = {
      year: solar.getYear(), month: solar.getMonth(), day: solar.getDay(),
      hour: solar.getHour(), minute: solar.getMinute(),
    };
    return { name, at, minutes: toEpochMinute(at) };
  });
  cache.set(year, terms);
  return terms;
}

/** 出生日（北京时的公历日期）当天有没有节气交节；有则返回那一条。24 项都算，不只 12 节。 */
export function jieQiOfDay(beijing) {
  return jieQiTableOf(beijing.year).find(
    (t) => t.at.year === beijing.year && t.at.month === beijing.month && t.at.day === beijing.day,
  ) ?? null;
}

/** 距最近的「节」（换月的 12 个）有多少分钟。跨年时把前后年的表一并看。 */
export function nearestJie(beijing) {
  const now = toEpochMinute(beijing);
  const candidates = [beijing.year - 1, beijing.year, beijing.year + 1]
    .flatMap((y) => jieQiTableOf(y))
    .filter((t) => JIE_NAMES.has(t.name));
  return candidates
    .map((t) => ({ ...t, distance: Math.abs(now - t.minutes) }))
    .sort((a, b) => a.distance - b.distance)[0];
}

const pad = (n) => String(n).padStart(2, '0');
/** `2026-09-07 22:41` */
export const fmtTerm = (t) => `${t.at.year}-${pad(t.at.month)}-${pad(t.at.day)} ${pad(t.at.hour)}:${pad(t.at.minute)}`;
