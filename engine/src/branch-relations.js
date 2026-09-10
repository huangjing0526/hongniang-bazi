// 地支关系标注 · 原局静态层（T00）
//
// 数据与代号据老师《八字地支运算体系 V3.1》第一、二、三、七、八、九章整理。
// 本模块只回答「有没有这个关系」以及它落在哪几柱、隔多远、在力量金字塔里排第几；
// 合解冲 / 冲破合 / 化气 / 封印这类「生不生效」的判定（第十章）另起模块，
// 岁运引动（第五章）等大运流年落地后再接。两者都不在这里。
//
// 文档里标【模型备注】的口径（自刑、暗合只取两对）不是各家共识，
// 自刑给了开关；暗合按神煞的老办法标 pendingTeacherConfirm。

import { ZHI, LIU_HE, LIU_HE_PAIRS, LIU_CHONG_PAIRS } from './tables.js';
import { PILLAR_KEYS } from './contract.js';

/** 第三章空间距离编码。两套百分比分别用于断具体事件、断人生大局，本层两套并列标出。 */
const DISTANCE = {
  1: { code: 'D10', label: '相邻', event: 100, life: 100 },
  2: { code: 'D11', label: '隔一位', event: 40, life: 70 },
  3: { code: 'D12', label: '隔两位', event: 0, life: 0, note: '断事直接忽略；断局保留「合意」不生「合力」，岁运搭桥可成合力' },
};

/**
 * 第九章力量金字塔（同等距离下）：rank 1 最强 … 7 最弱；伏吟、墓库不在金字塔内，垫底。
 * nature 决定前端色调：bond 合类 / clash 冲刑害破 / neutral 其余。
 */
const GRADE = {
  三会: { code: 'K01', rank: 1, stars: '★★★★★', nature: 'bond' },
  三合: { code: 'K02', rank: 2, stars: '★★★★☆', nature: 'bond' },
  六合: { code: 'K03', rank: 3, stars: '★★★☆☆', nature: 'bond' },
  生旺半合: { code: 'K04', rank: 3.5, stars: '★★☆☆☆', nature: 'bond' },
  旺墓半合: { code: 'K05', rank: 3.5, stars: '★★☆☆☆', nature: 'bond' },
  暗拱: { code: 'K06', rank: 3.5, stars: '★☆☆☆☆', nature: 'bond' },
  暗合: { code: 'K07', rank: 3.5, stars: '★☆☆☆☆', nature: 'bond' },
  争合: { code: 'K08', rank: 3.5, stars: '★★☆☆☆', nature: 'bond' },
  六冲: { code: 'K09', rank: 4, stars: '★★☆☆☆', nature: 'clash' },
  三刑: { code: 'K10', rank: 5, stars: '★★☆☆☆', nature: 'clash' },
  相刑: { code: 'K10', rank: 5, stars: '★★☆☆☆', nature: 'clash' },
  自刑: { code: 'K10', rank: 5, stars: '★★☆☆☆', nature: 'clash' },
  六害: { code: 'K11', rank: 6, stars: '★☆☆☆☆', nature: 'clash' },
  六破: { code: 'K12', rank: 7, stars: '★☆☆☆☆', nature: 'clash' },
  伏吟: { code: 'V01', rank: 8, stars: '—', nature: 'neutral' },
  墓库: { code: 'G00', rank: 9, stars: '—', nature: 'neutral' },
};

const SOURCE = {
  三会: '第九章 K01：空间/季节的整体汇聚，一方专气。三字齐全即成势，不需透干、不需当令，不畏一般冲克；冲三会先冲中神，冲边支难破',
  三合: '第九章 K02：五行能量的周期性闭环（长生→帝旺→墓）。三字齐全即自成该五行之气，不需透干、不需当令；月令为合局死绝之地力量打七折',
  六合: '第九章 K03：阴阳异性的亲密吸引。化气须四条件齐备（化神当令、天干引透、未被冲散、本根未绝），否则为「合绊」——牵制纠缠，主拖延',
  生旺半合: '第九章 K04：三合之长生 + 帝旺。力量醇厚，最接近完整三合；逢冲即碎',
  旺墓半合: '第九章 K05：三合之帝旺 + 墓库。蓄气收纳，待机时间长；逢冲即碎',
  暗拱: '第九章 K06：三合之长生 + 墓库，缺帝旺。虚势待填，拱出之字只取象不参与生克；遇冲销毁虚象；岁运填实拱神则转为实局',
  暗合: '第九章 K07：非六合配对，藏干阴阳相吸，主暗中往来。老师表只列寅丑、午亥两对，传统另有卯申等，待老师确认',
  争合: '第九章 K08：同一地支同时被两支来合。贴身优先；同距离看宫位，月令＞日支＞时支＞年支。争合只论合绊纠缠，不以合化论',
  六冲: '第九章 K09：方位或属性的正面对抗，主激烈变动、分离。合能解冲：合住进攻方，静态须贴身',
  三刑: '第九章 K10：寅巳申恃势之刑、丑戌未无恩之刑。丑戌未三支本气未被天干重克则刑气兑现，被重克仅虚象修正（需天干模块，本层未判）',
  相刑: '第九章 K10：三刑之两支相见。寅巳申恃势、丑戌未无恩、子卯无礼。主内耗、折磨',
  自刑: '第九章 K10【模型备注】：辰午酉亥重复相见才触发自刑，单见不算；主自我纠结、钻牛角尖。部分流派不认自刑，可在工具栏关闭',
  六害: '第九章 K11：合局被破后的暗中妨害，主小人、隔阂。冲能解害：冲开害方',
  六破: '第九章 K12：合局中的细微裂痕，主轻微破损、小摩擦',
  伏吟: '第八章 V01：地支重复相见。原局互见为静态，能量放大同时气机郁闭，多纠缠重复；岁运与原局同支才算引动',
  墓库: '第一、七章：辰戌丑未为墓库，常态关闭（G00），库中财官印锁住。被六冲则冲开（G01），被六合则合闭（G02）——开闭判定属第十章，本层只标库',
};

/** 三合局：[长生, 帝旺, 墓] */
const SAN_HE = [
  { members: ['亥', '卯', '未'], element: '木' },
  { members: ['寅', '午', '戌'], element: '火' },
  { members: ['申', '子', '辰'], element: '水' },
  { members: ['巳', '酉', '丑'], element: '金' },
];
const SAN_HUI = [
  { members: ['寅', '卯', '辰'], element: '木' },
  { members: ['巳', '午', '未'], element: '火' },
  { members: ['申', '酉', '戌'], element: '金' },
  { members: ['亥', '子', '丑'], element: '水' },
];
const SAN_XING = [
  { members: ['寅', '巳', '申'], name: '恃势之刑' },
  { members: ['丑', '戌', '未'], name: '无恩之刑', note: '三支本气是否被天干重克，待天干模块判定' },
];
const SELF_PUNISH = new Set(['辰', '午', '酉', '亥']);
const TOMB = { 丑: '金库', 辰: '水库', 未: '木库', 戌: '火库' };

/** 两支关系统一成一张查表：键为两支按地支序拼接，值为该两支的全部规则 {kind, label, pending?, inTriple?} */
const PAIR_RULES = new Map();
const pairKey = (a, b) => (ZHI.indexOf(a) <= ZHI.indexOf(b) ? a + b : b + a);
const addPair = (a, b, rule) => {
  const key = pairKey(a, b);
  PAIR_RULES.set(key, [...(PAIR_RULES.get(key) ?? []), rule]);
};
for (const [a, b, element] of LIU_HE_PAIRS) addPair(a, b, { kind: '六合', label: `六合（合${element}）` });
for (const [a, b] of LIU_CHONG_PAIRS) addPair(a, b, { kind: '六冲', label: '六冲' });
for (const [a, b] of [['子', '未'], ['丑', '午'], ['寅', '巳'], ['卯', '辰'], ['申', '亥'], ['酉', '戌']]) addPair(a, b, { kind: '六害', label: '六害' });
for (const [a, b] of [['子', '酉'], ['丑', '辰'], ['寅', '亥'], ['卯', '未'], ['巳', '申'], ['午', '戌']]) addPair(a, b, { kind: '六破', label: '六破' });
for (const [a, b] of [['寅', '丑'], ['午', '亥']]) addPair(a, b, { kind: '暗合', label: '暗合', pendingTeacherConfirm: true });
addPair('子', '卯', { kind: '相刑', label: '无礼之刑' });
for (const { members: [x, y, z], name } of SAN_XING) {
  for (const [a, b] of [[x, y], [y, z], [x, z]]) addPair(a, b, { kind: '相刑', label: name, inTriple: true });
}
for (const { members: [sheng, wang, mu], element } of SAN_HE) {
  addPair(sheng, wang, { kind: '生旺半合', label: `生旺半合（半合${element}）`, inTriple: true });
  addPair(wang, mu, { kind: '旺墓半合', label: `旺墓半合（半合${element}）`, inTriple: true });
  addPair(sheng, mu, { kind: '暗拱', label: `暗拱（拱${wang}）`, inTriple: true });
}
const pairRules = (a, b) => PAIR_RULES.get(pairKey(a, b)) ?? [];

const TRIPLE_COMBOS = [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]];

function makeRelation(kind, label, positions, branches, extra = {}) {
  const { code, stars, nature } = GRADE[kind];
  return {
    kind,
    label,
    code,
    stars,
    nature,
    category: positions.length >= 3 ? 'triple' : positions.length === 2 ? 'pair' : 'tag',
    positions,
    branches,
    layer: 'T00',
    source: SOURCE[kind],
    pendingTeacherConfirm: false,
    ...extra,
  };
}

/**
 * @param {Record<string,{zhi:string}>} pillars  键为 PILLAR_KEYS
 * @param {{selfPunish?:boolean}} [options]  selfPunish 默认开（老师模型口径）
 * @returns {object[]} Relation[]，见 contract.js
 */
export function branchRelations(pillars, { selfPunish = true } = {}) {
  const seq = PILLAR_KEYS.map((key) => ({ key, zhi: pillars[key].zhi }));
  const relations = [];
  // 已成三合局 / 三刑的两两组合，不再重复标半合 / 相刑
  const coveredByTriple = new Set();

  for (const combo of TRIPLE_COMBOS) {
    const zhis = combo.map((i) => seq[i].zhi);
    const set = new Set(zhis);
    if (set.size !== 3) continue;
    const positions = combo.map((i) => seq[i].key);
    // 三支占据连续三柱为「相连」，否则「有隔」；老师文档未给三支距离档，这是最小口径（PRD BR-9）
    const distance = { label: combo[2] - combo[0] === 2 ? '三支相连' : '三支有隔' };
    const matchGroup = (groups) => groups.find((g) => g.members.every((m) => set.has(m)));
    const cover = () => { for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) coveredByTriple.add(`${combo[a]}-${combo[b]}`); };

    const hui = matchGroup(SAN_HUI);
    if (hui) relations.push(makeRelation('三会', `三会（会${hui.element}）`, positions, zhis, { distance }));
    const he = matchGroup(SAN_HE);
    if (he) { relations.push(makeRelation('三合', `三合（合${he.element}局）`, positions, zhis, { distance })); cover(); }
    const xing = matchGroup(SAN_XING);
    if (xing) { relations.push(makeRelation('三刑', `三刑（${xing.name}）`, positions, zhis, { distance, note: xing.note })); cover(); }
  }

  for (let i = 0; i < seq.length; i++) {
    for (let j = i + 1; j < seq.length; j++) {
      const a = seq[i].zhi;
      const b = seq[j].zhi;
      const positions = [seq[i].key, seq[j].key];
      const branches = [a, b];
      const distance = DISTANCE[j - i];

      if (a === b) {
        relations.push(makeRelation('伏吟', '伏吟', positions, branches, { distance }));
        if (selfPunish && SELF_PUNISH.has(a)) relations.push(makeRelation('自刑', '自刑', positions, branches, { distance }));
        continue;
      }
      for (const rule of pairRules(a, b)) {
        if (rule.inTriple && coveredByTriple.has(`${i}-${j}`)) continue;
        relations.push(makeRelation(rule.kind, rule.label, positions, branches, {
          distance,
          pendingTeacherConfirm: Boolean(rule.pendingTeacherConfirm),
        }));
      }
    }
  }

  // 争合：某支的六合对象在其余柱里出现两次以上。加标，不替代那两条六合
  for (const target of seq) {
    const suitors = seq.filter((p) => p.key !== target.key && p.zhi === LIU_HE[target.zhi]);
    if (suitors.length >= 2) {
      relations.push(makeRelation('争合', '争合', [target.key, ...suitors.map((p) => p.key)], [target.zhi, ...suitors.map((p) => p.zhi)]));
    }
  }

  for (const p of seq) {
    if (TOMB[p.zhi]) relations.push(makeRelation('墓库', TOMB[p.zhi], [p.key], [p.zhi]));
  }

  return relations.sort((x, y) =>
    GRADE[x.kind].rank - GRADE[y.kind].rank || PILLAR_KEYS.indexOf(x.positions[0]) - PILLAR_KEYS.indexOf(y.positions[0]));
}
