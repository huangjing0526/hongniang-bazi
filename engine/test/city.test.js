import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupCity } from '../src/city.js';
import cities from '../data/cities.json' with { type: 'json' };

// 断言查询行为与数据完整性，不锁具体坐标——换数据源不该让测试变红。
// 坐标本身的正确性靠下面的范围/一致性检查兜底。

test('城市按省市区县模糊查询且空查询不返回全表', () => {
  assert.ok(lookupCity('兰州').length >= 1);
  assert.match(lookupCity('城关区')[0].name, /城关区/);
  assert.ok(lookupCity('广东省').length >= 5);
  assert.deepEqual(lookupCity('  '), []);
  assert.deepEqual(lookupCity(''), []);
});

test('层级排序 · 短查询先出省市级而不是深层区县', () => {
  assert.equal(lookupCity('兰州')[0].name, '甘肃省 兰州市');
  assert.equal(lookupCity('乌鲁木齐')[0].name, '新疆维吾尔自治区 乌鲁木齐市');
});

test('数据完整性 · 覆盖度与坐标合法范围', () => {
  assert.ok(cities.length > 3000, `期望 3000+ 条，实得 ${cities.length}`);
  const bad = cities.filter(
    (c) => !c.name || !(c.lng >= 73 && c.lng <= 136) || !(c.lat >= 3 && c.lat <= 54),
  );
  assert.deepEqual(bad, [], '存在名称缺失或经纬度落在中国境外的条目');
  assert.equal(new Set(cities.map((c) => c.name)).size, cities.length, '展示名必须唯一');
});

test('真太阳时关键城市 · 经度量级正确（西部必须显著小于 120）', () => {
  const at = (q) => lookupCity(q)[0].lng;
  assert.ok(at('乌鲁木齐市') < 90, '乌鲁木齐经度应在 90 以下');
  assert.ok(at('甘肃省 兰州市') < 106, '兰州经度应在 106 以下');
  assert.ok(Math.abs(at('浙江省 杭州市 上城区') - 120) < 1, '杭州上城区应贴近 120 度线');
});
