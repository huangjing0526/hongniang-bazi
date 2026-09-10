// 整柱关系 · 通行定义（一期决策 D-13）
//
// 单柱：盖头（天干克地支）、截脚（地支克天干）
// 两柱：天合地合（天干五合 + 地支六合）、天克地冲（天干相克 + 地支六冲，即通行所谓「反吟」）、
//       干支伏吟（两柱干支全同）
// 只标有无。方向、力量、吉凶都不判。

import { GAN_ELEMENT, ZHI_ELEMENT, elementRelation, GAN_HE_PAIRS, LIU_HE, LIU_CHONG } from './tables.js';
import { PILLAR_KEYS } from './contract.js';

const GAN_HE = new Set(GAN_HE_PAIRS.flatMap(([a, b]) => [a + b, b + a]));

const SOURCE = {
  盖头: '天干克本柱地支，通行称「盖头」，如庚寅、壬午',
  截脚: '地支克本柱天干，通行称「截脚」，如甲申、丙子',
  天合地合: '两柱天干五合且地支六合，如丁丑与壬子',
  天克地冲: '两柱天干相克且地支六冲，通行称「反吟」，如甲子与庚午',
  干支伏吟: '两柱干支全同，如年柱与日柱同为甲子',
};

/**
 * @param {Record<string,{gan:string,zhi:string,ganZhi:string}>} pillars
 * @returns {object[]} PillarRelation[]，见 contract.js
 */
export function pillarRelations(pillars) {
  const out = [];
  for (const k of PILLAR_KEYS) {
    const { gan, zhi, ganZhi } = pillars[k];
    const rel = elementRelation(GAN_ELEMENT[gan], ZHI_ELEMENT[zhi]);
    if (rel === '克') out.push({ kind: '盖头', label: `${ganZhi} 盖头`, positions: [k], source: SOURCE.盖头 });
    if (rel === '被克') out.push({ kind: '截脚', label: `${ganZhi} 截脚`, positions: [k], source: SOURCE.截脚 });
  }
  for (let i = 0; i < PILLAR_KEYS.length; i++) {
    for (let j = i + 1; j < PILLAR_KEYS.length; j++) {
      const a = pillars[PILLAR_KEYS[i]];
      const b = pillars[PILLAR_KEYS[j]];
      const positions = [PILLAR_KEYS[i], PILLAR_KEYS[j]];
      const pair = `${a.ganZhi} ${b.ganZhi}`;
      if (a.ganZhi === b.ganZhi) out.push({ kind: '干支伏吟', label: `${pair} 干支伏吟`, positions, source: SOURCE.干支伏吟 });
      if (GAN_HE.has(a.gan + b.gan) && LIU_HE[a.zhi] === b.zhi) out.push({ kind: '天合地合', label: `${pair} 天合地合`, positions, source: SOURCE.天合地合 });
      const ganRel = elementRelation(GAN_ELEMENT[a.gan], GAN_ELEMENT[b.gan]);
      if ((ganRel === '克' || ganRel === '被克') && LIU_CHONG[a.zhi] === b.zhi) {
        out.push({ kind: '天克地冲', label: `${pair} 天克地冲（反吟）`, positions, source: SOURCE.天克地冲 });
      }
    }
  }
  return out;
}
