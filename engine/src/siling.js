// 人元司令分野 · 冻结表（一期决策 D-12）
//
// 出生日距本月「节」若干天，由哪一个藏干当令，通行称「司令」。表据《三命通会·论人元司事》整理，
// 各家日数略有出入（申宫首七日一作己土），同神煞的做法：选一派冻结、标「待老师确认」。
// 天数按标准北京时的交节时刻起算，与月柱口径一致。

const TABLE = {
  子: [['壬', 10], ['癸', 20]],
  丑: [['癸', 9], ['辛', 3], ['己', 18]],
  寅: [['戊', 7], ['丙', 7], ['甲', 16]],
  卯: [['甲', 10], ['乙', 20]],
  辰: [['乙', 9], ['癸', 3], ['戊', 18]],
  巳: [['戊', 5], ['庚', 9], ['丙', 16]],
  午: [['丙', 10], ['己', 9], ['丁', 11]],
  未: [['丁', 9], ['乙', 3], ['己', 18]],
  申: [['戊', 7], ['壬', 7], ['庚', 16]],
  酉: [['庚', 10], ['辛', 20]],
  戌: [['辛', 9], ['丁', 3], ['戊', 18]],
  亥: [['戊', 7], ['甲', 5], ['壬', 18]],
};

/**
 * @param {object} lunar   lunar-javascript 的 Lunar（按北京时那份）
 * @param {string} monthZhi
 * @returns {{gan:string, daysAfterJie:number, monthZhi:string, source:string, pendingTeacherConfirm:boolean}}
 */
export function siLing(lunar, monthZhi) {
  const birth = lunar.getSolar();
  const jie = lunar.getPrevJie().getSolar();
  const daysAfterJie = Math.floor(birth.subtractMinute(jie) / 1440);
  let acc = 0;
  let gan = TABLE[monthZhi].at(-1)[0];
  for (const [g, days] of TABLE[monthZhi]) {
    acc += days;
    if (daysAfterJie < acc) { gan = g; break; }
  }
  return {
    gan,
    daysAfterJie,
    monthZhi,
    source: `《三命通会》人元司令分野：${monthZhi}月 ${TABLE[monthZhi].map(([g, d]) => `${g}${d}日`).join('、')}；本盘节后第 ${daysAfterJie + 1} 日`,
    pendingTeacherConfirm: true,
  };
}
