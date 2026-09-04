import test from 'node:test';
import assert from 'node:assert/strict';
import { computeChart } from '../src/chart.js';
import { applyShenSha } from '../src/shensha.js';

test('冻结神煞黄金命例逐柱命中', () => {
  const chart = computeChart({ year:1996, month:8, day:10, hour:12, minute:3, longitude:120, applyTrueSolar:false, gender:'female' }).charts[0];
  const names = (key) => chart.pillars[key].shenSha.map((entry) => entry.name);
  for (const [key, expected] of Object.entries({
    year:['天乙贵人','福星贵人','德秀贵人','桃花'],
    month:['天乙贵人','文昌贵人','德秀贵人','学堂','金舆','劫煞'],
    day:['太极贵人','德秀贵人','勾绞煞','红鸾','九丑日'],
    time:['禄神','流霞','灾煞'],
  })) for (const name of expected) assert.ok(names(key).includes(name), `${key} 柱缺少${name}`);
  for (const key of ['year','month','day','time']) for (const entry of chart.pillars[key].shenSha) {
    assert.equal(typeof entry.source, 'string');
    assert.equal(entry.pendingTeacherConfirm, ['德秀贵人','福星贵人','学堂'].includes(entry.name));
  }
});

test('桃花查法可配置，默认同时查年支和日支', () => {
  const makePillars = () => ({
    year:{gan:'甲',zhi:'子',ganZhi:'甲子'}, month:{gan:'乙',zhi:'酉',ganZhi:'乙酉'},
    day:{gan:'丙',zhi:'卯',ganZhi:'丙卯'}, time:{gan:'丁',zhi:'午',ganZhi:'丁午'},
  });
  const defaultPillars = applyShenSha(makePillars());
  assert.ok(defaultPillars.year.shenSha.some((entry) => entry.name === '桃花'));
  const yearOnly = applyShenSha(makePillars(), { peachBlossomReferences:['year'] });
  assert.ok(!yearOnly.year.shenSha.some((entry) => entry.name === '桃花'));
});

test('冻结名单恰为指定二十一项且合婚六项均可命中', () => {
  const found = new Set();
  for (let year = 1990; year <= 2005; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const chart = computeChart({year,month,day:15,hour:12,minute:0,applyTrueSolar:false}).charts[0];
      for (const pillar of Object.values(chart.pillars)) for (const entry of pillar.shenSha) found.add(entry.name);
    }
  }
  const expected = ['天乙贵人','文昌贵人','桃花','红鸾','禄神','金舆','学堂','福星贵人','太极贵人','德秀贵人','劫煞','灾煞','勾绞煞','流霞','九丑日','天喜','孤辰','寡宿','阴差阳错','驿马','羊刃'];
  assert.deepEqual([...found].sort(), expected.sort());
});
