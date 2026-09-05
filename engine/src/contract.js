// ============================================================================
// 接口契约 · 2026-09-03 冻结
//
// 这个文件是三条并行轨道之间唯一的约定。engine / web / 数据 三方都按它写，
// 任何一方要改形状，先回来改这里并知会另外两方，不要各自扩字段。
//
// 只放形状与常量，不放业务逻辑。
// ============================================================================

/** 四柱的键，顺序固定。表格列序也用它。 */
export const PILLAR_KEYS = /** @type {const} */ (['year', 'month', 'day', 'time']);

/** 细盘行序（§7.2，老师肌肉记忆，勿改）。神煞永远在最后一行。 */
export const DETAIL_ROWS = /** @type {const} */ ([
  'zhuXing', 'gan', 'zhi', 'cangGan', 'fuXing', 'xingYun', 'ziZuo', 'xunKong', 'naYin', 'shenSha',
]);

export const ROW_LABELS = {
  zhuXing: '主星', gan: '天干', zhi: '地支', cangGan: '藏干', fuXing: '副星',
  xingYun: '星运', ziZuo: '自坐', xunKong: '空亡', naYin: '纳音', shenSha: '神煞',
};

/**
 * @typedef {object} ShenSha
 * @property {string} name    神煞名，如「天乙贵人」
 * @property {string} source  口诀出处，点击时展示，如「日干查四支，甲戊庚牛羊」
 * @property {boolean} pendingTeacherConfirm  §7.3 标了「待老师确认」的三张表为 true
 */

/**
 * @typedef {object} Pillar
 * @property {string} ganZhi
 * @property {string} gan
 * @property {string} zhi
 * @property {string} naYin
 * @property {string} xunKong
 * @property {string} zhuXing   日柱为「元男」/「元女」，非十神
 * @property {string[]} cangGan
 * @property {string[]} fuXing  与 cangGan 等长、同序
 * @property {string} xingYun   日干 vs 本柱地支
 * @property {string} ziZuo     本柱天干 vs 本柱地支（≠ xingYun，勿混）
 * @property {ShenSha[]} shenSha
 */

/** 分歧风险种类。§7.2 第一屏常驻条只认这几种，不要新增而不通知前端。 */
export const RISK_KIND = /** @type {const} */ ({
  DST: 'dst',                 // 落在 1986–1991 夏令时窗口
  DST_FOLD: 'dst_fold',       // 夏令时结束日重复小时，输出双盘
  DST_GAP: 'dst_gap',         // 夏令时起始日被跳过的小时，输入存疑
  TRUE_SOLAR: 'true_solar',   // 真太阳时偏移足以跨时辰
  ZI_SHI: 'zi_shi',           // 23:00–01:00，子时两派日柱不同
  JIE_QI: 'jie_qi',           // 距交节 < 6 小时
  CITY_UNKNOWN: 'city_unknown', // 出生地没落实，经度按 120 度顶着算
});

export const RISK_LEVEL = /** @type {const} */ ({ INFO: 'info', WARN: 'warn' });

/**
 * @typedef {object} Risk
 * @property {string} kind     RISK_KIND 之一
 * @property {string} level    RISK_LEVEL 之一
 * @property {string} message  给老师看的一句话，中文，不含术语缩写
 * @property {string[]} affects  受影响的柱，PILLAR_KEYS 子集
 */

/**
 * @typedef {object} AuditStep
 * @property {string} step   如「经度差」
 * @property {string} value  如「(103.82 − 120) × 4 = -64.7 分钟」
 * @property {string} note   如「已应用」
 */

/**
 * 引擎对外的唯一返回形状。web 只消费这个，不读引擎内部。
 * @typedef {object} Chart
 * @property {object} input
 * @property {{clock:object, beijing:object, trueSolar:object}} times
 * @property {string} lunar
 * @property {string} ganZhi              空格分隔的四柱
 * @property {Record<string, Pillar>} pillars   键为 PILLAR_KEYS
 * @property {AuditStep[]} audit
 * @property {Risk[]} risks
 */

/**
 * @typedef {object} ComputeResult
 * @property {Chart[]} charts    长度 >1 仅当夏令时重复小时且 timeFold 未知
 * @property {string[]} warnings
 */

/**
 * 城市条目。经度东正西负，与 §12.2 的偏移公式一致。
 * @typedef {object} City
 * @property {string} name   「甘肃省 兰州市 城关区」，用于展示与搜索
 * @property {number} lng
 * @property {number} lat
 */

/** 老师裁定（§13.2）。web 采集，先存 localStorage，B 档不做账号。 */
export const TIME_SOURCE = /** @type {const} */ ({
  CERT: '出生证',
  FAMILY: '家人口述',
  SELF: '客户自报',
});

// 干支两表与合法性判据从 tables.js 转出。web 侧的裁定表单要用它们做下拉与校验，
// 但不该伸手进引擎内部，也不该自己抄一份抄错——统一从契约这道门出去。
export { GAN, ZHI, isValidGanZhi } from './tables.js';

/**
 * 排盘口径快照。裁定必须带上它，否则事后无法复现老师当时看到的是哪一个盘：
 * 同一个人、同一组开关全关排出「庚午」，真太阳时一开排出「己巳」，
 * 老师说的「你们排对了」到底指哪一个，只有这四个字段能回答。
 * @typedef {object} ChartOptions
 * @property {boolean} applyTrueSolar
 * @property {boolean} applyDst
 * @property {number} sect        1 子初换日 / 2 早晚子时
 * @property {string} timeFold    unknown / first / second
 */

/**
 * @typedef {object} Verdict
 * @property {string} id       客户端 uuid，重复同步靠它去重
 * @property {string} chartId  **等于 cases.id**（见 caseIdOf）。命例表与裁定表只靠它 join，
 *                             两边必须由同一个函数生成，不要在别处另拼一个格式
 * @property {string[]} disputedPillars  PILLAR_KEYS 子集；空数组表示「与我们一致」
 * @property {Record<string,string>} teacherGanZhi  仅分歧柱，如 {time:'己巳'}；
 *                             勾了柱位就必须有值，空对象的裁定没有分析价值，前端拦住
 * @property {string} ourGanZhi  工具当时排出的四柱，空格分隔。存下来才能免去事后重算
 * @property {ChartOptions} options  当时的三个开关 + 双盘分支
 * @property {string} cityName   当时的出生地展示名
 * @property {number} longitude  当时用的经度
 * @property {string} school   依据流派，自由文本，可空
 * @property {string} timeSource  TIME_SOURCE 之一 —— 唯一能分开 L2 与 L1/L3 的字段，必填，无默认值
 * @property {string} reason
 * @property {string} createdAt  ISO
 */

/** 运行期自检：形状不对就早失败，别让错数据流到前端。 */
export function assertChart(chart) {
  for (const k of PILLAR_KEYS) {
    const p = chart.pillars?.[k];
    if (!p) throw new Error(`chart.pillars.${k} 缺失`);
    if (p.cangGan.length !== p.fuXing.length) {
      throw new Error(`${k} 柱藏干与副星长度不一致：${p.cangGan.length} vs ${p.fuXing.length}`);
    }
    if (!Array.isArray(p.shenSha)) throw new Error(`${k} 柱 shenSha 必须是数组（未实现时给空数组）`);
  }
  if (!Array.isArray(chart.risks)) throw new Error('chart.risks 必须是数组');
  if (!Array.isArray(chart.audit)) throw new Error('chart.audit 必须是数组');
  return chart;
}
