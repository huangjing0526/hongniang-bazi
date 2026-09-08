// 节气时刻的独立算法——只在构建与测试时跑，不进浏览器。
//
// 用途是给 lunar-javascript（寿星系）当**另一位裁判**：Meeus《Astronomical Algorithms》
// 第 27 章（求太阳视黄经到达给定值的时刻）+ VSOP87 完整地球序列 + NASA/USNO ΔT 表，
// 代码与作者都和寿星无关（astronomia，Sonia Keys / commenthol 的 Meeus 移植，MIT）。
// 两套算法互相对上，才敢说节气时刻不是抄错的。
//
// 输出一律是标准北京时间（UTC+8），精确到分。

import { longitude } from 'astronomia/solstice';
import { Planet } from 'astronomia/planetposition';
import { deltaT } from 'astronomia/deltat';
import { JDToCalendarGregorian } from 'astronomia/julian';
import earthData from 'astronomia/data/vsop87Bearth';

const earth = new Planet(earthData);
const D2R = Math.PI / 180;

/** 与 src/calendar.js 的 TERM_NAMES 同序：小寒起、冬至止。太阳黄经 = 285° + 15°×i (mod 360) */
export const TERM_NAMES = [
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分', '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
  '小暑', '大暑', '立秋', '处暑', '白露', '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至',
];

/** 太阳视黄经，度 */
export const termLongitude = (index) => (285 + 15 * index) % 360;

/**
 * 某年第 index 个节气的 JDE（力学时 TT）。
 *
 * astronomia 的 longitude() 用「该年四个分至之一」当初值再迭代到目标黄经：黄经 ≥ 270° 的
 * 从冬至起算，所以 1–3 月那六个（小寒…惊蛰，黄经 285°–345°）要从**前一年**的冬至出发，
 * 否则会迭代到下一年去。
 */
export function termJde(year, index) {
  const lon = termLongitude(index);
  const seedYear = lon >= 285 ? year - 1 : year;
  return longitude(seedYear, earth, lon * D2R);
}

/** JDE（TT）→ 北京时间 { year, month, day, hour, minute, second }，按秒四舍五入到分之前先保留秒 */
export function jdeToBeijing(jde) {
  const { year: y0 } = JDToCalendarGregorian(jde);
  // ΔT 用当年的十进制年份即可，年内变化不到一秒
  const dt = deltaT(y0 + 0.5);
  const jdUt = jde - dt / 86400;
  const jdBeijing = jdUt + 8 / 24;
  const { year, month, day } = JDToCalendarGregorian(jdBeijing);
  const dayInt = Math.floor(day);
  const secs = Math.round((day - dayInt) * 86400);
  return {
    year, month, day: dayInt,
    hour: Math.floor(secs / 3600), minute: Math.floor((secs % 3600) / 60), second: secs % 60,
    deltaT: dt,
  };
}

/**
 * 一整年的 24 节气，北京时间。
 * @returns {{name:string, at:{year,month,day,hour,minute,second}, deltaT:number}[]}
 */
export function termsOfYear(year) {
  return TERM_NAMES.map((name, i) => {
    const t = jdeToBeijing(termJde(year, i));
    const { deltaT: dt, ...at } = t;
    return { name, at, deltaT: dt };
  });
}
