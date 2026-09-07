import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupCity, resolveCity } from '../src/city.js';
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
  // 民政部 2023 年表县级 2842 + 地级 333 + 省级 31；掉到 3100 以下说明名录源换错了
  assert.ok(cities.length > 3100, `期望 3100+ 条，实得 ${cities.length}`);
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

test('加权排序 · 直辖市同名区排在外省同名市之前', () => {
  // 「朝阳」命中 10 条，北京朝阳区在数据里排最后一条。老师搜朝阳要的多半是它，
  // 排序坏掉时它会被下拉的条数上限截掉，等于搜不到。
  assert.equal(lookupCity('朝阳')[0].name, '北京市 北京市 朝阳区');
  assert.equal(lookupCity('浦东')[0].name, '上海市 上海市 浦东新区');
});

test('resolveCity · 跨省同名才算歧义，独苗与同省父子不算', () => {
  assert.equal(resolveCity('朝阳').ambiguous, true, '朝阳跨北京/辽宁/吉林，必须让人来选');
  assert.equal(resolveCity('兰州').ambiguous, false, '兰州市与其下辖区县同属甘肃，不算歧义');
  assert.equal(resolveCity('北京').ambiguous, false);
  assert.equal(resolveCity('浦东').ambiguous, false, '只有一条候选，无从歧义');

  const none = resolveCity('并不存在的地名');
  assert.equal(none.city, null);
  assert.equal(none.ambiguous, false, '查不到是「未知」，不是「歧义」，两者处理方式不同');
});

test('名录以民政部为准 · 新设区县查得到，撤县设区的旧名走别名', () => {
  // 2026-09-07 老师反馈：南昌红谷滩区（2019 年设）搜不到——GeoNames 的 ADM 层没有它
  assert.equal(resolveCity('红谷滩').city?.name, '江西省 南昌市 红谷滩区');
  for (const q of ['姑苏区', '钱塘区', '浑南区', '潞州区']) {
    assert.ok(lookupCity(q).length >= 1, `${q} 应在名录里`);
  }
  // 新建县 2015 年改新建区：旧名也要认，而且是「就是它」那一档
  const r = resolveCity('新建县');
  assert.equal(r.city?.name, '江西省 南昌市 新建区');
  assert.equal(r.ambiguous, false);
  // 省名必须是中文的民政部写法，不能再出现日文
  assert.ok(cities.some((c) => c.name.startsWith('内蒙古自治区 ')));
  assert.ok(!cities.some((c) => /[ぁ-ヿ]/.test(c.name)), '名录里不该有日文');
  // 坐标兜底的条目极少，多了就是构建脚本的匹配坏了
  const approx = cities.filter((c) => c.approx);
  assert.ok(approx.length <= 5, `approx 条目过多：${approx.map((c) => c.name).join('、')}`);
});
