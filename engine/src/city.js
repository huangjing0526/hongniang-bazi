import cities from '../data/cities.json' with { type: 'json' };

const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');

/** 按省、市、区县展示名做不区分空格的模糊匹配。 */
export function lookupCity(query) {
  const keyword = normalize(query);
  if (!keyword) return [];
  return cities.filter((city) => normalize(city.name).includes(keyword));
}
