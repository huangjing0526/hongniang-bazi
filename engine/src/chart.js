import { Solar } from 'lunar-javascript';
import { dstOffsetMinutes, DST_STATUS, classifyDst } from './dst.js';
import { trueSolarOffsetMinutes, shiftMinutes, fmt } from './solartime.js';
import { HIDE_GAN, shiShen, changSheng } from './tables.js';
import { assertChart } from './contract.js';
import { applyShenSha } from './shensha.js';
import { buildRisks } from './risk.js';
import { branchRelations } from './branch-relations.js';
import { stemBranchFlow, dayMasterFlows, stemRelations } from './flow.js';
import { computeLuck } from './luck.js';
import { pillarRelations } from './pillar-relations.js';
import { siLing } from './siling.js';

// Frozen convention (§3.1 / §6): 年柱与月柱按**标准北京时间**交节；只有日柱与时柱
// 走真太阳时。这是寿星万年历常用方案，业内不统一，所以写死在这里并可审计。
//
// Layering:
//   recorded wall clock
//     -[remove DST]->  standard Beijing time   -> 年柱 月柱
//     -[+longitude +EoT]-> true solar time      -> 日柱 时柱

const PILLAR_KEYS = ['year', 'month', 'day', 'time'];

function eightCharOf(t, sect) {
  const solar = Solar.fromYmdHms(t.year, t.month, t.day, t.hour, t.minute, 0);
  const lunar = solar.getLunar();
  const ec = lunar.getEightChar();
  ec.setSect(sect);
  return { solar, lunar, ec };
}

function pillarFrom(ec, key) {
  const cap = key[0].toUpperCase() + key.slice(1);
  const gz = ec[`get${cap}`]();
  return {
    ganZhi: gz,
    gan: gz[0],
    zhi: gz[1],
    naYin: ec[`get${cap}NaYin`](),
    xunKong: ec[`get${cap}XunKong`](),
  };
}

/** Build the ten detail rows for one pillar, all relative to the authoritative day stem. */
function decorate(pillar, dayGan) {
  const hide = HIDE_GAN[pillar.zhi];
  return {
    ...pillar,
    zhuXing: shiShen(dayGan, pillar.gan),   // 主星: 日干 vs 本柱天干
    cangGan: hide,                           // 藏干
    fuXing: hide.map((g) => shiShen(dayGan, g)), // 副星: 日干 vs 藏干
    xingYun: changSheng(dayGan, pillar.zhi), // 星运: 日干 vs 本柱地支
    ziZuo: changSheng(pillar.gan, pillar.zhi), // 自坐: 本柱天干 vs 本柱地支
  };
}

/**
 * @param {object} input
 * @param {number} input.year @param {number} input.month @param {number} input.day
 * @param {number} input.hour @param {number} input.minute   recorded wall clock
 * @param {number} [input.longitude=120]  east-positive
 * @param {boolean} [input.applyDst=true]
 * @param {boolean} [input.applyTrueSolar=true]
 * @param {1|2} [input.sect=1]   1 = 子初换日（问真默认）, 2 = 早晚子时
 * @param {'first'|'second'|'unknown'} [input.timeFold='unknown']
 * @param {'male'|'female'} [input.gender='male']
 * @param {boolean} [input.cityKnown=true]  出生地是否已落实；false 时经度是兜底的 120
 * @param {boolean} [input.selfPunish=true]  地支自刑是否启用（老师模型默认开，部分流派不认）
 * @param {1|2} [input.luckSect=2]  起运折算口径：1 整时辰 / 2 按分钟折算、显示到时（默认，对齐问真；见 luck.js）
 * @returns {{charts:object[], warnings:string[]}}  more than one chart iff the
 *          recorded time falls in the DST end-day repeated hour with unknown fold
 */
export function computeChart(input) {
  const {
    longitude = 120, applyDst = true, applyTrueSolar = true,
    sect = 1, timeFold = 'unknown', gender = 'male', cityKnown = true, selfPunish = true, luckSect = 2,
  } = input;
  const clock = {
    year: input.year, month: input.month, day: input.day,
    hour: input.hour, minute: input.minute,
  };

  const warnings = [];
  const { status } = classifyDst(clock);
  if (status === DST_STATUS.NONEXISTENT) {
    warnings.push('该时刻在夏令时起始日被跳过（02:00–02:59 不存在），出生时间需向老师复核');
  }

  // Ambiguous end-day hour with no fold given -> emit both candidates rather than guess.
  let folds = [timeFold];
  if (applyDst && status === DST_STATUS.AMBIGUOUS && timeFold === 'unknown') {
    folds = ['first', 'second'];
    warnings.push('夏令时结束日 01:00–01:59 重复出现，同一钟表时对应两个瞬间，已输出双盘');
  }

  const charts = folds.map((fold) =>
    buildOne({ clock, longitude, applyDst, applyTrueSolar, sect, timeFold: fold, gender, cityKnown, selfPunish, luckSect }),
  );
  return { charts, warnings };
}

function buildOne({ clock, longitude, applyDst, applyTrueSolar, sect, timeFold, gender, cityKnown, selfPunish, luckSect }) {
  const audit = [];
  audit.push({ step: '钟表时', value: fmt(clock), note: '出生记录上的时间，原样输入' });

  // --- layer 1: DST ---
  const dst = dstOffsetMinutes(clock, timeFold);
  const dstMinutes = applyDst && Number.isFinite(dst.minutes) ? dst.minutes : 0;
  const beijing = shiftMinutes(clock, -dstMinutes);
  audit.push({
    step: '夏令时',
    value: dstMinutes ? `−${dstMinutes} 分钟` : '未应用',
    note: applyDst ? dst.note : '开关关闭，未应用',
  });
  audit.push({ step: '标准北京时', value: fmt(beijing), note: '年柱、月柱按此交节' });

  // --- layer 2: true solar ---
  const solarOffset = trueSolarOffsetMinutes(beijing, longitude);
  const trueSolar = applyTrueSolar ? shiftMinutes(beijing, solarOffset.totalMinutes) : beijing;
  audit.push({
    step: '经度差',
    value: `(${longitude} − 120) × 4 = ${solarOffset.longitudeMinutes.toFixed(1)} 分钟`,
    note: applyTrueSolar ? '已应用' : '开关关闭，未应用',
  });
  audit.push({
    step: '均时差',
    value: `${solarOffset.eotMinutes.toFixed(2)} 分钟`,
    note: 'NOAA / Meeus 算法',
  });
  audit.push({
    step: '真太阳时',
    value: fmt(trueSolar),
    note: applyTrueSolar ? '日柱、时柱按此定' : '未应用，日时柱走标准北京时',
  });

  // --- pillars from the two clocks ---
  const beijingChart = eightCharOf(beijing, sect);
  const solarChart = eightCharOf(trueSolar, sect);
  audit.push({
    step: '子时政策',
    value: sect === 1 ? '流派1 子初换日' : '流派2 早晚子时',
    note: trueSolar.hour === 23 ? '本盘在 23 时，该开关生效' : '本盘不在子时交界，两派同结果',
  });

  const raw = {
    year: pillarFrom(beijingChart.ec, 'year'),
    month: pillarFrom(beijingChart.ec, 'month'),
    day: pillarFrom(solarChart.ec, 'day'),
    time: pillarFrom(solarChart.ec, 'time'),
  };
  const dayGan = raw.day.gan;

  const pillars = {};
  for (const k of PILLAR_KEYS) pillars[k] = { ...decorate(raw[k], dayGan), shenSha: [] };
  // 日柱主星 is the self, not a 十神
  pillars.day.zhuXing = gender === 'female' ? '元女' : '元男';

  applyShenSha(pillars);
  const risks = buildRisks({ clock, beijing, trueSolar, solarOffset, cityKnown });
  const relations = branchRelations(pillars, { selfPunish });
  const flows = stemBranchFlow(pillars);
  const dayMaster = dayMasterFlows(pillars);
  const stemRels = stemRelations(pillars);
  const pillarRels = pillarRelations(pillars);
  // 司令按北京时的交节起算，与月柱口径一致
  const siLingInfo = siLing(beijingChart.lunar, pillars.month.zhi);
  // 起运与交节都按北京时那份八字算，与年月柱口径一致；日干用权威的（可能来自真太阳时）
  const luck = computeLuck(beijingChart.ec, dayGan, gender, luckSect);
  return assertChart({
    input: { ...clock, longitude, applyDst, applyTrueSolar, sect, timeFold, gender, cityKnown, selfPunish, luckSect },
    times: { clock, beijing, trueSolar },
    lunar: beijingChart.lunar.toString(),
    ganZhi: PILLAR_KEYS.map((k) => pillars[k].ganZhi).join(' '),
    pillars,
    audit,
    risks,
    relations,
    flows,
    dayMasterFlows: dayMaster,
    stemRelations: stemRels,
    pillarRelations: pillarRels,
    siLing: siLingInfo,
    luck,
  });
}
