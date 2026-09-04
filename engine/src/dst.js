// China Daylight Saving Time, 1986-1991 only.
// Source of truth: IANA tzdb `Rule PRC 1986..1991` (Asia/Shanghai), cross-checked
// against 京政办发〔1988〕17 号 and 国办发〔1992〕8 号.
//
// WARNING: 1988 starts on 04-17, NOT 04-10. The 04-10 value is widely copied by
// fortune-telling blogs and several competing products, and is wrong: the 国务院办公厅
// 1987-09-09 rule is "4 月中旬的第一个星期日" (中旬 = the 11th-20th), and 1988-04-10
// falls in 上旬. Using 04-10 subtracts an hour that should not be subtracted for
// births in 1988-04-10..04-16 — the exact class of case we would use to show
// someone else is wrong.

/** @type {{year:number, start:[number,number], end:[number,number]}[]} */
export const DST_PERIODS = [
  { year: 1986, start: [5, 4], end: [9, 14] },
  { year: 1987, start: [4, 12], end: [9, 13] },
  { year: 1988, start: [4, 17], end: [9, 11] },
  { year: 1989, start: [4, 16], end: [9, 17] },
  { year: 1990, start: [4, 15], end: [9, 16] },
  { year: 1991, start: [4, 14], end: [9, 15] },
];

// Clock switches at 02:00 on both boundary days:
//   start day: 02:00 CST -> 03:00 CDT  (wall times 02:00-02:59 never happened)
//   end day:   02:00 CDT -> 01:00 CST  (wall times 01:00-01:59 happened twice)
const SWITCH_HOUR = 2;

export const DST_STATUS = {
  OUTSIDE: 'outside',      // not in any DST period
  INSIDE: 'inside',        // unambiguously DST
  AMBIGUOUS: 'ambiguous',  // end-day repeated hour: needs timeFold
  NONEXISTENT: 'nonexistent', // start-day skipped hour: input cannot be a real instant
};

const dayNum = (m, d) => m * 100 + d;

/**
 * Classify a recorded wall-clock time against the DST table.
 * @param {{year:number,month:number,day:number,hour:number,minute:number}} t recorded wall clock
 * @returns {{status:string, period:object|null}}
 */
export function classifyDst(t) {
  const period = DST_PERIODS.find((p) => p.year === t.year);
  if (!period) return { status: DST_STATUS.OUTSIDE, period: null };

  const cur = dayNum(t.month, t.day);
  const start = dayNum(...period.start);
  const end = dayNum(...period.end);
  if (cur < start || cur > end) return { status: DST_STATUS.OUTSIDE, period };

  if (cur === start) {
    if (t.hour < SWITCH_HOUR) return { status: DST_STATUS.OUTSIDE, period };
    if (t.hour === SWITCH_HOUR) return { status: DST_STATUS.NONEXISTENT, period };
    return { status: DST_STATUS.INSIDE, period };
  }
  if (cur === end) {
    if (t.hour < SWITCH_HOUR - 1) return { status: DST_STATUS.INSIDE, period };
    if (t.hour === SWITCH_HOUR - 1) return { status: DST_STATUS.AMBIGUOUS, period };
    return { status: DST_STATUS.OUTSIDE, period };
  }
  return { status: DST_STATUS.INSIDE, period };
}

/**
 * Offset in minutes to subtract from the recorded wall clock to get standard
 * Beijing time (UTC+8).
 * @param {object} t recorded wall clock
 * @param {'first'|'second'|'unknown'} timeFold which pass through a repeated hour
 * @returns {{minutes:number, status:string, note:string}}
 */
export function dstOffsetMinutes(t, timeFold = 'unknown') {
  const { status } = classifyDst(t);
  switch (status) {
    case DST_STATUS.INSIDE:
      return { minutes: 60, status, note: '夏令时窗口内，回拨 60 分钟' };
    case DST_STATUS.AMBIGUOUS:
      if (timeFold === 'first') return { minutes: 60, status, note: '夏令时结束日重复小时，取第一遍（仍在夏令时）' };
      if (timeFold === 'second') return { minutes: 0, status, note: '夏令时结束日重复小时，取第二遍（已是标准时）' };
      return { minutes: NaN, status, note: '夏令时结束日重复小时，timeFold 未知，需输出双盘' };
    case DST_STATUS.NONEXISTENT:
      return { minutes: 0, status, note: '夏令时起始日 02:00–02:59 不存在，输入时间存疑' };
    default:
      return { minutes: 0, status, note: '未命中夏令时窗口' };
  }
}
