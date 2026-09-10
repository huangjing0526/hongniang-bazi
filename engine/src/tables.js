// Classical lookup tables. Sources: 《渊海子平》(五鼠遁/五虎遁/十神/十二长生),
// 《三命通会》. Kept as our own data so nothing derives from a GPL implementation.

export const GAN = ['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'];
export const ZHI = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];

// element index: 0木 1火 2土 3金 4水
export const GAN_ELEMENT = { 甲:0, 乙:0, 丙:1, 丁:1, 戊:2, 己:2, 庚:3, 辛:3, 壬:4, 癸:4 };
// true = 阳
export const GAN_YANG = { 甲:true, 乙:false, 丙:true, 丁:false, 戊:true, 己:false, 庚:true, 辛:false, 壬:true, 癸:false };

export const ELEMENT_NAME = ['木','火','土','金','水'];

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
