import { LIU_CHONG } from './tables.js';
// 冻结神煞表。口诀采用通行古法整理，数据与判断逻辑均为本项目自研。
const STEM_RULES = {
  天乙贵人: { 甲: '丑未', 乙: '子申', 丙: '亥酉', 丁: '亥酉', 戊: '丑未', 己: '子申', 庚: '丑未', 辛: '寅午', 壬: '卯巳', 癸: '卯巳' },
  文昌贵人: { 甲: '巳', 乙: '午', 丙: '申', 丁: '酉', 戊: '申', 己: '酉', 庚: '亥', 辛: '子', 壬: '寅', 癸: '卯' },
  禄神: { 甲: '寅', 乙: '卯', 丙: '巳', 丁: '午', 戊: '巳', 己: '午', 庚: '申', 辛: '酉', 壬: '亥', 癸: '子' },
  金舆: { 甲: '辰', 乙: '巳', 丙: '未', 丁: '申', 戊: '未', 己: '申', 庚: '戌', 辛: '亥', 壬: '丑', 癸: '寅' },
  学堂: { 甲: '亥', 乙: '亥', 丙: '寅', 丁: '寅', 戊: '申', 己: '申', 庚: '巳', 辛: '巳', 壬: '申', 癸: '申' },
  福星贵人: { 甲: '寅子', 乙: '丑亥', 丙: '子戌', 丁: '亥酉', 戊: '申', 己: '未', 庚: '午', 辛: '巳', 壬: '辰', 癸: '卯' },
  太极贵人: { 甲: '子午', 乙: '子午', 丙: '卯酉', 丁: '卯酉', 戊: '辰戌丑未', 己: '辰戌丑未', 庚: '寅亥', 辛: '寅亥', 壬: '巳申', 癸: '巳申' },
  流霞: { 甲: '酉', 乙: '戌', 丙: '未', 丁: '申', 戊: '巳', 己: '午', 庚: '辰', 辛: '卯', 壬: '亥', 癸: '寅' },
  羊刃: { 甲: '卯', 乙: '寅', 丙: '午', 丁: '巳', 戊: '午', 己: '巳', 庚: '酉', 辛: '申', 壬: '子', 癸: '亥' },
};

const SOURCES = {
  天乙贵人: '日干查四支，甲戊庚牛羊，乙己鼠猴乡', 文昌贵人: '年干或日干查四支，甲乙巳午报君知，丙戊申宫丁己鸡',
  桃花: '年支或日支查四支，申子辰在酉，寅午戌在卯，巳酉丑在午，亥卯未在子', 红鸾: '年支查四支，子年起卯逆数十二支',
  天喜: '年支查四支，红鸾对冲为天喜', 禄神: '日干查四支，甲禄在寅乙禄卯', 金舆: '日干查四支，甲龙乙蛇丙戊羊',
  学堂: '长生为学堂（临官为词馆）。《三命通会·论学堂词馆》：土命学堂在申、正者戊申。见寅/戊寅是另一套「官贵学堂」（戊己取官星木之长生），两套不要合成一句口诀。本表走纳音长生一系', 福星贵人: '短歌「甲丙相邀入虎乡，更游鼠穴最高强」，年干或日干查四支。另有《渊海子平》长歌与《三命通会》「真食神」一系（乙见亥、丙见戌、丁见酉），且《三命通会》明言该歌**以年论**，日遁则非。本表走短歌，年日均查',
  太极贵人: '年干或日干查四支，甲乙生人子午中，丙丁鸡兔定亨通', 德秀贵人: '《三命通会·论德秀》月令三合起，查四柱天干：寅午戌月丙丁为德、戊癸为秀；申子辰月壬癸戊己为德、丙辛甲己为秀；巳酉丑月庚辛为德、乙庚为秀；亥卯未月甲乙为德、丁壬为秀。**原文未写德秀必须同见**，「同见才算」是后起加严，本表默认见一即算',
  劫煞: '年支或日支三合查四支，申子辰见巳，亥卯未见申', 灾煞: '年支或日支三合查四支，申子辰见午，亥卯未见酉',
  勾绞煞: '年支查四支，阳男阴女命前三辰为勾、命后三辰为绞（本表并列取两支）', 流霞: '日干查四支，甲鸡乙犬丙羊加',
  九丑日: '日柱查固定表，戊子戊午己酉己卯等九日', 孤辰: '年支查四支，亥子丑见寅，寅卯辰见巳',
  寡宿: '年支查四支，亥子丑见戌，寅卯辰见丑', 阴差阳错: '日柱查固定十二日', 驿马: '年支或日支三合查四支，申子辰马在寅',
  羊刃: '日干查四支。阳干取禄的顺行下一位（甲禄寅→刃卯、丙戊禄巳→刃午、庚禄申→刃酉、壬禄亥→刃子），各家一致。**阴干分歧最大，至少三派**：①阴干无刃（子平正统只论阳刃）；②顺行，乙辰丁己未辛戌癸丑（《三命通会》一系）；③逆行，乙寅丁己巳辛申癸亥。**本表用第③派**，与前两派结果不同，请老师确认',
};

const GROUP_RULES = {
  桃花: { '申子辰': '酉', '寅午戌': '卯', '巳酉丑': '午', '亥卯未': '子' },
  劫煞: { '申子辰': '巳', '寅午戌': '亥', '巳酉丑': '寅', '亥卯未': '申' },
  灾煞: { '申子辰': '午', '寅午戌': '子', '巳酉丑': '卯', '亥卯未': '酉' },
  驿马: { '申子辰': '寅', '寅午戌': '申', '巳酉丑': '亥', '亥卯未': '巳' },
};
const RED_LUAN = { 子:'卯', 丑:'寅', 寅:'丑', 卯:'子', 辰:'亥', 巳:'戌', 午:'酉', 未:'申', 申:'未', 酉:'午', 戌:'巳', 亥:'辰' };
const OPPOSITE = LIU_CHONG;
const LONELY = { '亥子丑':['寅','戌'], '寅卯辰':['巳','丑'], '巳午未':['申','辰'], '申酉戌':['亥','未'] };
const DE_XIU = { '寅午戌':'丙丁戊癸', '申子辰':'壬癸戊己丙辛甲', '巳酉丑':'庚辛乙戊', '亥卯未':'甲乙丁壬' };
const NINE_UGLY = new Set(['戊子','戊午','己酉','己卯','乙酉','乙卯','辛酉','辛卯','壬子']);
const YIN_YANG_ERROR = new Set(['丙子','丁丑','戊寅','辛卯','壬辰','癸巳','丙午','丁未','戊申','辛酉','壬戌','癸亥']);
// 标记为「表源待老师确认」：前三条见 §7.3；羊刃是 2026-09-03 集成时补的——
// 阴干羊刃至少三派且结果互不相同，本表选了逆行一派，不该默认当唯一答案。
const PENDING = new Set(['德秀贵人', '福星贵人', '学堂', '羊刃']);

/** 待老师确认表源的神煞，带各自的分歧说明。裁定表单据此列「神煞表源异议」的选项。 */
export const PENDING_SHENSHA = [...PENDING].map((name) => ({ name, source: SOURCES[name] }));

function groupTarget(ruleName, reference) {
  return Object.entries(GROUP_RULES[ruleName]).find(([group]) => group.includes(reference))?.[1];
}

function item(name) {
  return { name, source: SOURCES[name], pendingTeacherConfirm: PENDING.has(name) };
}

/** 将冻结表挂到四柱；桃花默认同时按年支、日支查。 */
export function applyShenSha(pillars, options = {}) {
  const keys = ['year', 'month', 'day', 'time'];
  const yearGan = pillars.year.gan;
  const dayGan = pillars.day.gan;
  const yearZhi = pillars.year.zhi;
  const dayZhi = pillars.day.zhi;
  const peachReferences = options.peachBlossomReferences ?? ['year', 'day'];
  const peachZhi = peachReferences.map((reference) => reference === 'year' ? yearZhi : dayZhi);
  const branchReferences = [yearZhi, dayZhi];
  const lonely = Object.entries(LONELY).find(([group]) => group.includes(yearZhi))?.[1];
  const deXiuStems = Object.entries(DE_XIU).find(([group]) => group.includes(pillars.month.zhi))?.[1] ?? '';
  const branches = '子丑寅卯辰巳午未申酉戌亥';
  const yearIndex = branches.indexOf(yearZhi);
  const hookBranches = [branches[(yearIndex + 3) % 12], branches[(yearIndex + 9) % 12]];
  for (const key of keys) {
    const pillar = pillars[key];
    const names = [];
    for (const name of ['天乙贵人','禄神','金舆','学堂','流霞','羊刃']) {
      if (STEM_RULES[name][dayGan]?.includes(pillar.zhi)) names.push(name);
    }
    for (const name of ['文昌贵人','福星贵人','太极贵人']) {
      if ([yearGan, dayGan].some((gan) => STEM_RULES[name][gan]?.includes(pillar.zhi))) names.push(name);
    }
    if (peachZhi.some((reference) => groupTarget('桃花', reference) === pillar.zhi)) names.push('桃花');
    if (RED_LUAN[yearZhi] === pillar.zhi) names.push('红鸾');
    if (OPPOSITE[RED_LUAN[yearZhi]] === pillar.zhi) names.push('天喜');
    for (const name of ['劫煞','灾煞','驿马']) if (branchReferences.some((reference) => groupTarget(name, reference) === pillar.zhi)) names.push(name);
    if (lonely?.[0] === pillar.zhi) names.push('孤辰');
    if (lonely?.[1] === pillar.zhi) names.push('寡宿');
    if (hookBranches.includes(pillar.zhi)) names.push('勾绞煞');
    if (deXiuStems.includes(pillar.gan)) names.push('德秀贵人');
    if (key === 'day' && NINE_UGLY.has(pillar.ganZhi)) names.push('九丑日');
    if (key === 'day' && YIN_YANG_ERROR.has(pillar.ganZhi)) names.push('阴差阳错');
    pillar.shenSha = [...new Set(names)].map(item);
  }
  return pillars;
}
