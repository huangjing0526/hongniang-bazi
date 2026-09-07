import cities from '../data/cities.json' with { type: 'json' };

const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');

// 行政区划后缀。长的放前面，否则「自治区」会先被 `区` 吃掉一截。
// scripts/build-cities.mjs 也用它对 GeoNames 的名字取词干，两边必须是同一份。
export const SUFFIX = /(特别行政区|自治区|自治州|自治县|自治旗|林区|特区|新区|矿区|省|市|区|县|旗|盟)$/;
const bare = (segment) => segment.replace(SUFFIX, '') || segment;

// 直辖市。老师搜「朝阳」十有八九找的是北京朝阳区，不是辽宁朝阳市。
const MUNICIPALITIES = new Set(['北京市', '上海市', '天津市', '重庆市']);

/** 展示名按空格分段：省 / 市 / 区县 */
const segmentsOf = (name) => String(name).trim().split(/\s+/).filter(Boolean);

/** 段名与查询是否指同一个地方（「朝阳」「朝阳区」「朝阳市」视为同一个） */
function sameName(segment, query) {
  return segment === query || bare(segment) === query
    || segment === bare(query) || bare(segment) === bare(query);
}

/**
 * 匹配质量。
 * - exact：查询指的就是这个地方本身（末段同名，或旧名同名——「新建县」就是「新建区」）
 * - child：查询指的是它的上级（某一非末段同名），它是下辖的一个区县
 * - loose：只是名字里出现了这几个字，说不好是不是同一回事
 * @param {{name:string,aliases?:string[]}} city 名录条目
 */
export function cityMatchQuality(city, query) {
  const q = normalize(query);
  const segs = segmentsOf(city.name);
  if (segs.length && sameName(normalize(segs[segs.length - 1]), q)) return 'exact';
  if ((city.aliases ?? []).some((a) => sameName(normalize(a), q))) return 'exact';
  if (segs.slice(0, -1).some((s) => sameName(normalize(s), q))) return 'child';
  return 'loose';
}

/** 查询是否命中这一条：展示名或旧名里出现这几个字 */
function matches(city, keyword) {
  return normalize(city.name).includes(keyword)
    || (city.aliases ?? []).some((a) => normalize(a).includes(keyword));
}

const QUALITY_SCORE = { exact: 100, child: 50, loose: 0 };

/**
 * 按省、市、区县做不区分空格的模糊匹配，并排序。
 *
 * 原来是裸 `includes` + 数据原始顺序：搜「朝阳」命中 10 条，北京朝阳区排第 10，
 * 而下拉只显示前几条——老师根本找不到北京朝阳。排序按三档打分：
 * 末段同名 > 上级同名（下辖区县）> 只是字面命中；直辖市加权；同分时短名在前。
 */
export function lookupCity(query) {
  const keyword = normalize(query);
  if (!keyword) return [];

  return cities
    .filter((city) => matches(city, keyword))
    .map((city) => {
      const segs = segmentsOf(city.name);
      const score = QUALITY_SCORE[cityMatchQuality(city, keyword)]
        + (MUNICIPALITIES.has(segs[0]) ? 20 : 0);
      return { city, score, segs };
    })
    .sort((a, b) => b.score - a.score
      || a.segs.length - b.segs.length
      || a.city.name.length - b.city.name.length
      || a.city.name.localeCompare(b.city.name, 'zh'))
    .map((r) => r.city);
}

/**
 * 把一个地名词条解析成唯一的一个地方，并说明有没有把握。
 * 批量粘贴要用它：原来直接取第一条，「朝阳」会静默变成辽宁朝阳市，
 * 和北京朝阳区差 14 分钟时差——正好是能翻掉一个时辰的量级，还不吭声。
 *
 * @returns {{city: object|null, candidates: object[], ambiguous: boolean}}
 *          ambiguous 为真时调用方**必须**让人来确认，不能默默用 city
 */
export function resolveCity(query) {
  const candidates = lookupCity(query);
  if (candidates.length === 0) return { city: null, candidates: [], ambiguous: false };

  // 只有一条候选就没什么可歧义的（「浦东」只对得上浦东新区）。
  // 多条时看「就是它本身」那一档跨不跨省：跨省才是真要人来选的歧义。
  const exact = candidates.filter((c) => cityMatchQuality(c, query) === 'exact');
  const provinces = new Set(exact.map((c) => segmentsOf(c.name)[0]));
  const ambiguous = candidates.length > 1 && (exact.length === 0 || provinces.size > 1);

  return { city: candidates[0], candidates, ambiguous };
}
