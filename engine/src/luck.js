// 大运流年 · REQ-005（一期，独立需求）
//
// 只做排：起运时长、交运时刻、十步大运、每步十个流年、起运前的小运。
// 不接老师《地支运算体系》的岁运权重，不判引动。
//
// 口径（两条都可切，第二条是分歧点）：
//   1. 起运的「出生时刻」与「交节时刻」都用标准北京时——与年柱、月柱交节的口径一致（chart.js 冻结）。
//      真太阳时只改日时柱，不改起运。
//   2. luckSect：1 = 整时辰折算（3 天 1 年、1 天 4 个月、1 时辰 10 天，尾数丢弃，交运只到日）；
//               2 = 按分钟折算（3 天 = 1 年，1 分钟 = 2 小时，交运到小时）。
//      默认 2（2026-09-11 一期决策 D-12：对齐问真样本「7 年 8 月 9 天 7 时」，一小时折五天，显示到时）。
//      录入到分钟、问真到秒，所以我们的小时数恒为偶数，与问真最多差 2 小时，接受。
//   小运（D-12）：从时柱起，男顺女逆，固定显示。历法库的小运是阳男阴女顺，与此不同，所以自己推。
//
// 历法底座 lunar-javascript 的 getYun / getDaYun / getLiuNian / getXiaoYun。大运干支由月柱顺逆推，
// 流年干支按立春换年，与本引擎年柱口径一致。

import { GAN, ZHI, HIDE_GAN, shiShen, changSheng } from './tables.js';

const GENDER_CODE = { male: 1, female: 0 };
const JIA_ZI = Array.from({ length: 60 }, (_, i) => GAN[i % 10] + ZHI[i % 12]);

/** 小运：时柱在六十甲子里的位置，男按虚岁往后数、女往前数 */
function xiaoYunGanZhi(timeGanZhi, age, gender) {
  const base = JIA_ZI.indexOf(timeGanZhi);
  const step = gender === 'female' ? -age : age;
  return JIA_ZI[((base + step) % 60 + 60) % 60];
}

function describeGanZhi(ganZhi, dayGan) {
  const gan = ganZhi[0];
  const zhi = ganZhi[1];
  return {
    ganZhi, gan, zhi,
    zhuXing: shiShen(dayGan, gan),
    cangGan: HIDE_GAN[zhi],
    fuXing: HIDE_GAN[zhi].map((g) => shiShen(dayGan, g)),
    xingYun: changSheng(dayGan, zhi),
  };
}

/**
 * @param {object} ec        lunar-javascript 的 EightChar（按北京时建的那份）
 * @param {string} dayGan    权威日干（日柱可能来自真太阳时那份，所以单独传）
 * @param {'male'|'female'} gender
 * @param {1|2} luckSect
 * @returns {object} Luck，见 contract.js
 */
export function computeLuck(ec, dayGan, gender, luckSect = 2) {
  const yun = ec.getYun(GENDER_CODE[gender] ?? 1, luckSect);
  const startSolar = yun.getStartSolar();
  const daYun = yun.getDaYun(10).map((d) => ({
    index: d.getIndex(),
    startYear: d.getStartYear(),
    endYear: d.getEndYear(),
    startAge: d.getStartAge(),
    endAge: d.getEndAge(),
    ...(d.getIndex() > 0 ? describeGanZhi(d.getGanZhi(), dayGan) : { ganZhi: '', gan: '', zhi: '' }),
    liuNian: d.getLiuNian().map((l) => ({
      year: l.getYear(),
      age: l.getAge(),
      ...describeGanZhi(l.getGanZhi(), dayGan),
    })),
    xiaoYun: d.getIndex() > 0 ? [] : d.getXiaoYun().map((x) => ({ year: x.getYear(), age: x.getAge(), ganZhi: xiaoYunGanZhi(ec.getTime(), x.getAge(), gender) })),
  }));
  return {
    forward: yun.isForward(),
    luckSect,
    start: { years: yun.getStartYear(), months: yun.getStartMonth(), days: yun.getStartDay(), hours: yun.getStartHour() },
    startAt: {
      year: startSolar.getYear(), month: startSolar.getMonth(), day: startSolar.getDay(),
      hour: startSolar.getHour(), minute: startSolar.getMinute(),
    },
    daYun,
  };
}
