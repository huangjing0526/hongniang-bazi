// Classical lookup tables. Sources: 《渊海子平》(五鼠遁/五虎遁/十神/十二长生),
// 《三命通会》. Kept as our own data so nothing derives from a GPL implementation.

export const GAN = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
export const ZHI = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];

// element index: 0木 1火 2土 3金 4水
export const GAN_ELEMENT = { 甲:0, 乙:0, 丙:1, 丁:1, 戊:2, 己:2, 庚:3, 辛:3, 壬:4, 癸:4 };
// true = 阳
export const GAN_YANG = { 甲:true, 乙:false, 丙:true, 丁:false, 戊:true, 己:false, 庚:true, 辛:false, 壬:true, 癸:false };

export const ELEMENT_NAME = ['木','火','土','金','水'];
export const ZHI_ELEMENT = { 子:4, 丑:2, 寅:0, 卯:0, 辰:2, 巳:1, 午:1, 未:2, 申:3, 酉:3, 戌:2, 亥:4 };

/** 天干五合（含所合五行）与天干相冲。只是查表事实；化不化、冲得动与否属判定层。 */
export const GAN_HE_PAIRS = [['甲','己','土'], ['乙','庚','金'], ['丙','辛','水'], ['丁','壬','木'], ['戊','癸','火']];
export const GAN_CHONG_PAIRS = [['甲','庚'], ['乙','辛'], ['丙','壬'], ['丁','癸']];

/**
 * 两个五行之间的关系，以 a 为主语：同 / 生（a 生 b）/ 被生（b 生 a）/ 克（a 克 b）/ 被克（b 克 a）。
 * 元素序 木火土金水 是相生序，相邻即生，隔一即克。
 */
export function elementRelation(a, b) {
  const d = (b - a + 5) % 5;
  return ['同', '生', '克', '被克', '被生'][d];
}

/** Hidden stems of each branch, 本气 first then 余气/杂气. */
export const HIDE_GAN = {
  子:['癸'], 丑:['己','癸','辛'], 寅:['甲','丙','戊'], 卯:['乙'],
  辰:['戊','乙','癸'], 巳:['丙','庚','戊'], 午:['丁','己'], 未:['己','丁','乙'],
  申:['庚','壬','戊'], 酉:['辛'], 戌:['戊','辛','丁'], 亥:['壬','甲'],
};

/** 六合六对与合化五行；六冲六对。地支关系表与神煞表共用，别各自再抄一份。 */
export const LIU_HE_PAIRS = [['子','丑','土'], ['寅','亥','木'], ['卯','戌','火'], ['辰','酉','金'], ['巳','申','水'], ['午','未','土']];
export const LIU_CHONG_PAIRS = [['子','午'], ['丑','未'], ['寅','申'], ['卯','酉'], ['辰','戌'], ['巳','亥']];
const symmetric = (pairs) => Object.fromEntries(pairs.flatMap(([a, b]) => [[a, b], [b, a]]));
/** 某支的六合对象 / 六冲对象，两个方向都查得到。 */
export const LIU_HE = symmetric(LIU_HE_PAIRS);
export const LIU_CHONG = symmetric(LIU_CHONG_PAIRS);

/** 十二长生 order. */
export const CHANG_SHENG = ['长生','沐浴','冠带','临官','帝旺','衰','病','死','墓','绝','胎','养'];
/** Branch where each stem begins 长生. 阳干顺行，阴干逆行。 */
export const CHANG_SHENG_START = {
  甲:'亥', 乙:'午', 丙:'寅', 丁:'酉', 戊:'寅',
  己:'酉', 庚:'巳', 辛:'子', 壬:'申', 癸:'卯',
};

/**
 * 十神 of `other` stem seen from `me` (the day stem).
 * 同我=比劫 我生=食伤 我克=财 克我=官杀 生我=印
 */
export function shiShen(me, other) {
  const a = GAN_ELEMENT[me];
  const b = GAN_ELEMENT[other];
  const same = GAN_YANG[me] === GAN_YANG[other];
  const diff = (b - a + 5) % 5; // 0 同 1 我生 2 我克 3 克我 4 生我
  switch (diff) {
    case 0: return same ? '比肩' : '劫财';
    case 1: return same ? '食神' : '伤官';
    case 2: return same ? '偏财' : '正财';
    case 3: return same ? '七杀' : '正官';
    default: return same ? '偏印' : '正印';
  }
}

/** 十二长生 of `gan` sitting on `zhi`. */
export function changSheng(gan, zhi) {
  const start = ZHI.indexOf(CHANG_SHENG_START[gan]);
  const idx = ZHI.indexOf(zhi);
  const step = GAN_YANG[gan] ? (idx - start + 12) % 12 : (start - idx + 12) % 12;
  return CHANG_SHENG[step];
}

/**
 * 干支是否构成六十甲子中的一支。
 * 阳干只配阳支、阴干只配阴支，所以 10×12 里只有 60 种合法组合——
 * 老师用两个下拉选出「甲丑」这种不存在的组合时，要在提交前拦住。
 */
export function isValidGanZhi(gan, zhi) {
  const g = GAN.indexOf(gan);
  const z = ZHI.indexOf(zhi);
  if (g < 0 || z < 0) return false;
  return g % 2 === z % 2;
}
