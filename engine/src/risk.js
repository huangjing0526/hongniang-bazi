import { Solar } from 'lunar-javascript';
import { RISK_KIND, RISK_LEVEL } from './contract.js';
import { classifyDst, DST_STATUS } from './dst.js';

const toEpochMinute = (t) => Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute) / 60000;
const JIE_NAMES = new Set(['立春','惊蛰','清明','立夏','芒种','小暑','立秋','白露','寒露','立冬','大雪','小寒']);

function nearestJieQi(beijing) {
  const lunar = Solar.fromYmdHms(beijing.year, beijing.month, beijing.day, beijing.hour, beijing.minute, 0).getLunar();
  const entries = Object.entries(lunar.getJieQiTable()).filter(([name]) => JIE_NAMES.has(name));
  return entries.map(([name, solar]) => ({
    name,
    minutes: Math.abs(toEpochMinute(beijing) - toEpochMinute({
      year: solar.getYear(), month: solar.getMonth(), day: solar.getDay(), hour: solar.getHour(), minute: solar.getMinute(),
    })),
  })).sort((a, b) => a.minutes - b.minutes)[0];
}

/** 根据已计算的三层时间生成分歧风险。 */
export function buildRisks({ clock, beijing, trueSolar, solarOffset }) {
  const risks = [];
  const { status, period } = classifyDst(clock);
  if (period && status !== DST_STATUS.OUTSIDE) risks.push({ kind:RISK_KIND.DST, level:RISK_LEVEL.INFO, message:'出生时间落在中国实行夏令时的日期范围内，时柱可能受校正影响。', affects:['day','time'] });
  if (status === DST_STATUS.AMBIGUOUS) risks.push({ kind:RISK_KIND.DST_FOLD, level:RISK_LEVEL.WARN, message:'夏令时结束当天这一小时重复出现，需确认出生记录对应前一遍还是后一遍。', affects:['day','time'] });
  if (status === DST_STATUS.NONEXISTENT) risks.push({ kind:RISK_KIND.DST_GAP, level:RISK_LEVEL.WARN, message:'夏令时开始当天这一小时曾被跳过，出生记录需要复核。', affects:['day','time'] });
  const clockMinute = beijing.hour * 60 + beijing.minute;
  const remainder = ((clockMinute - 60) % 120 + 120) % 120;
  const boundaryDistance = Math.min(remainder, 120 - remainder);
  if (Math.abs(solarOffset.totalMinutes) > boundaryDistance) risks.push({ kind:RISK_KIND.TRUE_SOLAR, level:RISK_LEVEL.WARN, message:'真太阳时校正会跨过时辰边界，开启与关闭校正所得时柱不同。', affects:['day','time'] });
  if (trueSolar.hour === 23 || trueSolar.hour === 0) risks.push({ kind:RISK_KIND.ZI_SHI, level:RISK_LEVEL.WARN, message:'真太阳时处于子时交界，不同换日流派可能得到不同日柱和时柱。', affects:['day','time'] });
  const jieQi = nearestJieQi(beijing);
  if (jieQi && jieQi.minutes < 360) risks.push({ kind:RISK_KIND.JIE_QI, level:RISK_LEVEL.WARN, message:`距${jieQi.name}交节不足六小时，年柱或月柱可能因时间误差而变化。`, affects:['year','month'] });
  return risks;
}
