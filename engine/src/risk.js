import { RISK_KIND, RISK_LEVEL } from './contract.js';
import { classifyDst, DST_STATUS } from './dst.js';
import { jieQiOfDay, nearestJie, fmtTerm } from './calendar.js';

/** 根据已计算的三层时间生成分歧风险。 */
export function buildRisks({ clock, beijing, trueSolar, solarOffset, cityKnown = true }) {
  const risks = [];
  // 出生地没落实时经度只能按东经 120 度顶着算，真太阳时偏移就只剩均时差（±16 分），
  // TRUE_SOLAR 那条判据几乎必然不触发——于是一个出生地未知的盘会亮绿灯说「各家一致」。
  // 那不是「不在分歧区」，是「无从判断」，必须单独说出来。
  if (!cityKnown) {
    risks.push({
      kind: RISK_KIND.CITY_UNKNOWN,
      level: RISK_LEVEL.WARN,
      message: '出生地未落实，经度暂按东经 120 度计算。真太阳时校正是否会改时柱，本盘无从判断——请先补出生地。',
      affects: ['day', 'time'],
    });
  }
  const { status, period } = classifyDst(clock);
  if (period && status !== DST_STATUS.OUTSIDE) risks.push({ kind:RISK_KIND.DST, level:RISK_LEVEL.INFO, message:'出生时间落在中国实行夏令时的日期范围内，时柱可能受校正影响。', affects:['day','time'] });
  if (status === DST_STATUS.AMBIGUOUS) risks.push({ kind:RISK_KIND.DST_FOLD, level:RISK_LEVEL.WARN, message:'夏令时结束当天这一小时重复出现，需确认出生记录对应前一遍还是后一遍。', affects:['day','time'] });
  if (status === DST_STATUS.NONEXISTENT) risks.push({ kind:RISK_KIND.DST_GAP, level:RISK_LEVEL.WARN, message:'夏令时开始当天这一小时曾被跳过，出生记录需要复核。', affects:['day','time'] });
  const clockMinute = beijing.hour * 60 + beijing.minute;
  const remainder = ((clockMinute - 60) % 120 + 120) % 120;
  const boundaryDistance = Math.min(remainder, 120 - remainder);
  if (Math.abs(solarOffset.totalMinutes) > boundaryDistance) risks.push({ kind:RISK_KIND.TRUE_SOLAR, level:RISK_LEVEL.WARN, message:'真太阳时校正会跨过时辰边界，开启与关闭校正所得时柱不同。', affects:['day','time'] });
  if (trueSolar.hour === 23 || trueSolar.hour === 0) risks.push({ kind:RISK_KIND.ZI_SHI, level:RISK_LEVEL.WARN, message:'真太阳时处于子时交界，不同换日流派可能得到不同日柱和时柱。', affects:['day','time'] });
  const jie = nearestJie(beijing);
  if (jie && jie.distance < 360) risks.push({ kind:RISK_KIND.JIE_QI, level:RISK_LEVEL.WARN, message:`距${jie.name}交节（${fmtTerm(jie)}）不足六小时，年柱或月柱可能因时间误差而变化。`, affects:['year','month'] });
  // 节气当天（按北京时的公历日期，24 项都算）：老师的口径是这天默认按早晚子时排。
  // 这里只报事实，「默认切到早晚子时」由前端执行，因为它得尊重老师手动切过的开关。
  const term = jieQiOfDay(beijing);
  if (term) risks.push({ kind:RISK_KIND.JIE_QI_DAY, level:RISK_LEVEL.INFO, message:`出生日为节气「${term.name}」当天，交节时刻 ${fmtTerm(term)}（北京时间）。`, affects:['day','time'], term:{ name: term.name, at: term.at } });
  return risks;
}
