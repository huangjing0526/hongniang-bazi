// 干支生克流通 与 天干关系 · 原局静态层
//
// 给细盘格子上的「灰线」供数（PRD-branch-relations v1.1 F-14 / F-15 / F-16）：
//   flows        相邻干支之间的生 / 同 / 克，只算三处——同柱干支、相邻柱天干、相邻柱地支（BR-12）
//   dayMasterFlows 年月时三个天干各自与日主的生 / 同 / 克，不论距离——小南斗页底「天干本命：己克癸、癸克丁」
//                 说的就是这个（本命 = 日主），F-16 的文字行从这里取克
//   stemRelations 天干五合（标所合五行，不判化，BR-15）与天干相冲（本期只出数据不画）
// 生与同五行画线，克只以文字列出（BR-14）——画不画是前端的事，这里三种都给。

import { GAN_ELEMENT, ZHI_ELEMENT, elementRelation, GAN_HE_PAIRS, GAN_CHONG_PAIRS, GAN } from './tables.js';
import { PILLAR_KEYS } from './contract.js';

const elementOf = (slot, char) => (slot === 'gan' ? GAN_ELEMENT[char] : ZHI_ELEMENT[char]);

/** 以 from 为主语归一化：生 → from 生 to；被生 → 调换两端，仍记为「生」。克同理。 */
function flowBetween(a, b) {
  const rel = elementRelation(elementOf(a.slot, a.char), elementOf(b.slot, b.char));
  if (rel === '同') return { from: a, to: b, type: '同' };
  if (rel === '生') return { from: a, to: b, type: '生' };
  if (rel === '被生') return { from: b, to: a, type: '生' };
  if (rel === '克') return { from: a, to: b, type: '克' };
  return { from: b, to: a, type: '克' };
}

/**
 * @param {Record<string,{gan:string,zhi:string}>} pillars
 * @returns {object[]} Flow[]，见 contract.js
 */
export function stemBranchFlow(pillars) {
  const at = (pillar, slot) => ({ pillar, slot, char: pillars[pillar][slot] });
  const pairs = [];
  for (const k of PILLAR_KEYS) pairs.push([at(k, 'gan'), at(k, 'zhi')]);                       // 同柱竖向
  for (let i = 0; i < PILLAR_KEYS.length - 1; i++) {
    pairs.push([at(PILLAR_KEYS[i], 'gan'), at(PILLAR_KEYS[i + 1], 'gan')]);                     // 相邻天干
    pairs.push([at(PILLAR_KEYS[i], 'zhi'), at(PILLAR_KEYS[i + 1], 'zhi')]);                     // 相邻地支
  }
  return pairs.map(([a, b]) => withLabel(flowBetween(a, b)));
}

const withLabel = (f) => ({ ...f, label: f.type === '同' ? `${f.from.char}${f.to.char}同气` : `${f.from.char}${f.type}${f.to.char}` });

/**
 * @param {Record<string,{gan:string}>} pillars
 * @returns {object[]} Flow[]，年 / 月 / 时天干各一条，对日干；from/to 方向已归一化
 */
export function dayMasterFlows(pillars) {
  const me = { pillar: 'day', slot: 'gan', char: pillars.day.gan };
  return PILLAR_KEYS.filter((k) => k !== 'day').map((k) => withLabel(flowBetween({ pillar: k, slot: 'gan', char: pillars[k].gan }, me)));
}

const GAN_HE = new Map(GAN_HE_PAIRS.flatMap(([a, b, el]) => [[a + b, el], [b + a, el]]));
const GAN_CHONG = new Set(GAN_CHONG_PAIRS.flatMap(([a, b]) => [a + b, b + a]));

/**
 * @param {Record<string,{gan:string}>} pillars
 * @returns {object[]} StemRelation[]，见 contract.js。不论隔几柱都列（BR-13）
 */
export function stemRelations(pillars) {
  const out = [];
  for (let i = 0; i < PILLAR_KEYS.length; i++) {
    for (let j = i + 1; j < PILLAR_KEYS.length; j++) {
      const a = pillars[PILLAR_KEYS[i]].gan;
      const b = pillars[PILLAR_KEYS[j]].gan;
      const key = a + b;
      // 标签按天干序念（戊癸合火，不是癸戊合火）；positions / stems 仍按柱序
      const name = GAN.indexOf(a) <= GAN.indexOf(b) ? a + b : b + a;
      if (GAN_HE.has(key)) {
        out.push({ kind: '五合', label: `${name}合${GAN_HE.get(key)}`, element: GAN_HE.get(key), positions: [PILLAR_KEYS[i], PILLAR_KEYS[j]], stems: [a, b] });
      } else if (GAN_CHONG.has(key)) {
        out.push({ kind: '相冲', label: `${name}相冲`, positions: [PILLAR_KEYS[i], PILLAR_KEYS[j]], stems: [a, b] });
      }
    }
  }
  return out;
}

