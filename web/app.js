// web/app.js
// 红娘八字排盘 · 业务逻辑与 UI 控制层
// 中文注释，英文变量名/函数名 (Strict adherence to task guidelines)

import { computeChart } from '../engine/src/chart.js';
import { almanacPillars } from '../engine/src/calendar.js';
import { fmt } from '../engine/src/solartime.js';
import { mount as mountDateTimePicker } from './components/datetime-picker.js';
import { mount as mountRegionPicker } from './components/region-picker.js';
import { mountAlmanac, openAlmanacFromChart, renderAlmanac, syncAlmanacFromChart } from './calendar-page.js';
import {
  PILLAR_KEYS,
  DETAIL_ROWS,
  PILLAR_BRANCH_LABEL,
  PILLAR_PALACE,
  ROW_LABELS,
  TIME_SOURCE,
  RISK_KIND,
  RISK_LEVEL,
  GAN,
  ZHI,
  isValidGanZhi,
  PENDING_SHENSHA,
} from '../engine/src/contract.js';

// 五行映射表：用于天干、地支、藏干着色
const FIVE_ELEMENTS = {
  gan: {
    甲: { name: '木', class: 'wood' },
    乙: { name: '木', class: 'wood' },
    丙: { name: '火', class: 'fire' },
    丁: { name: '火', class: 'fire' },
    戊: { name: '土', class: 'earth' },
    己: { name: '土', class: 'earth' },
    庚: { name: '金', class: 'metal' },
    辛: { name: '金', class: 'metal' },
    壬: { name: '水', class: 'water' },
    癸: { name: '水', class: 'water' },
  },
  zhi: {
    寅: { name: '木', class: 'wood' },
    卯: { name: '木', class: 'wood' },
    巳: { name: '火', class: 'fire' },
    午: { name: '火', class: 'fire' },
    辰: { name: '土', class: 'earth' },
    戌: { name: '土', class: 'earth' },
    丑: { name: '土', class: 'earth' },
    未: { name: '土', class: 'earth' },
    申: { name: '金', class: 'metal' },
    酉: { name: '金', class: 'metal' },
    亥: { name: '水', class: 'water' },
    子: { name: '水', class: 'water' },
  },
};

// 柱位中文映射
const PILLAR_NAMES = {
  year: '年柱',
  month: '月柱',
  day: '日柱',
  time: '时柱',
};

const ALMANAC_RISK_KINDS = new Set([
  RISK_KIND.JIE_QI_DAY,
  RISK_KIND.JIE_QI,
  RISK_KIND.CALENDAR_MISMATCH,
  RISK_KIND.CALENDAR_UNVERIFIED,
]);

// 全局状态管理
const state = {
  // 当前排盘输入
  input: {
    name: 'Alanzhou',
    gender: 'female', // 'male' | 'female'
    year: 1996,
    month: 8,
    day: 10,
    hour: 12,
    minute: 3,
    cityName: '甘肃省 兰州市 城关区',
    longitude: 103.825,
    cityKnown: true,   // false 时经度是兜底的 120，引擎会单独报一条风险
    applyDst: false,        // 默认关，由老师按需开
    applyTrueSolar: false,  // 默认关；开启后兰州这类西部盘会跨时辰
    sect: 1,                // 本盘实际生效的子时流派：1 子初换日 / 2 早晚子时。由 runCompute 按下面两层定
    timeFold: 'unknown',
    selfPunish: true,       // 地支自刑：老师模型默认开，部分流派不认；只影响关系标注，不影响四柱
  },
  // 子时流派分两层。老师的口径是「出生日为 24 节气当天，默认按早晚子时」，
  // 这个「默认」是每盘的自动默认，不能吞掉老师手动切过的开关：
  //   sectPreference：老师手动选的、持久化的偏好（原来的 saved.sect）
  //   sectOverride：老师在**本盘**上手动切过的值；null 表示没动过，节气日自动取 2
  // 换盘（重新录入 / 载入命例 / 清空）时 override 清空，再按规则判一次。
  sectPreference: 1,
  sectOverride: null,
  // 本盘的子时流派是节气日规则自动切成早晚子时的（风险条据此改文案）
  sectAutoDefaulted: false,
  // 首屏那个内置样盘还挂着没被顶掉。为真时界面上要标「示例」，别让老师误当成真数据。
  showingSample: true,
  // 引擎计算输出结果
  currentResult: null,
  activeChartIndex: 0,
  // 三条口径各翻一次开关的比对结果（见 compareAllDimensions），风险条与对照页共用。
  // 只在 renderAll 开头刷新，读它的函数都在 renderAll 之后才跑。
  compare: [],
  // 本机命例列表。单个录入与批量粘贴写的是同一个列表——
  // 早先只有批量会进这里，于是单个录入的盘永远同步不上去，裁定成了无源之水。
  cases: [],
  activeCaseIndex: -1,
  // 历史裁定记录
  verdicts: [],
  // 老师在本机删掉的命例与裁定的 id。
  //
  // 同步是「全量推送 + 按主键 upsert」，只增不减：老师点了删除，本机没了，
  // 服务端那行还在——他删的等于没删。改选出生地会换 id，也会在服务端留下旧 id 的孤儿行。
  //
  // 用一份显式的退役名单，而不是让服务端拿「这次没推上来的都删掉」去反推：
  // 老师可能在手机和电脑上各开一份，反推会让一台设备的推送删掉另一台的记录。
  retired: { cases: [], verdicts: [] },
  // 城市检索缓存
  cities: [],
  lookupCityFn: null,
  resolveCityFn: null,
  // 云端同步。没登记过就是 'unregistered'——全程不联网，等老师自己点状态条填称呼；
  // 他也可以一直不填，那就退回 'local' 本机模式，记录只留在这台电脑上。
  teacher: { token: '', name: '' },
  sync: { status: 'unregistered', lastError: '', lastSyncedAt: '' },
};

// ============================================================================
// 1. 初始化与城市数据加载
// ============================================================================

// 城市库 253KB（gzip 53KB），只有老师查出生地和批量解析时才用得上，
// 所以不挡首盘。需要它的地方通过 whenCityDataReady() 等一下即可。
let cityDataPromise = null;

/** 启动加载（幂等），返回可等待的 promise */
function whenCityDataReady() {
  if (!cityDataPromise) cityDataPromise = initCityData();
  return cityDataPromise;
}

/** 尝试导入或异步加载城市库，支持优雅降级 */
async function initCityData() {
  try {
    const cityModule = await import('../engine/src/city.js');
    state.lookupCityFn = cityModule.lookupCity;
    state.resolveCityFn = cityModule.resolveCity;
    state.cities = cityModule.allCities();
  } catch (err) {
    // 兜底方案没有加权排序也没有歧义判断，只保证「还能查」。
    // 一旦走到这里，批量解析一律按「有歧义」处理，宁可多问一句也不静默选错地方。
    console.warn('动态导入 city.js 异常，启用 cities.json fetch 备用方案:', err);
    try {
      const resp = await fetch('/engine/data/cities.json');
      state.cities = await resp.json();
      const normalize = (val) => String(val ?? '').trim().toLowerCase().replace(/\s+/g, '');
      state.lookupCityFn = (query) => {
        const keyword = normalize(query);
        if (!keyword) return [];
        return state.cities.filter((c) => normalize(c.name).includes(keyword));
      };
      state.resolveCityFn = (query) => {
        const candidates = state.lookupCityFn(query);
        return { city: candidates[0] ?? null, candidates, ambiguous: candidates.length > 1 };
      };
    } catch (e2) {
      console.error('加载城市数据失败:', e2);
      state.lookupCityFn = () => [];
      state.resolveCityFn = () => ({ city: null, candidates: [], ambiguous: false });
    }
  }
  feedRegionPickers();
}

// 批量行里认不出出生地时的占位名。经度会兜底成 120，引擎据此报 CITY_UNKNOWN 风险。
const UNKNOWN_CITY = '未知地（按标准时）';

// 快速录入区的两个通用控件（web/components/）。boot 时挂上；重名确认条上的那个每次渲染重挂。
const pickers = { dtp: null, region: null, confirmRegion: null, almanacRegion: null };

/** 城市库到了就喂给所有已挂载的出生地控件 */
function feedRegionPickers() {
  for (const key of ['region', 'confirmRegion', 'almanacRegion']) {
    pickers[key]?.setCities(state.cities, state.lookupCityFn);
  }
}

const CASES_KEY = 'bazi_cases';
const LEGACY_CASES_KEY = 'bazi_batch_cases';
// 上次看的是哪一条命例。存 id 不存下标——删掉一条，后面的下标就全错位了。
const ACTIVE_CASE_KEY = 'bazi_active_case';
// 已在本机删掉、但可能还留在服务端的 id。
const RETIRED_KEY = 'bazi_retired';
const TOKEN_KEY = 'bazi_teacher_token';
// 与 cloud/src/api.mjs 里的 MAX_NAME 对齐，改一边要同时改另一边
// （index.html 那个输入框的 maxlength 也是这个数）。
const TEACHER_NAME_MAX = 32;
// 登记时填的称呼。存一份是为了刷新后状态条立刻能显示名字，不必等 /api/me 回来。
const TEACHER_NAME_KEY = 'bazi_teacher_name';
// 老师明确选了「只在本机用」。存了它就不再催他登记，否则每次刷新都催一遍。
// 只在**没有身份**时才读得到（有 token 时走的是同步状态那条线），所以拿到 token 时不必清它，
// 清理集中在 signOutTeacher 一处。
const LOCAL_ONLY_KEY = 'bazi_local_only';

// 老师上次用的三个开关。习惯开真太阳时的老师不该每个盘都重新勾一遍；
// 第一次打开仍是全关（与试用说明一致），之后跟着他上次的选择走。
const SWITCHES_KEY = 'bazi_switches';

// 与 cloud/src/api.mjs 里 case.id / verdict.chartId 的 maxLength 对齐。
// 前端超了这个长度，服务端会整批 400——两边任一处要改，另一处必须跟着改。
const CASE_ID_MAX = 120;

// 表单归属必须独立记录：快速录入会先换 activeCaseIndex，当时 DOM 里仍是上一盘的答案。
let verdictFormCaseId = null;
const verdictDrafts = new Map();
let isSubmittingVerdict = false;
let shenshaPopTrigger = null;

/**
 * 命例 id。**cases.id 与 verdicts.chart_id 都由这里生成，别处不要另拼一个格式**——
 * 两边格式一旦不同，服务端那两张表就永远 join 不上，收回来的裁定认不出是哪个盘。
 *
 * 出生地进 id：同一时刻、同一姓名但出生地不同，是两个盘，不能被 upsert 合成一条。
 * 三个开关**不进** id：换开关看的是同一个人同一个盘的不同排法，仍是一条命例；
 * 口径差异记在裁定的 options 里。
 *
 * @param {{year:number,month:number,day:number,hour:number,minute:number,
 *          name?:string,gender:string,cityName?:string,parsedTime?:object}} src
 *          state.input 或命例对象（命例的时间在 parsedTime 里）
 */
function caseIdOf(src) {
  const t = src.parsedTime ?? src;
  if (!t || !Number.isFinite(Number(t.year))) {
    // 时间没解析出来的错误行也要有稳定 id，否则每次粘贴都当成新记录堆进列表
    return `unparsed-${normalizeRawLine(src.raw ?? src.name ?? '')}`.slice(0, CASE_ID_MAX);
  }
  const pad = (n) => String(n).padStart(2, '0');
  const birth = `${t.year}${pad(t.month)}${pad(t.day)}${pad(t.hour)}${pad(t.minute)}`;
  const place = String(src.cityName ?? '').replace(/\s+/g, '') || '未知地';
  const who = String(src.name ?? '').replace(/\s+/g, '') || '未命名';
  return `${birth}-${src.gender}-${place}-${who}`.slice(0, CASE_ID_MAX);
}

/**
 * 把当前录入的盘落成一条命例。单个录入路径也要走这里——
 * 服务端只有拿到命例，裁定才复现得出来。id 相同即视为同一条，就地更新不新增。
 * @returns {string} 命例 id
 */
function upsertCaseFromInput() {
  state.showingSample = false;
  const inp = state.input;
  const id = caseIdOf(inp);
  // raw 与 timeSource 只有批量粘贴才有，刻意不放进 fields——
  // 否则更新已有命例时会拿空值把它们盖掉
  const fields = {
    id,
    name: inp.name,
    gender: inp.gender,
    cityName: inp.cityName,
    longitude: inp.longitude,
    cityKnown: inp.cityKnown !== false,
    parsedTime: {
      year: inp.year, month: inp.month, day: inp.day, hour: inp.hour, minute: inp.minute,
    },
    status: 'valid',
    errorMsg: '',
  };

  const idx = state.cases.findIndex((c) => c.id === id);
  if (idx >= 0) {
    state.cases[idx] = { ...state.cases[idx], ...fields };
    state.activeCaseIndex = idx;
  } else {
    state.cases.push({ ...fields, raw: '', timeSource: '' });
    state.activeCaseIndex = state.cases.length - 1;
  }

  persistCases();
  renderBatchList();
  return id;
}

/**
 * 决定老师打开时看到什么。
 *
 * 原来一律排出内置样盘 Alanzhou 并停在「基本排盘」页：第一次用的老师上来先看到
 * 一个陌生人的盘，分不清那是样例还是别人留下的真数据；用过的老师刷新一次，
 * 自己刚录的盘也没了，又回到 Alanzhou。
 *
 * 现在：录过盘就接着上次那条；没录过就落在「快速录入」，样盘只当占位并明确标出。
 */
function restoreLastCase() {
  let lastId = null;
  try {
    lastId = localStorage.getItem(ACTIVE_CASE_KEY);
  } catch (e) {
    console.error('读取上次命例失败，退回默认首屏:', e);
  }

  const idx = state.cases.findIndex((c) => c.id === lastId && c.parsedTime);
  const fallback = state.cases.findIndex((c) => c.parsedTime);
  const target = idx >= 0 ? idx : fallback;

  if (target >= 0) {
    // 只装载状态不排盘——boot 紧接着就会 runCompute，别白算一遍
    applyCaseToInput(state.cases[target], target);
    return;
  }

  // 一条命例都没有：样盘只是占位，别让它冒充老师自己的数据
  state.showingSample = true;
  switchTab('quick');
}

/** 从 localStorage 读取持久化数据 */
function loadPersistedData() {
  try {
    const savedVerdicts = localStorage.getItem('bazi_verdicts');
    if (savedVerdicts) {
      state.verdicts = JSON.parse(savedVerdicts);
      // 早期版本的裁定没有 id，补一个，否则每次全量推送都会被当成新记录
      let backfilled = false;
      for (const v of state.verdicts) {
        if (!v.id) { v.id = newId(); backfilled = true; }
      }
      if (backfilled) localStorage.setItem('bazi_verdicts', JSON.stringify(state.verdicts));
    }
    const savedRetired = localStorage.getItem(RETIRED_KEY);
    if (savedRetired) {
      const parsed = JSON.parse(savedRetired);
      state.retired = {
        cases: Array.isArray(parsed.cases) ? parsed.cases : [],
        verdicts: Array.isArray(parsed.verdicts) ? parsed.verdicts : [],
      };
    }

    // bazi_batch_cases 是只装批量命例的旧键；老师浏览器里可能还留着，读进来后改存新键
    const saved = localStorage.getItem(CASES_KEY);
    const fromLegacy = saved === null;
    const savedCases = saved ?? localStorage.getItem(LEGACY_CASES_KEY);
    if (savedCases) {
      state.cases = JSON.parse(savedCases);
      // 旧记录没有稳定 id（case_时间戳_序号），补成与裁定同源的 caseIdOf，两表才 join 得上
      let backfilled = false;
      for (const c of state.cases) {
        const wanted = caseIdOf(c);
        if (c.id !== wanted) { c.id = wanted; backfilled = true; }
      }
      if (backfilled || fromLegacy) {
        localStorage.setItem(CASES_KEY, JSON.stringify(state.cases));
      }
      localStorage.removeItem(LEGACY_CASES_KEY);
    }
  } catch (e) {
    console.error('读取 localStorage 失败:', e);
  }
}

/**
 * 记下「这些 id 已经不要了」，下次同步时告诉服务端删掉。
 * @param {'cases'|'verdicts'} kind
 * @param {string[]} ids
 */
function retire(kind, ids) {
  const fresh = ids.filter((id) => id && !state.retired[kind].includes(id));
  if (fresh.length === 0) return;
  state.retired[kind] = state.retired[kind].concat(fresh);

  // 服务端对这份名单有上限（MAX_RETIRED）。本机模式下攒的名单永远送不出去，
  // 一直涨就会在老师拿到邀请码后把每次同步都顶成 400，从此再也同步不上。
  // 超了就丢最早的：那几行留在服务端不会怎样，同步断掉才是大事。
  const CAP = 2000;
  const total = state.retired.cases.length + state.retired.verdicts.length;
  if (total > CAP) state.retired[kind] = state.retired[kind].slice(-(CAP / 2));

  try {
    localStorage.setItem(RETIRED_KEY, JSON.stringify(state.retired));
  } catch (e) {
    console.error('保存退役名单至 localStorage 失败:', e);
  }
  scheduleSync();
}

/** 保存命例至 localStorage */
function persistCases() {
  try {
    localStorage.setItem(CASES_KEY, JSON.stringify(state.cases));
    const active = state.cases[state.activeCaseIndex];
    if (active) localStorage.setItem(ACTIVE_CASE_KEY, active.id);
    else localStorage.removeItem(ACTIVE_CASE_KEY);
  } catch (e) {
    console.error('保存命例至 localStorage 失败:', e);
  }
  scheduleSync();
}

/** 保存裁定至 localStorage */
function persistVerdicts() {
  try {
    localStorage.setItem('bazi_verdicts', JSON.stringify(state.verdicts));
    updateVerdictBadge();
    renderBatchList();     // 「✓ 已裁定」徽章
    renderCaseNav();       // 「下一条未裁定」是否还有得跳
  } catch (e) {
    console.error('保存裁定至 localStorage 失败:', e);
  }
  scheduleSync();
}

// ============================================================================
// 1.5 云端同步
//
// 本地优先：本地写入永远先成功，联网只是把它送上去。老师断网照常排盘、照常裁定，
// 恢复后自动补传。同步失败绝不弹窗、绝不阻断排盘——顶多在状态条上显示「待同步」。
// ============================================================================

const SYNC_DEBOUNCE_MS = 1500;
let syncTimer = null;
let syncing = false;
let syncQueuedAgain = false;

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 从试用链接 ?t=xxx 取邀请码，存进本地后**把它从地址栏抹掉**——
 * 老师截图或把地址发给同事时，不该把身份凭据一起带出去。
 */
function initTeacherToken() {
  let token = '';
  let localOnly = false;
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('t');
    if (fromUrl && fromUrl.trim()) {
      token = fromUrl.trim();
      localStorage.setItem(TOKEN_KEY, token);
      // 链接里的邀请码换了个人，本机存的名字就不是他的了，清掉等 /api/me 回填
      localStorage.removeItem(TEACHER_NAME_KEY);
      url.searchParams.delete('t');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } else {
      token = localStorage.getItem(TOKEN_KEY) || '';
    }
    state.teacher.name = localStorage.getItem(TEACHER_NAME_KEY) || '';
    localOnly = localStorage.getItem(LOCAL_ONLY_KEY) === '1';
  } catch (e) {
    console.error('读取邀请码失败:', e);
  }
  state.teacher.token = token;
  if (token) state.sync.status = 'idle';
  else state.sync.status = localOnly ? 'local' : 'unregistered';
}

/**
 * 自助登记：填个称呼，服务端现发一个邀请码。
 *
 * 名字只是标签，凭据是服务端发的随机串——同名的两次登记是两份互不相干的数据。
 * 所以换设备不能靠「再填一遍同样的名字」，得用登记后给出的专属链接。
 *
 * @param {string} name 老师填的称呼
 * @returns {Promise<{ok: boolean, message?: string}>}
 */
async function registerTeacher(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return { ok: false, message: '请填写您的称呼' };
  if (trimmed.length > TEACHER_NAME_MAX) {
    return { ok: false, message: `称呼请控制在 ${TEACHER_NAME_MAX} 字以内` };
  }

  // 失败要原样退回来。反推退回哪个状态是错的：老师从「本机模式」点进来登记失败，
  // 反推会把他丢到「未登记」，而 localStorage 里的本机模式标记还在，刷新一下又变回去。
  const prevStatus = state.sync.status;
  state.sync.status = 'registering';
  renderSyncStatus();

  try {
    const resp = await fetch('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    });
    const body = await resp.json().catch(() => null);
    if (!resp.ok || !body || body.code !== 0 || !body.data || !body.data.token) {
      throw new Error((body && body.message) || `登记失败（HTTP ${resp.status}）`);
    }

    state.teacher.token = body.data.token;
    state.teacher.name = body.data.name || trimmed;
    state.sync.status = 'idle';
    state.sync.lastError = '';
    persist(TOKEN_KEY, state.teacher.token, '保存邀请码失败，刷新后需要重新登记');
    persist(TEACHER_NAME_KEY, state.teacher.name, '保存称呼失败，刷新后要等接口回来才显示名字');
    renderSyncStatus();
    runSync();
    return { ok: true };
  } catch (err) {
    console.error('登记失败:', err);
    state.sync.status = prevStatus;   // 别把老师卡在「登记中…」
    state.sync.lastError = String(err && err.message ? err.message : err);
    renderSyncStatus();
    return { ok: false, message: state.sync.lastError };
  }
}

/** 老师选了「只在本机用」。记下来，不再催他登记。 */
function stayLocalOnly() {
  state.sync.status = 'local';
  persist(LOCAL_ONLY_KEY, '1', '保存本机模式偏好失败，下次打开会再问一次');
  renderSyncStatus();
}

/**
 * 退出当前身份，回到未登记。
 * **只清身份，不动本机的命例与裁定**——老师换个名字重来，盘还得在。
 * 那些记录已经同步上去的那份留在服务端原样不动，属于上一位登记者。
 */
function signOutTeacher() {
  state.teacher = { token: '', name: '' };
  state.sync = { status: 'unregistered', lastError: '', lastSyncedAt: '' };
  for (const key of [TOKEN_KEY, TEACHER_NAME_KEY, LOCAL_ONLY_KEY]) {
    persist(key, null, `清除 ${key} 失败，刷新后可能回到刚退出的那个身份`);
  }
  renderSyncStatus();
}

/**
 * 邀请码被服务端拒了（吊销、或链接抄漏了几位）。
 *
 * **本机的 token 不清掉**，但要说清这买到的是什么：仅仅是「下次打开再试一遍」——
 * 服务端一时抽风时，刷新后 fetchTeacherName 会重新校验并恢复，老师什么都不用做。
 * 它换不来更多：老师一旦按提示重新登记，新 token 就把旧的盖掉了，这是他自己的选择。
 *
 * 状态标成 invalid 之后，canSync() 会拦住后续所有自动重试。
 */
function markTokenInvalid(message) {
  state.sync.status = 'invalid';
  state.sync.lastError = message;
  renderSyncStatus();
}

/** 写 localStorage。存不下不该中断流程，但也绝不静默——每处都要留下自己的后果说明。 */
function persist(key, value, consequence) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch (e) {
    console.error(`${consequence}:`, e);
  }
}

/**
 * 现在能不能往服务端发东西。**发请求的每条路径都问这一处**——
 * 守卫放在防抖层挡不住 online 事件那条路，失效的邀请码会每次断线重连都白发一次全量推送。
 */
function canSync() {
  // 失效的邀请码重试多少次都是 403，只会白构造几千条记录的 JSON 再把控制台刷满
  return Boolean(state.teacher.token) && state.sync.status !== 'invalid';
}

/** 攒一下再发，避免连点几次裁定就打几次请求 */
function scheduleSync() {
  if (!canSync()) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = null; runSync(); }, SYNC_DEBOUNCE_MS);
}

/**
 * 带邀请码调一次同步接口，返回响应体的 data；推送与拉取共用。
 * 401/403 是「邀请码没了」，跟网络不好是两回事：重试一万次也不会好，
 * 这里直接标失效让老师看见「重新登记」，并返回 null 让调用方停手。
 * 其它失败抛错，由调用方决定怎么提示。
 */
async function callSyncApi(path, init = {}) {
  const resp = await fetch(path, {
    ...init,
    headers: { ...(init.headers || {}), 'x-teacher-token': state.teacher.token },
  });
  const body = await resp.json().catch(() => null);
  if (resp.status === 401 || resp.status === 403) {
    markTokenInvalid((body && body.message) || '邀请码已失效');
    return null;
  }
  if (!resp.ok || !body || body.code !== 0) {
    throw new Error((body && body.message) || `请求失败（HTTP ${resp.status}）`);
  }
  return body.data;
}

/** 全量推送本地命例与裁定；服务端按主键 upsert，重复推送无副作用 */
async function runSync() {
  if (!canSync()) return;
  if (syncing) { syncQueuedAgain = true; return; }

  syncing = true;
  state.sync.status = 'syncing';
  renderSyncStatus();

  try {
    // 快照这一批送出去的退役 id。请求飞在路上时老师可能又删了几条，
    // 成功后只能清掉确认送达的这些，不能整个清空。
    const sentRetired = { cases: [...state.retired.cases], verdicts: [...state.retired.verdicts] };

    const data = await callSyncApi('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cases: state.cases,
        verdicts: state.verdicts,
        retiredCases: sentRetired.cases,
        retiredVerdicts: sentRetired.verdicts,
      }),
    });
    if (!data) return;   // 邀请码失效，callSyncApi 已标记

    for (const kind of ['cases', 'verdicts']) {
      state.retired[kind] = state.retired[kind].filter((id) => !sentRetired[kind].includes(id));
    }
    persist(RETIRED_KEY, JSON.stringify(state.retired),
      '清理退役名单失败，下次同步会重复上报（服务端幂等，无副作用）');

    state.sync.status = 'ok';
    state.sync.lastError = '';
    state.sync.lastSyncedAt = data.syncedAt;
  } catch (err) {
    // 不静默吞掉：状态条会显示「待同步」，控制台留下原因
    console.error('同步失败，记录仍在本机保存:', err);
    state.sync.status = 'error';
    state.sync.lastError = String(err && err.message ? err.message : err);
  } finally {
    syncing = false;
    renderSyncStatus();
    if (syncQueuedAgain) { syncQueuedAgain = false; scheduleSync(); }
  }
}

/**
 * 拉取：把服务端有、本机没有的命例与裁定补进来。
 *
 * 换设备、或 Safari 隔一阵清掉 localStorage 之后，用专属链接打开本机是空的；
 * 没有这一步，「换台设备也能接着看」就是句空话。
 *
 * 合并规则**本机优先**：本机已有的 id 一律不动（本机是老师刚操作过的、更新），
 * 只补服务端多出来的；本机退役名单里的 id 也不补——那是老师刚删、还没来得及推上去的。
 * 拉完紧接着 runSync 把合并结果推回去，两边就齐了。
 */
async function pullFromServer() {
  if (!canSync()) return;
  try {
    const data = await callSyncApi('/api/pull');
    if (!data) return;

    const merge = (kind, incoming) => {
      const have = new Set(state[kind].map((x) => x.id));
      const gone = new Set(state.retired[kind]);
      const fresh = (incoming || []).filter((x) => x && x.id && !have.has(x.id) && !gone.has(x.id));
      state[kind] = state[kind].concat(fresh);
      return fresh;
    };
    const hadCases = state.cases.some((c) => c.parsedTime);
    const addedCases = merge('cases', data.cases);
    const addedVerdicts = merge('verdicts', data.verdicts);
    if (addedCases.length + addedVerdicts.length === 0) return;

    // 0004 之前存的命例服务端没有 cityKnown，按占位地名推断——占位名只在这里定义
    for (const c of addedCases) {
      if (c.cityKnown === null) c.cityKnown = Boolean(c.cityName) && c.cityName !== UNKNOWN_CITY;
    }

    persistCases();     // 内部 scheduleSync：合并结果会推回去
    persistVerdicts();
    // 新设备上本机原本一条盘都没有，这时首屏还停在样盘——切到老师上次看的那条
    if (!hadCases && addedCases.length > 0) {
      restoreLastCase();
      runCompute();
      switchTab('chart');
    } else {
      renderCaseNav();
      renderVerdictForm();
    }
    if (document.getElementById('tab-verdicts')?.classList.contains('active')) renderVerdictsList();
    showToast(`已从服务器取回 ${addedCases.length} 条命例、${addedVerdicts.length} 条裁定`);
  } catch (err) {
    // 拉不到不影响排盘，本机的照常用；推送那边会显示「待同步」
    console.error('拉取服务端记录失败:', err);
  }
}

/** 拉一次老师名字，顺带验证邀请码是否有效 */
async function fetchTeacherName() {
  if (!state.teacher.token) return;
  try {
    const resp = await fetch('/api/me', { headers: { 'x-teacher-token': state.teacher.token } });
    const body = await resp.json().catch(() => null);
    if (resp.ok && body && body.code === 0) {
      state.teacher.name = body.data.name || '';
      persist(TEACHER_NAME_KEY, state.teacher.name,
        '保存称呼失败，刷新后状态条要等接口回来才显示名字');
    } else if (resp.status === 401 || resp.status === 403) {
      markTokenInvalid((body && body.message) || '邀请码已失效');
    }
  } catch (err) {
    console.error('校验邀请码失败:', err);
  }
  renderSyncStatus();
}

function renderSyncStatus() {
  const el = document.getElementById('sync-status');
  if (!el) return;

  const pending = state.cases.length + state.verdicts.length;
  const who = state.teacher.name ? `${state.teacher.name} · ` : '';
  const map = {
    // 未登记与本机模式都招手让人点：前者是催他登记，后者是给他反悔的机会
    unregistered: { cls: 'sync-unregistered', text: '填个称呼，开始记录 →' },
    local: { cls: 'sync-local', text: '本机模式 · 记录只存这台电脑' },
    registering: { cls: 'sync-idle', text: '登记中…' },
    invalid: { cls: 'sync-unregistered', text: '链接已失效 · 点这里重新登记' },
    idle: { cls: 'sync-idle', text: `${who}待同步` },
    syncing: { cls: 'sync-idle', text: `${who}同步中…` },
    ok: { cls: 'sync-ok', text: `${who}已同步 ${pending} 条` },
    error: { cls: 'sync-error', text: `${who}待同步 ${pending} 条 · 已存本机，稍后重试` },
  };
  const view = map[state.sync.status] || map.idle;
  // 请求飞在路上时点开面板没有意义，其余状态一律可点。
  // 写成推导而不是给八条各挂一个 click 字段：漏挂一条就是无声的「点不动」。
  const clickable = state.sync.status !== 'registering';
  el.className = `sync-status ${view.cls}${clickable ? ' sync-clickable' : ''}`;
  el.textContent = view.text;
  el.title = state.sync.lastError || (clickable ? '点击查看同步设置' : '');
}

/**
 * 同步设置面板。未登记时是「填称呼」表单，已登记时是「专属链接 + 换个称呼」。
 * 走同一个浮层，省一套 DOM，也让老师知道这两件事是一回事。
 */
export function openSyncPanel() {
  const panel = document.getElementById('sync-panel');
  if (!panel) return;
  const signedIn = renderSyncPanel();
  panel.classList.add('open');
  if (!signedIn) resetNameInput();
}

/** 清空并聚焦称呼输入框。开面板与「换个称呼」都要这一对动作。 */
function resetNameInput() {
  const input = document.getElementById('register-name-input');
  if (!input) return;
  input.value = '';
  input.focus();
}

export function closeSyncPanel() {
  const panel = document.getElementById('sync-panel');
  if (panel) panel.classList.remove('open');
}

/**
 * 按有没有身份切换面板的两副面孔。
 * @returns {boolean} 是否显示的「已登记」那一面
 */
function renderSyncPanel() {
  const guest = document.getElementById('sync-panel-guest');
  const member = document.getElementById('sync-panel-member');
  if (!guest || !member) return false;

  // 失效的 token 不算已登记：这时候老师需要的是重新填称呼，不是复制一条打不开的链接。
  // 与 canSync() 同一个判断，只是那边问「能不能发」，这边问「给他看哪一面」。
  const signedIn = canSync();
  guest.style.display = signedIn ? 'none' : 'block';
  member.style.display = signedIn ? 'block' : 'none';
  if (!signedIn) return false;

  const whoEl = document.getElementById('sync-panel-who');
  if (whoEl) whoEl.textContent = state.teacher.name || '（未取到称呼）';

  const linkEl = document.getElementById('sync-panel-link');
  if (linkEl) linkEl.value = myLink();
  return true;
}

/** 老师的专属链接。换设备靠它接回同一份数据——同名重新登记接不上。 */
function myLink() {
  if (!state.teacher.token) return '';
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  return `${url.href}?t=${state.teacher.token}`;
}

/** 面板里点「开始记录」 */
export async function submitRegister() {
  const input = document.getElementById('register-name-input');
  const btn = document.getElementById('register-submit-btn');
  const err = document.getElementById('register-error');
  if (!input) return;

  if (err) err.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = '登记中…'; }

  const result = await registerTeacher(input.value);

  if (btn) { btn.disabled = false; btn.textContent = '开始记录'; }
  if (!result.ok) {
    if (err) err.textContent = result.message || '登记失败，请稍后重试';
    return;
  }
  renderSyncPanel();
  showToast(`已登记为「${state.teacher.name}」\n之后录入的命例与裁定会自动上传`);
}

/** 复制专属链接。剪贴板 API 在非 HTTPS 下会被浏览器禁掉，失败就让老师手动选中复制。 */
export async function copyMyLink() {
  const link = myLink();
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
    showToast('专属链接已复制，换设备时用它打开');
  } catch (err) {
    console.error('复制失败，请手动选中链接复制:', err);
    const el = document.getElementById('sync-panel-link');
    if (el) { el.focus(); el.select(); }
    showToast('复制失败，请手动选中链接复制');
  }
}

/** 面板里点「只在本机用」 */
export function chooseLocalOnly() {
  stayLocalOnly();
  closeSyncPanel();
  showToast('已切到本机模式，记录只存这台电脑');
}

/** 面板里点「换个称呼」：退出身份，回到填称呼那一面 */
export function switchTeacher() {
  signOutTeacher();
  renderSyncPanel();
  resetNameInput();
  showToast('已退出。本机的命例与裁定都还在，填新称呼后会重新上传一份');
}

// ============================================================================
// 2. 快速输入与 12 位数字解析
// ============================================================================

/**
 * 校验并解析 12 位数字输入（如 199303270255）
 * @param {string} str
 * @returns {{valid: boolean, data?: object, message?: string}}
 */
export function parse12Digit(str) {
  const trimmed = String(str ?? '').trim().replace(/\D/g, '');
  if (trimmed.length !== 12) {
    return {
      valid: false,
      message: `请输入恰好 12 位纯数字（当前 ${trimmed.length} 位），格式：YYYYMMDDHHmm`,
    };
  }

  const year = parseInt(trimmed.slice(0, 4), 10);
  const month = parseInt(trimmed.slice(4, 6), 10);
  const day = parseInt(trimmed.slice(6, 8), 10);
  const hour = parseInt(trimmed.slice(8, 10), 10);
  const minute = parseInt(trimmed.slice(10, 12), 10);

  if (year < 1801 || year > 2099) {
    return { valid: false, message: `年份超出范围（支持 1801–2099 年）：${year}` };
  }
  if (month < 1 || month > 12) {
    return { valid: false, message: `月份不合法（应为 01–12）：${month}` };
  }
  const maxDay = new Date(year, month, 0).getDate();
  if (day < 1 || day > maxDay) {
    return { valid: false, message: `${year}年${month}月无 ${day} 日（应为 01–${maxDay}）` };
  }
  if (hour < 0 || hour > 23) {
    return { valid: false, message: `小时不合法（应为 00–23）：${hour}` };
  }
  if (minute < 0 || minute > 59) {
    return { valid: false, message: `分钟不合法（应为 00–59）：${minute}` };
  }

  return {
    valid: true,
    data: { year, month, day, hour, minute },
    formatted: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

/** 归一化原始行，用于批量列表去重（忽略首尾与中间空白差异） */
function normalizeRawLine(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

// 批量行里的关键词 → 它落到哪个字段、什么值。整词匹配，一个词只查一次。
const BATCH_KEYWORDS = new Map([
  ...['女', '坤造', '坤', '女命'].map((w) => [w, { field: 'gender', value: 'female' }]),
  ...['男', '乾造', '乾', '男命'].map((w) => [w, { field: 'gender', value: 'male' }]),
  ...['出生证', '证'].map((w) => [w, { field: 'timeSource', value: TIME_SOURCE.CERT }]),
  ...['家人口述', '口述', '家人'].map((w) => [w, { field: 'timeSource', value: TIME_SOURCE.FAMILY }]),
  ...['客户自报', '自报', '本人'].map((w) => [w, { field: 'timeSource', value: TIME_SOURCE.SELF }]),
]);

/**
 * 解析批量文本输入（一行一个命例）
 * 支持多种灵活格式：
 * 1. 199303270255
 * 2. 张三 199303270255 兰州 男
 * 3. 李四 1996-08-10 12:03 广州 女 出生证
 * 4. 王五 1988/07/15 11:00 乾造
 */
export function parseBatchCases(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parsed = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    let name = `命例 ${idx + 1}`;
    let gender = 'male';
    let cityName = UNKNOWN_CITY;
    let longitude = 120.0;
    let cityKnown = false;
    let cityAlternatives = [];
    let dateTimeParsed = null;
    let timeSource = TIME_SOURCE.SELF;

    // 性别与时间来源只认整个词，不做子串匹配：
    // 原来 line.includes('坤') 排在「男」前面，「张坤 … 男」会被判成坤造。
    const tokens = line.split(/\s+/).filter(Boolean);
    const fields = { gender, timeSource };
    for (const token of tokens) {
      const hit = BATCH_KEYWORDS.get(token);
      if (hit) fields[hit.field] = hit.value;
    }
    ({ gender, timeSource } = fields);

    // 匹配 12 位纯数字
    const match12 = line.match(/\b\d{12}\b/);
    if (match12) {
      const res = parse12Digit(match12[0]);
      if (res.valid) {
        dateTimeParsed = res.data;
      }
    }

    // 若无 12 位数字，匹配标准日期时间 YYYY-MM-DD HH:mm
    if (!dateTimeParsed) {
      const matchStd = line.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{1,2})/);
      if (matchStd) {
        const y = parseInt(matchStd[1], 10);
        const m = parseInt(matchStd[2], 10);
        const d = parseInt(matchStd[3], 10);
        const h = parseInt(matchStd[4], 10);
        const min = parseInt(matchStd[5], 10);
        dateTimeParsed = { year: y, month: m, day: d, hour: h, minute: min };
      }
    }

    // 提取名字与城市
    for (const token of tokens) {
      if (/^\d{12}$/.test(token) || /^\d{4}[-/.]/.test(token)) continue;
      if (BATCH_KEYWORDS.has(token)) continue;
      // 地名解析。原来直接取第一条：「朝阳」会静默落成辽宁朝阳市，
      // 与北京朝阳区差 14 分钟时差，足够翻掉一个时辰，而且不吭声。
      // 现在跨省重名会带着候选交给老师确认，绝不替他选。
      if (state.resolveCityFn) {
        const hit = state.resolveCityFn(token);
        if (hit.city) {
          // 「查不到」和「重名拿不准」是两回事，别混成一个标志位：
          // 查不到 → 经度只能兜底 120，引擎报 CITY_UNKNOWN；
          // 重名 → 经度是某个真实地方的，盘算得出来，只是可能选错人，交给待确认条。
          cityName = hit.city.name;
          longitude = hit.city.lng;
          cityKnown = true;
          cityAlternatives = hit.ambiguous ? hit.candidates.slice(0, 6) : [];
          continue;
        }
      }
      if (name === `命例 ${idx + 1}` && token.length <= 8) {
        name = token;
      }
    }

    const record = {
      raw: line,
      name,
      gender,
      cityName,
      longitude,
      cityKnown,
      cityAlternatives,
      timeSource,
      parsedTime: dateTimeParsed,
      status: dateTimeParsed ? 'valid' : 'error',
      errorMsg: dateTimeParsed ? '' : '未能提取到有效出生时间（需 12 位数字或 YYYY-MM-DD HH:mm）',
    };
    // 与单个录入共用一套 id，两条路径录进来的同一个盘才会合成一条，裁定也才认得出
    record.id = caseIdOf(record);
    parsed.push(record);
  }

  return parsed;
}

// ============================================================================
// 3. 核心排盘驱动
// ============================================================================

/** 执行排盘并更新当前状态 */
export function runCompute() {
  const { year, month, day, hour, minute, longitude, applyDst, applyTrueSolar, timeFold, gender, cityKnown, selfPunish } = state.input;

  try {
    const compute = (sect) => computeChart({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      longitude: Number(longitude),
      applyDst: Boolean(applyDst),
      applyTrueSolar: Boolean(applyTrueSolar),
      sect: Number(sect),
      timeFold,
      gender,
      cityKnown: cityKnown !== false,
      selfPunish,
    });

    state.input.sect = state.sectOverride ?? state.sectPreference;
    state.sectAutoDefaulted = false;
    let result = compute(state.input.sect);
    // 节气日规则：老师没在本盘手动切过、偏好又是子初换日时，默认改按早晚子时重排一次。
    // 节气日只看北京时日期，与流派无关，所以第二次算出来的 risks 仍含这一条。
    const isJieQiDay = result.charts[0].risks.some((r) => r.kind === RISK_KIND.JIE_QI_DAY);
    if (isJieQiDay && state.sectOverride === null && state.input.sect !== 2) {
      state.input.sect = 2;
      state.sectAutoDefaulted = true;
      result = compute(2);
    }

    state.currentResult = result;
    if (state.activeChartIndex >= result.charts.length) {
      state.activeChartIndex = 0;
    }

    // 保持万年历时间与当前排盘信息实时同步
    syncAlmanacFromChart(true);

    renderAll();
  } catch (err) {
    console.error('历法引擎计算发生错误:', err);
    showToast(`排盘错误: ${err.message}`);
  }
}

// ============================================================================
// 4. UI 渲染方法
// ============================================================================

/** 按 id 写入 innerHTML；元素不在就跳过，省得每处都写一遍 if */
function setHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

/** 综合渲染主入口 */
function renderAll() {
  state.compare = compareAllDimensions();
  renderProfile();
  renderRisks();
  renderCityConfirmBar();
  renderDualChartBanner();
  renderToolbarAndAudit();
  renderChartTable();
  renderVerdictForm();
  renderCaseNav();
  // 对照页与万年历页藏着的时候不算——切过去时 switchTab 会补上；正在看时实时刷新
  if (document.getElementById('tab-compare')?.classList.contains('active')) renderCompare();
  if (document.getElementById('tab-almanac')?.classList.contains('active')) renderAlmanac();
  updateVerdictBadge();
}

/** 渲染命主基本信息 */
function renderProfile() {
  const chart = getActiveChart();
  if (!chart) return;

  const dayZhi = chart.pillars.day.zhi;
  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) avatarEl.innerText = dayZhi;

  const hintEl = document.getElementById('quick-sample-hint');
  if (hintEl) hintEl.style.display = state.showingSample ? 'block' : 'none';

  const nameRowEl = document.getElementById('profile-name-row');
  if (nameRowEl) {
    const sealText = state.input.gender === 'female' ? '坤' : '乾';
    const sample = state.showingSample ? ' <span class="sample-tag">示例盘</span>' : '';
    nameRowEl.innerHTML = `${escapeHtml(state.input.name)} <span class="seal">${sealText}</span>${sample}`;
  }

  const lunarRowEl = document.getElementById('profile-lunar-row');
  if (lunarRowEl) {
    lunarRowEl.innerText = `农历：${chart.lunar}`;
  }

  const solarRowEl = document.getElementById('profile-solar-row');
  if (solarRowEl) {
    const inp = state.input;
    const pad = (n) => String(n).padStart(2, '0');
    solarRowEl.innerText = `阳历：${inp.year}年${pad(inp.month)}月${pad(inp.day)}日 ${pad(inp.hour)}:${pad(inp.minute)}:00 · 出生地：${state.input.cityName} (${state.input.longitude}°E)`;
  }
}

/**
 * 渲染第一屏常驻分歧风险条（§7.2 / 优先级 2）
 * 严格遵照契约：
 * 无风险时必须常驻一行「本盘不在已知分歧区」，不能留空！
 */
function renderRisks() {
  const riskBoxEl = document.getElementById('risk-banner-box');
  if (!riskBoxEl) return;

  const chart = getActiveChart();
  if (!chart) {
    riskBoxEl.innerHTML = '';
    return;
  }

  const risks = verifyRisks(chart);

  if (risks.length === 0) {
    // 契约与任务书硬要求：无风险时也要有一行「本盘不在已知分歧区」，不要留空——那同样是信息
    riskBoxEl.className = 'risk-box risk-peaceful';
    riskBoxEl.innerHTML = `
      <div class="risk-peaceful-badge">
        <span class="peace-icon">🟢</span>
        <span class="risk-text"><strong>本盘不在已知分歧区</strong>（夏令时 / 真太阳时翻转 / 子时 / 距交节 &gt; 6 小时，各家通常一致）</span>
      </div>
    `;
    return;
  }

  // 存在分歧风险时渲染逐条风险
  const hasWarn = risks.some((r) => r.level === RISK_LEVEL.WARN);
  riskBoxEl.className = `risk-box ${hasWarn ? 'risk-has-warn' : 'risk-has-info'}`;

  let html = `<div class="risk-title">⚠️ 排盘风险提醒（老师重点复核）：</div><ul class="risk-list">`;
  for (const r of risks) {
    const levelClass = r.level === RISK_LEVEL.WARN ? 'level-warn' : 'level-info';
    const affectsText = r.verifiedSame
      ? '本盘四柱未变'
      : `影响${r.affects?.map((k) => PILLAR_NAMES[k] || k).join('、') || '全部'}`;
    // 出生地缺失说的是「输入不全」，不是「各家排法有争议」，徽章不能混用
    const badge = r.kind === RISK_KIND.CITY_UNKNOWN
      ? '出生地缺失'
      : (r.level === RISK_LEVEL.WARN ? '重点分歧' : '需留心');
    const message = r.kind === RISK_KIND.JIE_QI_DAY ? r.message + jieQiDaySectNote() : r.message;
    html += `
      <li class="risk-item ${levelClass}">
        <span class="risk-badge">${badge}</span>
        <span class="risk-affects">[${affectsText}]</span>
        <span class="risk-message">${escapeHtml(message)}</span>
      </li>
    `;
  }
  html += `</ul>`;
  // 历法类风险原来只给一个「查看万年历 →」的跳转，可老师此刻要的就是一句
  // 「有没有出入」。跳过去等于拿盘面、风险条、裁定表单三样换四个格子，
  // 所以把结论直接算在这里，跳转只留给真要翻月历的人。
  if (risks.some((r) => ALMANAC_RISK_KINDS.has(r.kind))) {
    html += renderAlmanacCrossCheck(chart);
  }
  riskBoxEl.innerHTML = html;
}

/**
 * 风险条末尾的万年历对照结论。
 * 一致时只占一行；有出入才摊开四柱，因为那才是需要老师动脑的情况。
 */
function renderAlmanacCrossCheck(chart) {
  let ours;
  try {
    ours = almanacPillars({
      beijing: chart.times.beijing,
      trueSolar: chart.times.trueSolar,
      sect: state.input.sect,
    });
  } catch (err) {
    // 对照失败不该把整条风险条带塌，但也不能装作核过了
    console.error('万年历对照计算失败:', { caseId: activeCaseId(), err });
    return `<div class="risk-almanac-check">万年历对照：<strong>暂时算不出</strong>
      <a class="risk-almanac-link" href="javascript:void 0"
         onclick="window.app.openAlmanacFromChart()">完整万年历 →</a></div>`;
  }

  const diff = PILLAR_KEYS.filter((key) => chart.pillars[key].ganZhi !== ours[key]);
  const link = `<a class="risk-almanac-link" href="javascript:void 0"
      onclick="window.app.openAlmanacFromChart()">完整万年历 →</a>`;

  if (diff.length === 0) {
    return `<div class="risk-almanac-check">万年历对照：<strong>四柱一致</strong> ✓ ${link}</div>`;
  }

  const cells = diff.map((key) => `
    <div class="risk-almanac-cell">
      <div class="risk-almanac-pillar">${PILLAR_NAMES[key]}</div>
      <div class="risk-almanac-values">${escapeHtml(chart.pillars[key].ganZhi)}
        <span class="risk-almanac-sep">/</span> ${escapeHtml(ours[key])}</div>
    </div>`).join('');

  return `<div class="risk-almanac-check risk-almanac-differs">
    <div>万年历对照：<strong>${diff.map((k) => PILLAR_NAMES[k]).join('、')}不一致</strong>
      （本盘 / 万年历推法） ${link}</div>
    <div class="risk-almanac-grid">${cells}</div>
  </div>`;
}

/** 节气日那条提醒的后半句：说清本盘的子时流派是怎么定下来的 */
function jieQiDaySectNote() {
  if (state.sectAutoDefaulted) return '已默认按早晚子时排盘；如您师承子初换日，可在下方工具栏切回。';
  if (state.sectOverride !== null) {
    return state.sectOverride === 2 ? '本盘按您手动选的早晚子时排。' : '本盘按您手动切回的子初换日排。';
  }
  return '本盘按您的偏好早晚子时排。';
}

/**
 * 出生地跨省重名时的改选条。
 *
 * 批量粘贴里一个「朝阳」可能是北京朝阳区、辽宁朝阳市或长春朝阳区，经度差十几分钟，
 * 足以翻掉一个时辰。工具会先按排序选一个把盘排出来，但必须当面说清楚选的是哪个、
 * 还有哪些可选——替老师默默做主，就是在制造他找不出来的错。
 */
function renderCityConfirmBar() {
  const el = document.getElementById('city-confirm-bar');
  if (!el) return;

  const alts = state.cases[state.activeCaseIndex]?.cityAlternatives ?? [];
  if (alts.length === 0) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const chips = alts.map((c) => {
    const isCurrent = c.name === state.input.cityName;
    return `<button type="button" class="city-confirm-alt ${isCurrent ? 'current' : ''}"
      onclick="window.app.confirmCaseCity('${escapeHtml(c.name)}', ${c.lng})">
      ${escapeHtml(c.name)} ${c.lng}°E${isCurrent ? ' ✓' : ''}</button>`;
  }).join('');

  el.style.display = 'block';
  el.innerHTML = `<strong>出生地待确认</strong>：这个地名有多处同名，当前按
    <strong>${escapeHtml(state.input.cityName)}</strong> 排的。不对就在下面改选，盘会立刻重排。
    <div>${chips}</div>
    <div class="city-confirm-other">都不是？按省市区县选：<div id="city-confirm-picker"></div></div>`;
  pickers.confirmRegion?.destroy();
  pickers.confirmRegion = mountRegionPicker(document.getElementById('city-confirm-picker'), {
    value: state.input.cityName,
    cities: state.cities,
    lookup: state.lookupCityFn,
    requireLeaf: true,
    onChange: (entry) => confirmCaseCity(entry.name, entry.lng, entry.approx),
  });
}

/** 老师在待确认条上敲定出生地：改盘、改命例，并撤下这条 */
export function confirmCaseCity(name, lng, approx = false) {
  const c = state.cases[state.activeCaseIndex];
  if (c) {
    const oldId = c.id;
    c.cityName = name;
    c.longitude = lng;
    c.cityKnown = true;
    c.cityAlternatives = [];

    // 出生地是 caseIdOf 的一部分，改了地名就得换 id——否则 id 里记的还是旧地名，
    // 下次提交裁定时 upsertCaseFromInput 会按新地名算出新 id、再建一条命例，
    // 同一位客户在列表里裂成两条。这里是「订正」不是「换了个人」，所以就地改名，
    // 并把已经指过来的裁定一起改过去。
    c.id = caseIdOf(c);
    if (c.id !== oldId) {
      for (const v of state.verdicts) {
        if (v.chartId === oldId) v.chartId = c.id;
      }
      persistVerdicts();
      retire('cases', [oldId]);   // 旧 id 那行本机已经没有了，服务端也别留着
    }

    persistCases();
    renderBatchList();
  }
  selectCity(name, lng, approx);   // 内部会 runCompute，顺带刷新待确认条
}

/**
 * 渲染夏令时结束日重复小时双盘提醒与切换器
 */
function renderDualChartBanner() {
  const bannerEl = document.getElementById('dual-chart-container');
  if (!bannerEl) return;

  const charts = state.currentResult?.charts || [];
  if (charts.length <= 1) {
    bannerEl.style.display = 'none';
    bannerEl.innerHTML = '';
    return;
  }

  bannerEl.style.display = 'block';
  bannerEl.innerHTML = `
    <div class="dual-chart-alert">
      <div class="dual-title">⚠️ 夏令时结束日 01:00–01:59 重复小时警示</div>
      <div class="dual-desc">因夏令时结束次回拨，钟表时间对应两个不同瞬间，已输出双盘供老师核验：</div>
      <div class="dual-tabs">
        <button class="dual-tab-btn ${state.activeChartIndex === 0 ? 'active' : ''}" onclick="window.app.selectDualChart(0)">
          第 1 遍（回拨前夏令时 · 对应柱：${charts[0].ganZhi}）
        </button>
        <button class="dual-tab-btn ${state.activeChartIndex === 1 ? 'active' : ''}" onclick="window.app.selectDualChart(1)">
          第 2 遍（回拨后标准时 · 对应柱：${charts[1].ganZhi}）
        </button>
      </div>
    </div>
  `;
}

/** 渲染工具栏状态与朱批计算过程 */
function renderToolbarAndAudit() {
  const chart = getActiveChart();
  if (!chart) return;

  // 工具栏开关状态同步
  const solarCheck = document.getElementById('toolbar-solar');
  if (solarCheck) solarCheck.checked = state.input.applyTrueSolar;

  const dstCheck = document.getElementById('toolbar-dst');
  if (dstCheck) dstCheck.checked = state.input.applyDst;

  const selfPunishCheck = document.getElementById('toolbar-selfpunish');
  if (selfPunishCheck) selfPunishCheck.checked = state.input.selfPunish;

  // 工具栏的子时单选跟随状态回填
  const sectRadio = document.querySelector(`input[name="toolbar-sect"][value="${state.input.sect}"]`);
  if (sectRadio) sectRadio.checked = true;

  const statusLabel = document.getElementById('toolbar-status-text');
  if (statusLabel) {
    const solarHour = chart.times?.trueSolar?.hour;
    const isZiShi = solarHour === 23 || solarHour === 0;
    // 不在子时交界时两派同结果，明说出来省得老师白切
    statusLabel.innerText = isZiShi ? '⚠ 在子时交界，两派结果不同' : '非子时交界，两派同结果';
  }

  // 渲染朱批内容
  const auditContainer = document.getElementById('audit-content-list');
  if (auditContainer) {
    let auditHtml = '';
    for (const step of chart.audit || []) {
      auditHtml += `
        <div class="audit-row">
          <span class="audit-step-name">${escapeHtml(step.step)}</span>
          <span class="audit-step-val">${escapeHtml(step.value)}</span>
          <span class="audit-step-note">${escapeHtml(step.note)}</span>
        </div>
      `;
    }
    auditContainer.innerHTML = auditHtml;
  }

  // 时柱变动横幅提示
  const solarBanner = document.getElementById('solar-banner');
  if (solarBanner) {
    const isChanged = state.input.applyTrueSolar && switchFlipsHour(RISK_KIND.TRUE_SOLAR);
    solarBanner.style.display = isChanged ? 'block' : 'none';
    solarBanner.innerText = isChanged ? '时柱因开启真太阳时发生跨时辰翻转' : '';
  }
}

/**
 * 渲染细盘十行表格（§7.2 / 优先级 3）
 * 行序严格按 DETAIL_ROWS：主星 天干 地支 藏干 副星 星运 自坐 空亡 纳音 神煞
 * 日柱浅朱底 + 左朱线；神煞区常驻冻结表说明
 */
function renderChartTable() {
  const tableEl = document.getElementById('chart-table-body');
  if (!tableEl) return;

  const chart = getActiveChart();
  if (!chart) return;

  const pillars = chart.pillars;
  const isSolarChanged = state.input.applyTrueSolar && switchFlipsHour(RISK_KIND.TRUE_SOLAR);

  let html = '';

  // 1. 表头行：日期 / 年柱 / 月柱 / 日柱 / 时柱
  html += `
    <div class="row header-row">
      <div class="cell col-title">四柱</div>
      <div class="cell">年柱</div>
      <div class="cell">月柱</div>
      <div class="cell col-day">日柱</div>
      <div class="cell col-hour ${isSolarChanged ? 'changed' : ''}">时柱</div>
    </div>
  `;

  // 2. 逐行渲染 DETAIL_ROWS
  for (const rowKey of DETAIL_ROWS) {
    const label = ROW_LABELS[rowKey] || rowKey;
    const isAlt = ['cangGan', 'fuXing'].includes(rowKey);

    html += `<div class="row ${isAlt ? 'bg-alt' : ''} row-${rowKey}">`;
    html += `<div class="cell col-title">${escapeHtml(label)}</div>`;

    for (const pKey of PILLAR_KEYS) {
      const p = pillars[pKey];
      const isDay = pKey === 'day';
      const isHour = pKey === 'time';
      const colClass = `${isDay ? 'col-day' : ''} ${isHour ? 'col-hour' : ''} ${isHour && isSolarChanged ? 'changed' : ''}`;

      html += `<div class="cell ${colClass}">`;

      if (rowKey === 'zhuXing') {
        html += `<span class="zhuxing-text">${escapeHtml(p.zhuXing)}</span>`;
      } else if (rowKey === 'gan') {
        const wx = FIVE_ELEMENTS.gan[p.gan] || { class: '' };
        html += `
          <div class="tian-gan ${wx.class}">
            ${escapeHtml(p.gan)}
            <span class="wx-dot ${wx.class}"></span>
          </div>
        `;
      } else if (rowKey === 'zhi') {
        const wx = FIVE_ELEMENTS.zhi[p.zhi] || { class: '' };
        html += `
          <div class="di-zhi ${wx.class}">
            ${escapeHtml(p.zhi)}
            <span class="wx-dot ${wx.class}"></span>
          </div>
        `;
      } else if (rowKey === 'cangGan') {
        html += `<div class="zang-gan">`;
        for (const cg of p.cangGan) {
          const wx = FIVE_ELEMENTS.gan[cg] || { class: '', name: '' };
          html += `<span class="${wx.class}">${escapeHtml(cg)}${wx.name}</span><br>`;
        }
        html += `</div>`;
      } else if (rowKey === 'fuXing') {
        html += `<div class="fu-xing">`;
        for (const fx of p.fuXing) {
          html += `<span>${escapeHtml(fx)}</span><br>`;
        }
        html += `</div>`;
      } else if (rowKey === 'xingYun') {
        html += `<span class="term-text">${escapeHtml(p.xingYun)}</span>`;
      } else if (rowKey === 'ziZuo') {
        html += `<span class="term-text">${escapeHtml(p.ziZuo)}</span>`;
      } else if (rowKey === 'xunKong') {
        html += `<span class="term-text">${escapeHtml(p.xunKong)}</span>`;
      } else if (rowKey === 'naYin') {
        html += `<span class="nayin-text">${escapeHtml(p.naYin)}</span>`;
      } else if (rowKey === 'shenSha') {
        html += `<div class="shensha-list">`;
        if (p.shenSha && p.shenSha.length > 0) {
          for (let sIdx = 0; sIdx < p.shenSha.length; sIdx++) {
            const ss = p.shenSha[sIdx];
            const hasConfirm = ss.pendingTeacherConfirm;
            html += `
              <button type="button" class="shensha-chip ${hasConfirm ? 'note' : ''}"
                onclick="window.app.showShenShaSource('${escapeHtml(pKey)}', ${sIdx})">
                ${escapeHtml(ss.name)}
              </button>
            `;
          }
        } else {
          html += `<span class="shensha-empty">-</span>`;
        }
        html += `</div>`;
      }

      html += `</div>`; // .cell
    }

    html += `</div>`; // .row
  }

  // 3. 常驻神煞冻结表声明（§7.3 / 任务书要求：不可缺失）
  html += `
    <div class="table-footer-notice">
      ℹ️ <strong>神煞说明</strong>：本表为冻结表（包含截图15条与合婚6条），与其他工具的条目差异属「表不同」，不是漏算；标 * 者为表源待老师确认。点击神煞可查看古籍口诀。
    </div>
  `;

  html += renderRelationsBlock(chart.relations || []);

  tableEl.innerHTML = html;
}

const RELATION_CATEGORY_LABEL = { triple: '三支格局', pair: '两支关系', tag: '墓库' };

/** 一条关系压成一行：地支 + 名目 + 落在哪几柱。长文（出处、距离两套百分比）留给弹层。 */
function relationChipText(r) {
  const posText = r.positions.map((k) => PILLAR_BRANCH_LABEL[k][0]).join('·');
  // 相邻是常态不标；隔位才提醒老师这条有折扣
  const gap = r.distance?.code && r.distance.code !== 'D10' ? ` · ${r.distance.label}` : '';
  return `<b>${escapeHtml(r.branches.join(''))}</b> ${escapeHtml(r.label)} <small>${escapeHtml(posText)}${gap}</small>`;
}

/**
 * 细盘表格下方的「地支关系」区（老师《地支运算体系 V3.1》A 标注层）。
 * 只列「有」，不判生效、不判吉凶；每条可点看规则出处。
 */
function renderRelationsBlock(relations) {
  const buckets = { triple: [], pair: [], tag: [] };
  relations.forEach((r, idx) => buckets[r.category].push({ r, idx }));
  const groups = Object.entries(buckets).filter(([, items]) => items.length > 0).map(([cat, items]) => ({ cat, items }));

  let body = '';
  if (groups.length === 0) {
    body = `<div class="relations-empty">本盘四支之间无合冲刑害破，亦无墓库。</div>`;
  }
  for (const g of groups) {
    body += `<div class="relations-group"><span class="relations-group-label">${RELATION_CATEGORY_LABEL[g.cat]}</span><div class="shensha-list relations-list">`;
    for (const { r, idx } of g.items) {
      body += `<button type="button" class="shensha-chip relation-chip ${r.nature} ${r.pendingTeacherConfirm ? 'note' : ''}"
        onclick="window.app.showRelationSource(${idx})">${relationChipText(r)}</button>`;
    }
    body += `</div></div>`;
  }

  return `
    <div class="relations-block">
      <div class="relations-head">地支关系 <span>原局静态 · 只标有无，不判生效与吉凶</span></div>
      ${body}
      <div class="table-footer-notice">
        ℹ️ <strong>关系说明</strong>：据老师《地支运算体系 V3.1》第一至九章冻结；隔一位 / 隔两位的关系仍列出，力量折扣见弹层。自刑与暗合为本模型口径（自刑可在工具栏关闭，暗合标 * 待老师确认）。合解冲、冲破合、化气、封印属生效判定，本期不做。
      </div>
    </div>
  `;
}

/**
 * 渲染老师裁定表单（§13.2 / 优先级 4）
 * 包含分歧柱、正确干支、依据流派、必填时间来源、理由
 */
function renderVerdictForm() {
  const formEl = document.getElementById('verdict-form-section');
  if (!formEl) return;

  const nowId = activeCaseId();
  if (verdictFormCaseId !== null && verdictFormCaseId !== nowId) {
    const draft = captureVerdictDraft();
    if (isVerdictDraftEmpty(draft)) verdictDrafts.delete(verdictFormCaseId);
    else verdictDrafts.set(verdictFormCaseId, draft);

    resetVerdictForm();
    const savedDraft = verdictDrafts.get(nowId);
    if (savedDraft) {
      applyVerdictDraft(savedDraft);
      showToast('已取回这条盘上次没写完的裁定');
    }
  }
  verdictFormCaseId = nowId;

  const chart = getActiveChart();
  if (!chart) return;

  // 渲染当前命盘概览
  const curSummaryEl = document.getElementById('verdict-chart-summary');
  if (curSummaryEl) {
    curSummaryEl.innerText = `${state.input.name} · ${chart.ganZhi} · ${state.input.cityName} · ${chartOptionsLabel(currentChartOptions())}`;
  }

  // 这个盘已经裁定过就说一声，免得老师重复提交、也免得他以为自己漏了
  const mine = state.verdicts.filter((v) => v.chartId === activeCaseId());
  const latest = mine[mine.length - 1];
  // 提交完老师的视线就在这张卡上，「下一条未裁定」放这里比放盘顶的翻页条更顺手
  const next = nextUnjudgedIndex();
  setHtml('verdict-judged-line', mine.length
    ? `✓ 此盘已有 <strong>${mine.length}</strong> 条裁定 · 最近：${latest.disputedPillars.length ? '存在分歧' : '与我们一致'}
       <a href="javascript:void 0" onclick="window.app.switchTab('verdicts')">查看</a>${
         next >= 0 ? `<a href="javascript:void 0" onclick="window.app.nextUnjudgedCase()">下一条未裁定 →</a>` : ''}`
    : '');
}

/** 当前盘对应的命例 id。没落到列表里时按当前输入现算，与 recordVerdict 落库时同源。 */
function activeCaseId() {
  return state.cases[state.activeCaseIndex]?.id ?? caseIdOf(state.input);
}

/** 每条命例已有几条裁定 */
function verdictCountByCase() {
  const counts = new Map();
  for (const v of state.verdicts) counts.set(v.chartId, (counts.get(v.chartId) ?? 0) + 1);
  return counts;
}

/**
 * 批量核盘的翻页条：上一条 / 第几条 / 下一条 / 下一条未裁定。
 * 原来每核完一个都要切回「快速录入」找下一条，30 个盘就是 30 次来回。
 */
/** 能排盘的命例下标（时间解析失败的行跳过），翻页与「下一条未裁定」都按它走 */
function validCaseIndices() {
  return state.cases.map((c, i) => (c.parsedTime ? i : -1)).filter((i) => i >= 0);
}

/** 从当前命例往后找（到头回到开头）第一条没留过裁定的 */
function nextUnjudgedIndex() {
  const counts = verdictCountByCase();
  const valid = validCaseIndices();
  const pos = valid.indexOf(state.activeCaseIndex);
  for (let step = 1; step <= valid.length; step++) {
    const i = valid[(pos + step) % valid.length];
    if (i !== state.activeCaseIndex && !counts.has(state.cases[i].id)) return i;
  }
  return -1;
}

function renderCaseNav() {
  const el = document.getElementById('case-nav');
  if (!el) return;

  const valid = validCaseIndices();
  const pos = valid.indexOf(state.activeCaseIndex);
  if (valid.length < 2 || pos < 0) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  const hasUnjudged = nextUnjudgedIndex() >= 0;
  const nameOf = (i) => (i === undefined ? '' : escapeHtml(state.cases[i].name));

  el.style.display = 'flex';
  el.innerHTML = `
    <button type="button" class="case-nav-btn" ${pos === 0 ? 'disabled' : ''}
      onclick="window.app.stepCase(-1)" title="${nameOf(valid[pos - 1])}">‹ 上一条</button>
    <span class="case-nav-pos">${pos + 1} / ${valid.length}</span>
    <button type="button" class="case-nav-btn" ${pos === valid.length - 1 ? 'disabled' : ''}
      onclick="window.app.stepCase(1)" title="${nameOf(valid[pos + 1])}">下一条 ›</button>
    <button type="button" class="case-nav-btn case-nav-unjudged" ${hasUnjudged ? '' : 'disabled'}
      onclick="window.app.nextUnjudgedCase()">下一条未裁定 →</button>
  `;
}

/** 翻到相邻的一条可排的命例 */
export function stepCase(dir) {
  const valid = validCaseIndices();
  const pos = valid.indexOf(state.activeCaseIndex);
  const target = valid[pos + dir];
  if (target === undefined) return;
  loadCaseToChart(state.cases[target], target);
  switchTab('chart');
}

/** 跳到下一条还没留过裁定的命例：先往后找，找到头再从开头找 */
export function nextUnjudgedCase() {
  const i = nextUnjudgedIndex();
  if (i < 0) {
    showToast('列表里的命例都已留过裁定');
    return;
  }
  loadCaseToChart(state.cases[i], i);
  switchTab('chart');
  window.scrollTo(0, 0);
}

/** 当前三个开关 */
function currentSwitches() {
  return {
    applyTrueSolar: Boolean(state.input.applyTrueSolar),
    applyDst: Boolean(state.input.applyDst),
    sect: Number(state.input.sect),
  };
}

/** 当前三个开关 + 双盘分支。裁定的 options 快照就是它。 */
function currentChartOptions() {
  const chart = getActiveChart();
  return { ...currentSwitches(), timeFold: chart?.input?.timeFold ?? state.input.timeFold };
}

/** 把口径快照写成老师看得懂的一行 */
function chartOptionsLabel(o) {
  if (!o) return '口径未记录';
  const parts = [
    `真太阳时${o.applyTrueSolar ? '开' : '关'}`,
    `夏令时${o.applyDst ? '开' : '关'}`,
    Number(o.sect) === 2 ? '早晚子时' : '子初换日',
  ];
  if (o.timeFold === 'first') parts.push('夏令时重复时·前一遍');
  if (o.timeFold === 'second') parts.push('夏令时重复时·后一遍');
  return parts.join(' · ');
}

/**
 * 裁定卡片上的命盘标签。优先用本机命例里的原始字段，
 * 命例被删掉时退回从 chartId 里反解——总之别把机器 id 甩给老师看。
 */
function verdictChartLabel(v, caseById) {
  const pad = (n) => String(n).padStart(2, '0');
  const found = caseById.get(v.chartId);
  if (found && found.parsedTime) {
    const t = found.parsedTime;
    return `${found.name} · ${t.year}-${pad(t.month)}-${pad(t.day)} ${pad(t.hour)}:${pad(t.minute)} · ${found.cityName}`;
  }

  // 认 caseIdOf 的格式：出生时间-性别-出生地-姓名。认不出就原样摆出来，
  // 别硬套着解——旧格式是「出生时间-姓名-性别」，套错会把姓名显示成出生地。
  const m = String(v.chartId || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})-(?:male|female)-(.*)-([^-]*)$/);
  if (!m) return `${v.chartId || '（未记录）'}（旧版记录）`;
  const [, y, mo, d, h, mi, place, who] = m;
  return `${who} · ${y}-${mo}-${d} ${h}:${mi} · ${v.cityName || place}`;
}

/** 裁定表单里「神煞表源异议」的四个复选框。选项来自引擎的 PENDING 表，只在启动时填一次。 */
/** 表源文字里的 **…** 圈的是各家打架的那一句：HTML 场合渲染成粗体，纯文字场合去掉标记 */
const sourceHtml = (source) => escapeHtml(source || '古籍通行口诀').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const sourcePlain = (source) => String(source || '').replace(/\*\*/g, '');

function fillShenShaOptions() {
  const el = document.getElementById('verdict-shensha-options');
  if (!el || el.children.length) return;
  el.innerHTML = PENDING_SHENSHA.map(({ name, source }) => `
    <label title="${escapeHtml(sourcePlain(source))}">
      <input type="checkbox" name="verdict-shensha" value="${escapeHtml(name)}"> ${escapeHtml(name)}
    </label>`).join('');
}

/**
 * 从口诀浮层过来的「对这条表源有异议」：关浮层、展开异议段、预勾这一条、滚到裁定卡。
 * 老师在盘上看到星号 → 点开口诀 → 一步到能写的地方，中间不用自己找。
 */
export function disputeShenSha(name) {
  closeShenShaPop();
  const box = document.getElementById('verdict-shensha-details');
  if (box) box.open = true;
  const chk = document.querySelector(`input[name="verdict-shensha"][value="${name}"]`);
  if (chk) chk.checked = true;
  requestAnimationFrame(() => {
    box?.scrollIntoView({ block: 'center' });
    document.getElementById('verdict-shensha-note')?.focus();
  });
}

/** 给四柱的天干/地支下拉填选项。选项是固定的，只在启动时填一次。 */
function fillGanZhiSelects() {
  for (const k of PILLAR_KEYS) {
    const ganSel = document.getElementById(`verdict-gan-${k}`);
    const zhiSel = document.getElementById(`verdict-zhi-${k}`);
    if (ganSel && !ganSel.options.length) {
      ganSel.innerHTML = '<option value="">天干</option>'
        + GAN.map((g) => `<option value="${g}">${g}</option>`).join('');
    }
    if (zhiSel && !zhiSel.options.length) {
      zhiSel.innerHTML = '<option value="">地支</option>'
        + ZHI.map((z) => `<option value="${z}">${z}</option>`).join('');
    }
  }
}

/**
 * 三条可开关的口径。对照页固定把三条都算一遍，不再靠 chart.risks 决定比什么——
 * 原来只取命中的第一条，一个盘同时有夏令时和真太阳时分歧时，后者被吞掉，
 * 页面写「两种排法结果相同」而风险条在喊「重点分歧」。
 *
 * `kind` 与引擎的风险种类一一对应，verifyRisks 靠它把风险和真实差异对上。
 */
const COMPARE_DIMENSIONS = [
  {
    kind: RISK_KIND.TRUE_SOLAR,
    cause: '真太阳时校正',
    left: { name: '不做真太阳时校正', patch: { applyTrueSolar: false } },
    right: { name: '做真太阳时校正', patch: { applyTrueSolar: true } },
    // 右列下面附一行：校正后到底是几点，老师一眼看出为什么翻时辰
    rightNote: (side) => `校正后 ${fmtClock(side.chart.times?.trueSolar)}`,
  },
  {
    kind: RISK_KIND.ZI_SHI,
    cause: '子时换日流派',
    left: { name: '流派1 · 子初换日', patch: { sect: 1 } },
    right: { name: '流派2 · 早晚子时', patch: { sect: 2 } },
  },
  {
    kind: RISK_KIND.DST,
    cause: '夏令时回拨',
    left: { name: '不回拨夏令时', patch: { applyDst: false } },
    right: { name: '回拨夏令时（−1 小时）', patch: { applyDst: true } },
    rightNote: (side) => `回拨后 ${fmtClock(side.chart.times?.beijing)}`,
  },
];

/** 老师在对照页点了哪一边（尚未确认提交）：{ kind, side } */
let comparePendingSide = null;

/** `{year,month,day,hour,minute}` → `08-10 10:53`。去掉年份，跨日时日期才有意义所以留着。 */
const fmtClock = (t) => (t ? fmt(t).slice(5) : '—');

/** 在当前输入基础上套一组开关，算出那一侧的盘与口径快照。套完等于当前开关的那一侧直接复用主盘。 */
function computeSide(patch) {
  const options = { ...currentSwitches(), ...patch };
  const current = getActiveChart();
  if (current && Object.entries(patch).every(([k, v]) => options[k] === v && currentSwitches()[k] === v)) {
    return { chart: current, options: { ...options, timeFold: current.input.timeFold }, isCurrent: true };
  }
  const result = computeChart({
    year: state.input.year,
    month: state.input.month,
    day: state.input.day,
    hour: state.input.hour,
    minute: state.input.minute,
    longitude: Number(state.input.longitude),
    gender: state.input.gender,
    timeFold: state.input.timeFold,
    cityKnown: state.input.cityKnown !== false,
    ...options,
  });
  // 夏令时重复小时会出双盘，跟着老师当前看的那一盘走
  const chart = result.charts[state.activeChartIndex] ?? result.charts[0];
  return { chart, options: { ...options, timeFold: chart.input.timeFold }, isCurrent: false };
}

/**
 * 三条口径各排两张盘，逐柱比对。风险条与对照页都只认这一份结果，两处不会再打架。
 * 每次 renderAll 算一次（6 张盘，毫秒级），存在 state.compare。
 */
function compareAllDimensions() {
  return COMPARE_DIMENSIONS.map((dim) => {
    const left = computeSide(dim.left.patch);
    const right = computeSide(dim.right.patch);
    const diffKeys = PILLAR_KEYS.filter(
      (k) => left.chart.pillars[k].ganZhi !== right.chart.pillars[k].ganZhi,
    );
    return { dim, left, right, diffKeys };
  });
}

/**
 * 用真实排盘结果校验引擎给的风险。
 *
 * 引擎只看「偏移量有没有跨过时辰边界」就断言「开关两边时柱不同」，实测夏令时重复时那张盘
 * 在子初换日下开关两边都是戊子——风险条红字警告，对照页却说完全一致。这里把可开关的
 * 三种风险真的翻一下开关比一比：有差异的，把差异柱与干支写进消息；没差异的降为「需留心」。
 * 夏令时重复/跳过、交节、出生地缺失不是开关能验证的，原样保留。
 */
function verifyRisks(chart) {
  const byKind = new Map(state.compare.map((c) => [c.dim.kind, c]));
  return (chart.risks || []).map((r) => {
    const cmp = byKind.get(r.kind);
    if (!cmp) return r;
    if (cmp.diffKeys.length === 0) {
      return {
        ...r,
        level: RISK_LEVEL.INFO,
        affects: [],
        verifiedSame: true,
        message: `${cmp.dim.cause}：按当前其余开关，切换前后四柱相同；换另一种开关组合时仍可能不同。`,
      };
    }
    const detail = cmp.diffKeys
      .map((k) => `${PILLAR_NAMES[k]} ${cmp.left.chart.pillars[k].ganZhi} ↔ ${cmp.right.chart.pillars[k].ganZhi}`)
      .join('，');
    return { ...r, level: RISK_LEVEL.WARN, affects: cmp.diffKeys, message: `${r.message}本盘：${detail}。` };
  });
}

/** 当前开关下，这条口径翻过去会不会改动时柱——细盘表头与横幅据此标「时柱翻转」 */
function switchFlipsHour(kind) {
  const cmp = state.compare.find((c) => c.dim.kind === kind);
  return Boolean(cmp && cmp.diffKeys.includes('time'));
}

/** 渲染对照页（优先级 5） */
function renderCompare() {
  const chart = getActiveChart();
  if (!chart) return;

  // 命主条：不然这页只有两列干支，老师不知道自己在对照谁
  const inp = state.input;
  setHtml('compare-profile', `
    <strong>${escapeHtml(inp.name)}</strong>
    <span class="seal">${inp.gender === 'female' ? '坤' : '乾'}</span>
    · ${fmt(inp)}
    · ${escapeHtml(inp.cityName)} (${inp.longitude}°E)
  `);

  const differing = state.compare.filter((c) => c.diffKeys.length > 0);
  const same = state.compare.filter((c) => c.diffKeys.length === 0);

  setHtml('compare-sub', differing.length
    ? `这个盘有 <strong>${differing.length}</strong> 条口径会改动四柱，每条的两种排法并排在下面，不同的柱标朱砂。
       哪一套对由您判断，工具不替您裁定——但请在每条下面告诉我们您按哪一套。`
    : '三条口径（真太阳时 / 子时流派 / 夏令时）开与关排出的四柱都相同，这个盘没有需要您裁定的口径。');

  let html = differing.map((c, i) => renderCompareSection(c, i + 1)).join('');
  if (same.length) {
    html += `<div class="compare-same-list">${same.map((c) => `
      <div class="compare-same">● <strong>${escapeHtml(c.dim.cause)}</strong>：
        ${escapeHtml(c.dim.left.name)} / ${escapeHtml(c.dim.right.name)} 四柱相同</div>`).join('')}
    </div>`;
  }
  if (differing.length) {
    html += `<button type="button" class="compare-pick-none" onclick="window.app.goWriteVerdict()">
      两边都不对，我自己写正确的四柱 →</button>`;
  }
  setHtml('compare-sections', html);
}

/** 一条有差异的口径：两列干支 + 一键裁定 */
function renderCompareSection(cmp, ordinal) {
  const { dim, left, right, diffKeys } = cmp;
  const column = (side) => PILLAR_KEYS.map((k) => {
    const isDiff = diffKeys.includes(k);
    return `
      <div class="comp-pillar-item ${isDiff ? 'comp-diff' : ''}">
        <span class="comp-k">${PILLAR_NAMES[k]}</span>
        <span class="comp-v ${isDiff ? 'highlight-cinnabar' : ''}">${escapeHtml(side.chart.pillars[k].ganZhi)}</span>
      </div>`;
  }).join('');
  const kicker = (side, name) => `<div class="compare-kicker">${escapeHtml(name)}${
    side.isCurrent ? ' <span class="compare-current-tag">当前</span>' : ''}</div>`;
  const note = dim.rightNote ? `<div class="compare-side-note">${escapeHtml(dim.rightNote(right))}</div>` : '';

  const pending = comparePendingSide?.kind === dim.kind ? comparePendingSide.side : null;
  const pickedSide = pending === 'left' ? left : right;
  const pickedName = pending === 'left' ? dim.left.name : dim.right.name;

  return `
    <section class="compare-section">
      <div class="compare-cause">争议 ${ordinal} · ${escapeHtml(dim.cause)}
        <span class="compare-cause-diff">${diffKeys.map((k) => PILLAR_NAMES[k]).join('、')}不同</span></div>
      <div class="compare-container">
        <div class="compare-col">${kicker(left, dim.left.name)}${column(left)}</div>
        <div class="compare-col">${kicker(right, dim.right.name)}${column(right)}${note}</div>
      </div>
      <div class="compare-actions">
        <div class="compare-pick-row">
          <button type="button" class="compare-pick-btn ${pending === 'left' ? 'active' : ''}"
            onclick="window.app.pickCompareSide('${dim.kind}', 'left')">我按左边这套排<br>${escapeHtml(dim.left.name)}</button>
          <button type="button" class="compare-pick-btn ${pending === 'right' ? 'active' : ''}"
            onclick="window.app.pickCompareSide('${dim.kind}', 'right')">我按右边这套排<br>${escapeHtml(dim.right.name)}</button>
        </div>
        ${pending ? `
          <div class="compare-confirm">
            您选的是「<strong>${escapeHtml(pickedName)}</strong>」，四柱为
            <strong>${escapeHtml(pickedSide.chart.ganZhi)}</strong>。
            还差一项——这个盘的出生时间是哪来的？
            <div class="radio-group">
              <label><input type="radio" name="compare-time-source" value="出生证"> 出生证</label>
              <label><input type="radio" name="compare-time-source" value="家人口述"> 家人口述</label>
              <label><input type="radio" name="compare-time-source" value="客户自报"> 客户自报</label>
            </div>
            <div id="compare-error" class="field-error-text"></div>
            <button type="button" class="primary-btn" onclick="window.app.submitCompareVerdict()">确认并记录</button>
          </div>` : ''}
      </div>
    </section>`;
}

/** 老师点了某一边：先把主盘切到这套口径，让他看到的就是他选的 */
export function pickCompareSide(kind, side) {
  const cmp = state.compare.find((c) => c.dim.kind === kind);
  if (!cmp) return;
  comparePendingSide = { kind, side };
  setSwitches(side === 'left' ? cmp.dim.left.patch : cmp.dim.right.patch);   // 内部重排会重跑 renderCompare
}

/** 确认提交对照页的一键裁定 */
export function submitCompareVerdict() {
  const chart = getActiveChart();
  const cmp = comparePendingSide && state.compare.find((c) => c.dim.kind === comparePendingSide.kind);
  if (!chart || !cmp) return;

  const sourceEl = document.querySelector('input[name="compare-time-source"]:checked');
  if (!sourceEl) {
    setHtml('compare-error', '请先选出生时间的来源：出生证 / 家人口述 / 客户自报');
    return;
  }

  // 主盘此刻已经切到老师选的那一套（见 pickCompareSide），
  // 所以「他认可当前这个盘」= 无分歧，口径快照记的就是他选的这套。
  const sideName = comparePendingSide.side === 'left' ? cmp.dim.left.name : cmp.dim.right.name;
  recordVerdict({
    disputedPillars: [],
    teacherGanZhi: {},
    ourGanZhi: chart.ganZhi,
    options: currentChartOptions(),
    cityName: state.input.cityName,
    longitude: Number(state.input.longitude),
    school: '',
    timeSource: sourceEl.value,
    reason: `在口径对照页选定：${cmp.dim.cause} · ${sideName}`,
  });

  comparePendingSide = null;
  renderCompare();
  showToast('✅ 已记下您按这一套排。可在「老师裁定」里查看');
}

/** 两边都不对：跳到裁定表单，别把老师留在一句没有出口的提示里 */
export function goWriteVerdict() {
  comparePendingSide = null;
  switchTab('chart');
  // 等一帧：switchTab 刚把这个 pane 显示出来，同帧内它的位置还没算出来。
  // 不用 behavior:'smooth'——实测它在这里不生效，scrollY 纹丝不动；
  // 而且这是一次明确的跳转，直接到位比动画更稳。
  requestAnimationFrame(() => {
    document.getElementById('verdict-form-section')?.scrollIntoView({ block: 'start' });
  });
}

/** 渲染裁定历史列表 */
export function renderVerdictsList() {
  const container = document.getElementById('verdicts-list-container');
  if (!container) return;

  if (state.verdicts.length === 0) {
    container.innerHTML = `
      <div class="empty-placeholder">
        <p>暂无裁定记录</p>
        <div class="empty-sub">老师在「基本排盘」页排盘后，可当场提交裁定。</div>
      </div>
    `;
    return;
  }

  let html = '';
  const total = state.verdicts.length;
  const consistent = state.verdicts.filter((v) => v.disputedPillars.length === 0).length;

  // 命例索引建一次给所有卡片共用，别在每张卡里线性查全表
  const caseById = new Map(state.cases.map((c) => [c.id, c]));

  // 只报进度，不报「一致率」：那是我们复盘用的指标，样本小的时候还容易让老师误会
  // 自己在跟工具较劲。老师只需要知道自己留了多少条痕。
  html += `
    <div class="verdict-stats-bar">
      <span>已沉淀 <strong>${total}</strong> 份裁定</span>
      <span>其中标注无分歧 <strong>${consistent}</strong> 份</span>
    </div>
  `;

  // 按命例分组，最近有动静的命例排在前面；组内新的在上。
  // 老师核 30 个盘、每盘留一两条，平铺成一列后要找某个人的裁定得翻半天。
  const groups = new Map();
  state.verdicts.forEach((v, idx) => {
    if (!groups.has(v.chartId)) groups.set(v.chartId, []);
    groups.get(v.chartId).push(idx);
  });
  const ordered = [...groups.values()].sort((a, b) => b[b.length - 1] - a[a.length - 1]);

  for (const idxs of ordered) {
    const first = state.verdicts[idxs[0]];
    html += `
      <div class="verdict-group">
        <div class="verdict-group-head">
          <span class="verdict-group-name">${escapeHtml(verdictChartLabel(first, caseById))}</span>
          <span class="verdict-group-count">${idxs.length} 条</span>
        </div>`;
    for (let i = idxs.length - 1; i >= 0; i--) html += verdictCardHtml(idxs[i]);
    html += '</div>';
  }

  container.innerHTML = html;
}

/** 一张裁定卡。命盘标签在组头上，卡片里不再重复。 */
function verdictCardHtml(idx) {
  const v = state.verdicts[idx];
  const isConsistent = v.disputedPillars.length === 0;
  return `
      <div class="verdict-card ${isConsistent ? 'card-consistent' : 'card-disputed'}">
        <div class="verdict-card-header">
          <span class="verdict-tag ${isConsistent ? 'tag-consistent' : 'tag-disputed'}">
            ${isConsistent ? '✅ 与我们一致' : '⚠️ 存在分歧'}
          </span>
          <span class="verdict-time">${v.createdAt ? v.createdAt.slice(0, 16).replace('T', ' ') : ''}</span>
          <button class="verdict-del-btn" onclick="window.app.deleteVerdict(${idx})">删除</button>
        </div>
        <div class="verdict-card-body">
          ${v.ourGanZhi ? `<div class="verdict-prop"><strong>我们排的</strong>：${escapeHtml(v.ourGanZhi)}</div>` : ''}
          <div class="verdict-prop"><strong>当时口径</strong>：${escapeHtml(chartOptionsLabel(v.options))}</div>
          ${
            !isConsistent
              ? `<div class="verdict-prop"><strong>分歧柱位</strong>：${v.disputedPillars.map((k) => PILLAR_NAMES[k] || k).join('、')}</div>
                 <div class="verdict-prop"><strong>老师认定</strong>：${escapeHtml(
                   v.disputedPillars.map((k) => `${PILLAR_NAMES[k] || k} ${v.teacherGanZhi?.[k] || '未填'}`).join('，'),
                 )}</div>`
              : ''
          }
          <div class="verdict-prop"><strong>时间来源</strong>：<span class="source-tag">${escapeHtml(v.timeSource)}</span></div>
          <div class="verdict-prop"><strong>依据流派</strong>：${escapeHtml(v.school || '未填')}</div>
          ${v.reason ? `<div class="verdict-prop"><strong>裁定理由</strong>：${escapeHtml(v.reason)}</div>` : ''}
          ${v.shenshaDisputed?.length || v.shenshaNote
            ? `<div class="verdict-prop"><strong>神煞表源异议</strong>：${escapeHtml((v.shenshaDisputed || []).join('、') || '（未指明条目）')}${
                v.shenshaNote ? ` · ${escapeHtml(v.shenshaNote)}` : ''}</div>`
            : ''}
        </div>
      </div>
    `;
}

/** 渲染批量命例列表 */
export function renderBatchList() {
  const listEl = document.getElementById('batch-cases-list');
  if (!listEl) return;

  if (state.cases.length === 0) {
    listEl.innerHTML = '<div class="empty-sub">尚无命例。可在「单个录入」逐个录，也可在上方粘贴后点「解析并追加到列表」。</div>';
    return;
  }

  const counts = verdictCountByCase();
  let html = `<div class="batch-count-bar">本机命例 <strong>${state.cases.length}</strong> 条（单个录入与批量粘贴都在这里，点击任一条载入排盘）：</div>`;

  state.cases.forEach((c, idx) => {
    const isActive = idx === state.activeCaseIndex;
    const judged = counts.get(c.id) ?? 0;
    const timeStr = c.parsedTime
      ? `${c.parsedTime.year}-${String(c.parsedTime.month).padStart(2,'0')}-${String(c.parsedTime.day).padStart(2,'0')} ${String(c.parsedTime.hour).padStart(2,'0')}:${String(c.parsedTime.minute).padStart(2,'0')}`
      : '时间解析失败';

    html += `
      <div class="batch-item ${isActive ? 'active' : ''} ${c.status === 'error' ? 'item-error' : ''}"
        onclick="window.app.selectBatchCase(${idx})">
        <div class="batch-item-title">
          <span class="batch-name">${escapeHtml(c.name)}</span>
          <span class="batch-gender">${c.gender === 'female' ? '坤造' : '乾造'}</span>
          <span class="batch-city">${escapeHtml(c.cityName)}</span>
          ${judged ? `<span class="batch-badge batch-badge-judged">✓ 已裁定 ${judged}</span>` : ''}
          ${isActive ? '<span class="batch-badge">当前排盘</span>' : ''}
          <button type="button" class="batch-item-del" title="从列表中移除"
            onclick="event.stopPropagation(); window.app.removeBatchCase(${idx})">×</button>
        </div>
        <div class="batch-item-time">${timeStr} · 来源：${escapeHtml(c.timeSource || '未填')}${
          c.cityAlternatives?.length ? ' · <strong>出生地待确认</strong>'
            : (c.cityKnown === false ? ' · <strong>出生地未知</strong>' : '')
        }</div>
        ${c.status === 'error' ? `<div class="batch-item-err">${c.errorMsg}</div>` : ''}
      </div>
    `;
  });

  listEl.innerHTML = html;
}

/** 更新导航栏裁定计数徽章 */
function updateVerdictBadge() {
  const badge = document.getElementById('verdict-count-badge');
  if (badge) {
    badge.innerText = state.verdicts.length;
  }
}

// ============================================================================
// 5. 事件处理与交互
// ============================================================================

/** 获取当前激活的 Chart 对象 */
function getActiveChart() {
  if (!state.currentResult || !state.currentResult.charts) return null;
  return state.currentResult.charts[state.activeChartIndex] || state.currentResult.charts[0];
}

/**
 * 吸顶的裁定框要让开顶栏，让多少是量出来的，不是猜的。
 * 原来写死 128px：默认字号下顶栏就已经 131px，裁定框被压掉 3px；字号调到
 * 150% 顶栏涨到 164px，压掉 36px——正是「能放大」之后才暴露的账。
 */
function initStickyTop() {
  const header = document.querySelector('.main-header');
  if (!header) return;
  const apply = () => {
    const h = Math.round(header.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--sticky-top', `${h}px`);
  };
  apply();
  // 字号、窗宽、同步状态那行的字数都会改变顶栏高度，交给 ResizeObserver 一并兜住
  if (typeof ResizeObserver === 'function') new ResizeObserver(apply).observe(header);
  else window.addEventListener('resize', apply);
}

/**
 * tab 条的键盘操作。role="tablist" 许诺的是「Tab 键进来一次，左右键在标签间走」，
 * 原来只有 role 没有行为，读屏用户按左右键没反应，只能一路 Tab 穿过五个标签。
 */
function initTabKeyboard() {
  const list = document.querySelector('.tabs[role="tablist"]');
  if (!list) return;
  const tabs = () => [...list.querySelectorAll('[role="tab"]')];

  syncTabRovingIndex();

  list.addEventListener('keydown', (e) => {
    const all = tabs();
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    const to = {
      ArrowRight: (i + 1) % all.length,
      ArrowLeft: (i - 1 + all.length) % all.length,
      Home: 0,
      End: all.length - 1,
    }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    // 焦点跟着走就直接切页：这个 tab 条本来就是点一下即切，键盘不该多一次确认
    all[to].focus();
    all[to].click();
  });
}

/** 只让当前标签留在 Tab 序列里，其余交给左右键——roving tabindex，ARIA 对 tablist 的要求 */
function syncTabRovingIndex() {
  document.querySelectorAll('.tabs[role="tablist"] [role="tab"]').forEach((t) => {
    t.setAttribute('tabindex', t.classList.contains('active') ? '0' : '-1');
  });
}

/** 切换 Tab */
export function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.remove('active');
    tab.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));

  const tabBtn = document.getElementById(`tab-btn-${tabId}`);
  if (tabBtn) {
    tabBtn.classList.add('active');
    tabBtn.setAttribute('aria-selected', 'true');
  }

  const pane = document.getElementById(`tab-${tabId}`);
  if (pane) pane.classList.add('active');
  syncTabRovingIndex();

  // 回到顶部。不然从盘底部切到「快速录入」，那一页顶上的
  // 「单个录入 / 批量录入」切换正好被吸顶的 tab 栏挡住，老师看不见它。
  window.scrollTo(0, 0);

  if (tabId === 'verdicts') {
    renderVerdictsList();
  } else if (tabId === 'compare') {
    renderCompare();
  } else if (tabId === 'almanac') {
    syncAlmanacFromChart(true);
    renderAlmanac();
  }
}

/** 切换录入方式：single 单个录入 / batch 批量录入 */
export function switchInputMode(mode) {
  const modes = ['single', 'batch'];
  const target = modes.includes(mode) ? mode : 'single';
  modes.forEach((m) => {
    const btn = document.getElementById(`mode-btn-${m}`);
    if (btn) btn.classList.toggle('active', m === target);
    const pane = document.getElementById(`input-mode-${m}`);
    if (pane) pane.classList.toggle('active', m === target);
  });
}

/** 切换朱批过程展开/收起 */
export function toggleAudit() {
  const auditBox = document.getElementById('audit-box');
  if (!auditBox) return;
  const open = !auditBox.classList.toggle('collapsed');
  const btn = document.getElementById('audit-toggle-btn');
  if (btn) btn.textContent = `朱批过程 ${open ? '▴' : '▾'}`;
}

/** 切换夏令时重复小时的双盘 */
export function selectDualChart(index) {
  state.activeChartIndex = index;
  renderAll();
}

/** 展示 Toast 浮层提示 */
export function showToast(msg, duration = 2800) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = msg;
  toast.style.display = 'block';
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    toast.style.display = 'none';
  }, duration);
}

/** 展示神煞古籍口诀与确认状态 */
export function showShenShaSource(pillarKey, shenShaIndex) {
  const chart = getActiveChart();
  if (!chart) return;
  const p = chart.pillars[pillarKey];
  if (!p || !p.shenSha || !p.shenSha[shenShaIndex]) return;

  const ss = p.shenSha[shenShaIndex];
  // 这段要老师细读，不能用几秒就消失的 toast，开一个他自己关的浮层
  openShenShaPop(`
    <div class="shensha-pop-title">${escapeHtml(ss.name)}${ss.pendingTeacherConfirm ? ' <span class="shensha-pop-pending">表源待老师确认</span>' : ''}</div>
    <div class="shensha-pop-source">${sourceHtml(ss.source)}</div>
    ${ss.pendingTeacherConfirm ? `
      <button type="button" class="shensha-pop-dispute" onclick="window.app.disputeShenSha('${escapeHtml(ss.name)}')">
        对这条表源有异议 → 去裁定里写</button>` : ''}
  `);
}

/** 神煞与地支关系共用同一个浮层：记住触发元素以便关闭后把焦点还回去 */
function openShenShaPop(bodyHtml) {
  setHtml('shensha-pop-body', bodyHtml);
  shenshaPopTrigger = document.activeElement;
  const pop = document.getElementById('shensha-pop');
  pop?.classList.add('open');
  pop?.querySelector('.shensha-pop-close')?.focus();
}

/** 展示一条地支关系的规则出处、位置、距离档 */
export function showRelationSource(index) {
  const chart = getActiveChart();
  const r = chart?.relations?.[index];
  if (!r) return;
  const where = r.positions.map((k, i) => `${PILLAR_BRANCH_LABEL[k]}（${PILLAR_PALACE[k]}）${r.branches[i]}`).join('、');
  // 一期决策 D-13：只标关系名，不显示力量层级——代号、星级、距离百分比都不上屏（数据仍在）
  const rows = [['位置', where]];
  if (r.distance) rows.push(['距离', r.distance.label]);
  if (r.note) rows.push(['备注', r.note]);
  openShenShaPop(`
    <div class="shensha-pop-title">${escapeHtml(r.branches.join(''))} ${escapeHtml(r.label)}${r.pendingTeacherConfirm ? ' <span class="shensha-pop-pending">口径待老师确认</span>' : ''}</div>
    <div class="relation-pop-rows">${rows.map(([k, v]) => `<div><strong>${escapeHtml(k)}</strong>${escapeHtml(v)}</div>`).join('')}</div>
    <div class="shensha-pop-source">${sourceHtml(r.source)}</div>
  `);
}

export function closeShenShaPop() {
  document.getElementById('shensha-pop')?.classList.remove('open');
  if (shenshaPopTrigger?.isConnected) shenshaPopTrigger.focus();
  shenshaPopTrigger = null;
}

/** 对话框不能让键盘焦点溜到背后的盘面，否则看得见浮层却操作着别处。 */
export function handleShenShaPopKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeShenShaPop();
    return;
  }
  if (event.key !== 'Tab') return;

  const pop = document.getElementById('shensha-pop');
  const card = pop?.querySelector('.shensha-pop-card');
  const focusableSelector = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');
  const focusable = [...(card?.querySelectorAll(focusableSelector) ?? [])];
  if (focusable.length === 0) {
    event.preventDefault();
    card?.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** 从 12 位快速输入直接排盘 */
export function apply12DigitInput() {
  const inputEl = document.getElementById('quick-12-input');
  if (!inputEl) return;

  const raw = inputEl.value;
  const res = parse12Digit(raw);
  if (!res.valid) {
    // 错在哪就写在输入框底下，别让提示在屏幕另一头闪三秒就没了
    const preview = document.getElementById('quick-12-preview');
    if (preview) { preview.innerText = `✗ ${res.message}`; preview.className = 'quick-preview invalid'; }
    inputEl.focus();
    return;
  }

  // 同步到 state.input
  Object.assign(state.input, res.data);

  // 同步姓名与性别
  const nameEl = document.getElementById('quick-name-input');
  if (nameEl && nameEl.value.trim()) state.input.name = nameEl.value.trim();

  const genderEl = document.querySelector('input[name="quick-gender"]:checked');
  if (genderEl) state.input.gender = genderEl.value;

  comparePendingSide = null;   // 换了盘，对照页上一次的选择作废
  resetSectOverride();

  // 先落命例再排盘：老师从这条路径录入的盘也要能同步上去，否则裁定收上来无从复现
  upsertCaseFromInput();

  runCompute();
  switchTab('chart');
  showToast(`已成功录入并排盘：${res.formatted}`);
}

/**
 * 出生地精度提示。
 * GeoNames 的地级市（ADM2）坐标是整个辖区的质心，不是市中心——例如杭州市 119.60
 * 而上城区 120.30，差 0.56° ≈ 2.2 分钟时差（杭州辖区西达淳安）。远小于时辰跨度，
 * 但落在时辰边界附近的盘会被它翻过去，所以引导老师选到区县。
 * 见 engine/data/cities.SOURCE.md。
 */
function cityPrecisionHint(name, approx = false) {
  if (approx) {
    return '这个区县的坐标暂缺，<b>先按所在地级市的坐标算</b>，与实际出生点可能差几分钟时差。'
      + '知道准确经度可在下面「经度微调」里改。';
  }
  const depth = String(name || '').trim().split(/\s+/).filter(Boolean).length;
  if (depth >= 3) return null;
  if (depth === 2) {
    return '当前只选到市级。地级市坐标取的是整个辖区质心而非市中心，'
      + '与实际出生区县可能差几分钟时差。<b>建议精确到区县</b>，尤其当出生时间接近时辰交界。';
  }
  return '当前只选到省级，经度误差可能达到数十分钟时差，足以整柱改时柱。<b>请至少选到市，最好到区县。</b>';
}

function renderCityPrecisionHint(name, approx = false) {
  const el = document.getElementById('city-precision-hint');
  if (!el) return;
  const msg = cityPrecisionHint(name, approx);
  if (!msg) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = 'block';
  el.innerHTML = msg;
}

/** 选中城市。approx：这条的坐标是地级市兜底的（名录里标 approx 的极少数条目） */
export function selectCity(name, lng, approx = false) {
  state.input.cityName = name;
  state.input.longitude = lng;
  state.input.cityKnown = true;
  renderCityPrecisionHint(name, approx);
  pickers.region?.setValue(name);

  const lngInput = document.getElementById('custom-lng-input');
  if (lngInput) lngInput.value = lng;

  runCompute();
  showToast(`已选择城市：${name} (${lng}°E)`);
}

/** 老师手动微调经度。出生地名保持不变，只换经度。 */
export function setLongitude(value) {
  const lng = Number(value);
  if (!Number.isFinite(lng)) {
    showToast('经度要填数字，如 116.4');
    return;
  }
  state.input.longitude = lng;
  state.input.cityKnown = true;   // 手填的经度是明确指定，不算「出生地未落实」
  runCompute();
}

/**
 * 清空快速录入，准备录下一位客户。
 *
 * 表单原来一直带着上一条的姓名与出生地，换个客户要逐个字段删；
 * 更坏的是漏删出生地时，盘会按上一位客户的地方排出来，老师核的是错的对象。
 */
export function clearQuickInput() {
  state.showingSample = false;
  state.activeCaseIndex = -1;
  resetSectOverride();
  Object.assign(state.input, {
    name: '',
    cityName: '',
    longitude: 120,
    cityKnown: false,   // 没填出生地，引擎会报 CITY_UNKNOWN，别让它悄悄按 120 度算
  });

  for (const id of ['quick-12-input', 'quick-name-input']) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  }
  pickers.region?.setValue('');
  const lng = document.getElementById('custom-lng-input');
  if (lng) lng.value = 120;
  const preview = document.getElementById('quick-12-preview');
  if (preview) { preview.innerText = ''; preview.className = 'quick-preview'; }
  renderCityPrecisionHint('');
  renderBatchList();
  const hint = document.getElementById('quick-sample-hint');
  if (hint) hint.style.display = 'none';

  // 重排，让盘跟上被清空的输入。不排的话表单是空的、盘还是上一位客户的，
  // 老师切到「基本排盘」核的就是错的对象（见 syncQuickInputForm 的注释）。
  runCompute();

  document.getElementById('quick-12-input')?.focus();
  showToast('已清空，可以录下一位了');
}

/** 批量解析文本 */
async function applyBatchInputAction() {
  const textEl = document.getElementById('batch-textarea');
  if (!textEl) return;

  const text = textEl.value.trim();
  if (!text) {
    showToast('请在文本框中粘贴命例数据');
    return;
  }

  // 必须等城市库：没有它，出生地会被当成未知、经度按东经 120 度算，
  // 兰州这类西部盘会直接错一个时辰——正是本工具要抓的那类错误，不能自己制造。
  if (!state.lookupCityFn) {
    showToast('城市库加载中，稍候…');
    await whenCityDataReady();
  }

  const cases = parseBatchCases(text);
  if (cases.length === 0) {
    showToast('未识别到任何有效命例');
    return;
  }

  // 按命例 id 去重：同一个盘换个写法粘第二遍（改了空格、换成 YYYY-MM-DD 格式）也认得出，
  // 比按原始行去重严实；单个录入过的盘再粘一遍同样会被认出来
  const seen = new Set(state.cases.map((c) => c.id));
  const fresh = [];
  for (const c of cases) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    fresh.push(c);
  }

  const skipped = cases.length - fresh.length;
  if (fresh.length === 0) {
    showToast(`这 ${cases.length} 条命例都已在列表中，未重复追加`);
    return;
  }

  // 追加到现有列表末尾，不覆盖之前解析过的命例
  const startIndex = state.cases.length;
  const hadActiveCase = state.activeCaseIndex >= 0;
  state.cases = state.cases.concat(fresh);
  persistCases();

  // 输入框已消费，清空以便继续粘下一批
  textEl.value = '';
  renderBatchList();

  // 列表原先为空时，自动排出本批第一条合法命例
  if (!hadActiveCase) {
    const firstValid = fresh.findIndex((c) => c.parsedTime);
    if (firstValid >= 0) {
      loadCaseToChart(fresh[firstValid], startIndex + firstValid);
    }
  }

  const skipTip = skipped > 0 ? `，跳过 ${skipped} 条重复` : '';
  showToast(`已追加 ${fresh.length} 条命例${skipTip}，列表共 ${state.cases.length} 条`);
}

export function applyBatchInput(btn) {
  return withBusy(btn ?? document.getElementById('apply-batch-input-btn'), '解析中…', applyBatchInputAction);
}

/** 删除批量列表中的单条命例 */
export function removeBatchCase(index) {
  const removed = state.cases[index];
  if (!removed) return;

  verdictDrafts.delete(removed.id);
  // 只清表单，不要把 verdictFormCaseId 置 null：换盘存取的判据是它不为 null，
  // 置了空，下一条命例的草稿就会被跳过一次不回填。
  if (index === state.activeCaseIndex) resetVerdictForm();

  state.cases.splice(index, 1);
  // 只退役命例，不连带删它的裁定：裁定自带 ourGanZhi / options / cityName 快照，
  // 命例没了照样分析得动，而那是老师留给我们的东西。要清裁定有「清空记录」。
  retire('cases', [removed.id]);
  // 删掉当前排盘那条则取消高亮，删掉它前面的则整体前移一位
  if (index === state.activeCaseIndex) {
    state.activeCaseIndex = -1;
  } else if (index < state.activeCaseIndex) {
    state.activeCaseIndex -= 1;
  }

  persistCases();
  renderBatchList();
}

/** 清空批量命例列表 */
export function clearBatchCases() {
  if (state.cases.length === 0) return;
  if (!confirm('确定清空批量命例列表吗？此操作不可恢复！')) return;
  retire('cases', state.cases.map((c) => c.id));
  for (const c of state.cases) verdictDrafts.delete(c.id);
  state.cases = [];
  state.activeCaseIndex = -1;
  resetVerdictForm();
  persistCases();
  renderBatchList();
  showToast('已清空批量命例列表');
}

/** 载入典型测试样盘库 */
async function loadSampleCasesAction() {
  // 出生地写到区县：只写「兰州」会落成地级市质心，和内置样盘的城关区变成两条 Alanzhou
  const samples = [
    'Alanzhou 199608101203 兰州市城关区 坤造 出生证',
    '兰州夏令时 198807151100 兰州市城关区 乾造 家人口述',
    '子时交界 199303272330 兰州市城关区 乾造 客户自报',
    '夏令时重复时 198609140130 兰州市城关区 坤造 出生证',
    '立秋交节 202608071940 北京市东城区 坤造 出生证',
  ];

  const textEl = document.getElementById('batch-textarea');
  if (textEl) {
    textEl.value = samples.join('\n');
    await applyBatchInputAction();
  }
}

export function loadSampleCases(btn) {
  return withBusy(btn ?? document.getElementById('load-sample-cases-btn'), '载入中…', loadSampleCasesAction);
}

/** 选中并排特定批次命例 */
export function selectBatchCase(index) {
  const c = state.cases[index];
  if (!c) return;

  if (c.status === 'error' || !c.parsedTime) {
    showToast(`无法排盘：${c.errorMsg}`);
    return;
  }

  loadCaseToChart(c, index);
  switchTab('chart');
}

/**
 * 把一条命例装载进当前输入。不排盘——调用方自己决定什么时候排。
 */
function applyCaseToInput(c, index) {
  state.showingSample = false;
  state.activeCaseIndex = index;
  resetSectOverride();
  state.input.name = c.name;
  state.input.gender = c.gender;
  state.input.cityName = c.cityName;
  state.input.longitude = c.longitude;
  state.input.cityKnown = c.cityKnown !== false;
  Object.assign(state.input, c.parsedTime);
  syncQuickInputForm();
}

/**
 * 把快速录入区所有控件刷成 state.input 的当前值。
 *
 * 老师核盘时会先看输入区、再看盘。两者对不上——比如点了北京那条命例，盘按北京算了，
 * 出生地框却还停在兰州——他核的就是错的对象，甚至可能报一个并不存在的「排错了」。
 */
function syncQuickInputForm() {
  const pad = (n) => String(n).padStart(2, '0');
  const { year, month, day, hour, minute, name, gender, cityName, longitude } = state.input;

  const q12 = document.getElementById('quick-12-input');
  if (q12) q12.value = `${year}${pad(month)}${pad(day)}${pad(hour)}${pad(minute)}`;
  pickers.dtp?.setValue({ year, month, day, hour, minute });

  const preview = document.getElementById('quick-12-preview');
  if (preview) {
    preview.innerText = `✓ 识别为：${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`;
    preview.className = 'quick-preview valid';
  }

  const nameInput = document.getElementById('quick-name-input');
  if (nameInput) nameInput.value = name ?? '';

  const genderRadio = document.querySelector(`input[name="quick-gender"][value="${gender}"]`);
  if (genderRadio) genderRadio.checked = true;

  pickers.region?.setValue(cityName ?? '');

  const lngInput = document.getElementById('custom-lng-input');
  if (lngInput) lngInput.value = longitude;

  renderCityPrecisionHint(cityName);
}

function loadCaseToChart(c, index) {
  comparePendingSide = null;
  applyCaseToInput(c, index);
  runCompute();
  renderBatchList();
}

/**
 * 裁定表单的校验错误：写在提交按钮上方、把出错的那一栏标红并滚过去。
 * 原来只 toast 三秒，电脑上 toast 在屏幕底部、表单在右上角，老师根本对不上是哪一栏错了。
 * @param {string} message 空串即清除
 * @param {string} [rowId] 出错的 .input-row 的 id
 */
function showVerdictError(message, rowId) {
  for (const el of document.querySelectorAll('#verdict-form-section .field-error')) el.classList.remove('field-error');
  setHtml('verdict-error', escapeHtml(message));
  if (!message) return;
  const row = rowId && document.getElementById(rowId);
  if (row) {
    row.classList.add('field-error');
    row.scrollIntoView({ block: 'nearest' });
  }
}

/** 按钮跑完之前先禁掉：这些动作都会改本地数据，连点会产生重复记录或相互矛盾的提示。 */
async function withBusy(btn, label, fn) {
  if (!btn || btn.disabled) return;
  const originalText = btn.textContent;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.textContent = label;
  try {
    return await fn(btn);
  } finally {
    btn.textContent = originalText;
    btn.disabled = wasDisabled;
  }
}

const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

/** 提交老师裁定（§13.2） */
async function submitVerdictAction(btn) {
  const chart = getActiveChart();
  if (!chart) return false;
  showVerdictError('');

  // 1. 获取时间来源（必填项！）
  const timeSourceEl = document.querySelector('input[name="verdict-time-source"]:checked');
  if (!timeSourceEl) {
    showVerdictError('请选时间来源：出生证 / 家人口述 / 客户自报', 'verdict-row-time-source');
    return false;
  }
  const timeSource = timeSourceEl.value;

  // 2. 分歧柱判断
  const isConsistentChecked = document.getElementById('verdict-consistent')?.checked;
  const disputedPillars = [];
  const teacherGanZhi = {};

  if (!isConsistentChecked) {
    for (const k of PILLAR_KEYS) {
      const chk = document.getElementById(`verdict-pillar-${k}`);
      if (!chk || !chk.checked) continue;
      disputedPillars.push(k);

      // 勾了「这一柱排错了」却不说对的是什么，这条裁定就没有分析价值——不许提交
      const gan = document.getElementById(`verdict-gan-${k}`)?.value || '';
      const zhi = document.getElementById(`verdict-zhi-${k}`)?.value || '';
      if (!gan || !zhi) {
        showVerdictError(`请填${PILLAR_NAMES[k]}您认为正确的干支——只勾「有分歧」我们不知道该改成什么`, `verdict-group-${k}`);
        return false;
      }
      if (!isValidGanZhi(gan, zhi)) {
        showVerdictError(`${PILLAR_NAMES[k]}「${gan}${zhi}」不在六十甲子内（阳干只配阳支、阴干只配阴支），请重选`, `verdict-group-${k}`);
        return false;
      }
      teacherGanZhi[k] = `${gan}${zhi}`;
    }

    if (disputedPillars.length === 0) {
      showVerdictError('请勾出有分歧的柱，排得对就勾「与我们一致」', 'verdict-row-pillars');
      return false;
    }
  }

  // 3. 依据流派与理由
  const schoolSelect = document.getElementById('verdict-school-select');
  const schoolCustom = document.getElementById('verdict-school-custom');
  let school = schoolSelect ? schoolSelect.value : '';
  if (school === 'custom' && schoolCustom) {
    school = schoolCustom.value.trim() || '自定义流派';
  }

  const reasonInput = document.getElementById('verdict-reason-input');
  const reason = reasonInput ? reasonInput.value.trim() : '';

  // 4. 神煞表源异议（可选，附带在这条裁定上；四柱判定仍然必填）
  const shenshaDisputed = [...document.querySelectorAll('input[name="verdict-shensha"]:checked')]
    .map((el) => el.value);
  const shenshaNote = document.getElementById('verdict-shensha-note')?.value.trim() ?? '';

  const submittedCaseId = activeCaseId();
  recordVerdict({
    disputedPillars,
    teacherGanZhi,
    ourGanZhi: chart.ganZhi,
    options: currentChartOptions(),
    cityName: state.input.cityName,
    longitude: Number(state.input.longitude),
    school,
    timeSource,
    reason,
    shenshaDisputed,
    shenshaNote,
  });

  // 清空表单
  verdictDrafts.delete(submittedCaseId);
  resetVerdictForm();

  showToast('✅ 已记录这条裁定，可在「老师裁定」里查看与导出');
  btn.textContent = '✓ 已提交';
  await wait(1000);
  return true;
}

export function submitVerdict(btn) {
  if (isSubmittingVerdict) return Promise.resolve(false);
  isSubmittingVerdict = true;
  return withBusy(btn ?? document.getElementById('submit-verdict-btn'), '提交中…', submitVerdictAction)
    .finally(() => { isSubmittingVerdict = false; });
}

/**
 * 落一条裁定。裁定表单与对照页的一键裁定共用这一处，
 * id / chartId / createdAt 的口径只在这里定义一次。
 *
 * 裁定必须挂在一条真实存在的命例上——老师可能一路没点过「立即解析并排盘」
 * （比如只切了开关就直接裁定），这里补一次，保证服务端两张表对得上。
 */
function recordVerdict(fields) {
  const verdict = {
    id: newId(),
    chartId: upsertCaseFromInput(),
    createdAt: new Date().toISOString(),
    ...fields,
  };
  state.verdicts.push(verdict);
  persistVerdicts();
  renderVerdictForm();   // 「此盘已有 N 条裁定」
  return verdict;
}

/** 重置裁定表单 */
function resetVerdictForm() {
  const isConsistent = document.getElementById('verdict-consistent');
  if (isConsistent) isConsistent.checked = false;

  for (const k of PILLAR_KEYS) {
    const chk = document.getElementById(`verdict-pillar-${k}`);
    if (chk) chk.checked = false;
    for (const part of ['gan', 'zhi']) {
      const sel = document.getElementById(`verdict-${part}-${k}`);
      if (sel) sel.value = '';
    }
    const group = document.getElementById(`verdict-group-${k}`);
    if (group) group.style.display = 'none';
  }

  const reasonInput = document.getElementById('verdict-reason-input');
  if (reasonInput) reasonInput.value = '';

  for (const chk of document.querySelectorAll('input[name="verdict-shensha"]')) chk.checked = false;
  const ssNote = document.getElementById('verdict-shensha-note');
  if (ssNote) ssNote.value = '';
  const ssBox = document.getElementById('verdict-shensha-details');
  if (ssBox) ssBox.open = false;

  // 时间来源与依据流派刻意不预选、提交后也复位：
  // 预选等于替老师答了，落库后分不清「他选了出生证」和「他没管这一栏」
  for (const radio of document.querySelectorAll('input[name="verdict-time-source"]')) {
    radio.checked = false;
  }
  const schoolSelect = document.getElementById('verdict-school-select');
  if (schoolSelect) schoolSelect.value = '';
  const schoolCustom = document.getElementById('verdict-school-custom');
  if (schoolCustom) { schoolCustom.value = ''; schoolCustom.style.display = 'none'; }
}

function captureVerdictDraft() {
  const pillars = {};
  const checkedPillars = [];
  for (const k of PILLAR_KEYS) {
    const checked = document.getElementById(`verdict-pillar-${k}`)?.checked ?? false;
    if (checked) checkedPillars.push(k);
    pillars[k] = {
      gan: document.getElementById(`verdict-gan-${k}`)?.value ?? '',
      zhi: document.getElementById(`verdict-zhi-${k}`)?.value ?? '',
    };
  }
  return {
    consistent: document.getElementById('verdict-consistent')?.checked ?? false,
    pillars,
    checkedPillars,
    timeSource: document.querySelector('input[name="verdict-time-source"]:checked')?.value ?? '',
    school: document.getElementById('verdict-school-select')?.value ?? '',
    schoolCustom: document.getElementById('verdict-school-custom')?.value ?? '',
    reason: document.getElementById('verdict-reason-input')?.value ?? '',
    shensha: [...document.querySelectorAll('input[name="verdict-shensha"]:checked')].map((el) => el.value),
    shenshaNote: document.getElementById('verdict-shensha-note')?.value ?? '',
  };
}

function isVerdictDraftEmpty(draft) {
  return !draft.consistent
    && draft.checkedPillars.length === 0
    && !draft.timeSource
    && !draft.school
    && !draft.schoolCustom.trim()
    && !draft.reason.trim()
    && draft.shensha.length === 0
    && !draft.shenshaNote.trim();
}

function applyVerdictDraft(draft) {
  const consistent = document.getElementById('verdict-consistent');
  if (consistent) consistent.checked = draft.consistent;

  for (const k of PILLAR_KEYS) {
    const checked = draft.checkedPillars.includes(k);
    const chk = document.getElementById(`verdict-pillar-${k}`);
    if (chk) chk.checked = checked;
    const gan = document.getElementById(`verdict-gan-${k}`);
    const zhi = document.getElementById(`verdict-zhi-${k}`);
    if (gan) gan.value = draft.pillars[k]?.gan ?? '';
    if (zhi) zhi.value = draft.pillars[k]?.zhi ?? '';
    onDisputedPillarToggle(k, checked);
  }

  for (const radio of document.querySelectorAll('input[name="verdict-time-source"]')) {
    radio.checked = radio.value === draft.timeSource;
  }
  const school = document.getElementById('verdict-school-select');
  if (school) school.value = draft.school;
  const schoolCustom = document.getElementById('verdict-school-custom');
  if (schoolCustom) {
    schoolCustom.value = draft.schoolCustom;
    schoolCustom.style.display = draft.school === 'custom' ? 'block' : 'none';
  }
  const reason = document.getElementById('verdict-reason-input');
  if (reason) reason.value = draft.reason;
  for (const chk of document.querySelectorAll('input[name="verdict-shensha"]')) {
    chk.checked = draft.shensha.includes(chk.value);
  }
  const shenshaNote = document.getElementById('verdict-shensha-note');
  if (shenshaNote) shenshaNote.value = draft.shenshaNote;
  const shenshaDetails = document.getElementById('verdict-shensha-details');
  if (shenshaDetails) shenshaDetails.open = draft.shensha.length > 0 || Boolean(draft.shenshaNote.trim());
}

/** 依据流派选了「自定」才露出文本框 */
export function onSchoolChange(value) {
  const custom = document.getElementById('verdict-school-custom');
  if (!custom) return;
  custom.style.display = value === 'custom' ? 'block' : 'none';
  if (value === 'custom') custom.focus();
}

/** 勾选「与我们一致」时自动取消其他柱 */
export function onConsistentToggle(isChecked) {
  if (isChecked) {
    for (const k of PILLAR_KEYS) {
      const chk = document.getElementById(`verdict-pillar-${k}`);
      if (chk) chk.checked = false;
      const group = document.getElementById(`verdict-group-${k}`);
      if (group) group.style.display = 'none';
    }
  }
}

/** 勾选具体分歧柱 */
export function onDisputedPillarToggle(pillarKey, isChecked) {
  if (isChecked) {
    const isConsistent = document.getElementById('verdict-consistent');
    if (isConsistent) isConsistent.checked = false;
  }
  const group = document.getElementById(`verdict-group-${pillarKey}`);
  if (group) {
    group.style.display = isChecked ? 'block' : 'none';
  }
}

/** 导出所有裁定为 JSON 文件 */
export function exportVerdictsJson() {
  if (state.verdicts.length === 0) {
    showToast('当前暂无裁定记录可导出');
    return;
  }

  const jsonStr = JSON.stringify(state.verdicts, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bazi-teacher-verdicts-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`已成功导出 ${state.verdicts.length} 份裁定为 JSON`);
}

/** 删除单条裁定 */
export function deleteVerdict(index) {
  if (!confirm('确定删除该条裁定吗？')) return;
  const [removed] = state.verdicts.splice(index, 1);
  if (removed) retire('verdicts', [removed.id]);
  persistVerdicts();
  renderVerdictsList();
  showToast('已删除裁定');
}

/** 清空全部裁定 */
export function clearAllVerdicts() {
  if (state.verdicts.length === 0) return;
  if (!confirm('确定清空所有本地保存的裁定吗？此操作不可恢复！')) return;
  retire('verdicts', state.verdicts.map((v) => v.id));
  state.verdicts = [];
  persistVerdicts();
  renderVerdictsList();
  showToast('已清空所有裁定');
}

/** 工具辅助：转义 HTML */
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// 6. 口径开关实时同步
// ============================================================================

/** 改开关的唯一入口：写进 state、记住偏好、重排。工具栏与对照页的一键选边都走这里。 */
function setSwitches(patch) {
  const { sect, ...rest } = patch;
  Object.assign(state.input, rest);
  if (sect !== undefined) {
    // 手动切子时流派：既是本盘的定论，也更新长期偏好（与原先行为一致）
    state.sectPreference = Number(sect);
    state.sectOverride = Number(sect);
  }
  // 存的是偏好，不是本盘生效值——节气日自动切成的早晚子时不能变成老师的长期偏好
  // 自刑不改四柱，不进 currentSwitches（那是裁定的口径快照），只跟着偏好一起存
  persist(SWITCHES_KEY, JSON.stringify({ ...currentSwitches(), sect: state.sectPreference, selfPunish: state.input.selfPunish }),
    '保存开关偏好失败，下次打开会回到全关');
  runCompute();   // renderToolbarAndAudit 会把工具栏控件刷成 state 的值
}

/** 启动时取回上次的开关。没存过或存坏了就保持默认全关。 */
function loadSwitches() {
  try {
    const saved = JSON.parse(localStorage.getItem(SWITCHES_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return;
    state.input.applyTrueSolar = Boolean(saved.applyTrueSolar);
    state.input.applyDst = Boolean(saved.applyDst);
    state.sectPreference = Number(saved.sect) === 2 ? 2 : 1;
    state.input.sect = state.sectPreference;
    if (saved.selfPunish !== undefined) state.input.selfPunish = Boolean(saved.selfPunish);
  } catch (e) {
    console.error('读取开关偏好失败，按默认全关:', e);
  }
}

/** 换了盘：本盘上的手动子时选择作废，下一盘重新按偏好与节气日规则定 */
function resetSectOverride() {
  state.sectOverride = null;
}

export function syncSolar(checked) {
  setSwitches({ applyTrueSolar: Boolean(checked) });
}

export function syncDst(checked) {
  setSwitches({ applyDst: Boolean(checked) });
}

export function syncSect(sectValue) {
  setSwitches({ sect: Number(sectValue) });
}

export function syncSelfPunish(checked) {
  setSwitches({ selfPunish: Boolean(checked) });
}

export function castFromAlmanac(target) {
  if (!target) return;
  state.input.year = Number(target.year);
  state.input.month = Number(target.month);
  state.input.day = Number(target.day);
  state.input.hour = Number(target.hour);
  state.input.minute = Number(target.minute);
  if (target.cityName) state.input.cityName = target.cityName;
  if (typeof target.longitude === 'number') state.input.longitude = target.longitude;
  if (typeof target.sect === 'number') state.input.sect = target.sect;

  const pad = (n) => String(n).padStart(2, '0');
  const q12 = document.getElementById('quick-12-input');
  if (q12) {
    q12.value = `${target.year}${pad(target.month)}${pad(target.day)}${pad(target.hour)}${pad(target.minute)}`;
    const preview = document.getElementById('quick-12-preview');
    if (preview) {
      preview.innerText = `✓ 识别为：${target.year}-${pad(target.month)}-${pad(target.day)} ${pad(target.hour)}:${pad(target.minute)}`;
      preview.className = 'quick-preview valid';
    }
  }
  pickers.dtp?.setValue(state.input);
  if (state.input.cityName) {
    pickers.region?.setValue(state.input.cityName);
  }

  runCompute();
  renderAll();
  switchTab('chart');
  showToast(`已按万年历所选：${target.year}年${target.month}月${target.day}日 ${pad(target.hour)}:${pad(target.minute)} 排盘`);
}

// ============================================================================
// 7. 页面启动入口
// ============================================================================

if (typeof window !== 'undefined') {
  // 不能直接监听 DOMContentLoaded：lunar-esm.js 里有顶层 await，模块求值会被推迟到
  // 该事件之后，那时再注册监听器就永远等不到了（整个初始化静默失效，页面上只剩骨架
  // 里的占位盘，看着正常但按钮全是死的）。所以先看 readyState。
  const boot = async () => {
    // 挂载全局方法到 window.app 供 HTML 事件调用
    window.app = {
      switchTab,
      switchInputMode,
      toggleAudit,
      selectDualChart,
      showShenShaSource,
      showRelationSource,
      closeShenShaPop,
      handleShenShaPopKeydown,
      disputeShenSha,
      apply12DigitInput,
      selectCity,
      setLongitude,
      confirmCaseCity,
      clearQuickInput,
      applyBatchInput,
      loadSampleCases,
      clearBatchCases,
      removeBatchCase,
      selectBatchCase,
      submitVerdict,
      onConsistentToggle,
      onSchoolChange,
      onDisputedPillarToggle,
      pickCompareSide,
      submitCompareVerdict,
      goWriteVerdict,
      stepCase,
      nextUnjudgedCase,
      exportVerdictsJson,
      deleteVerdict,
      clearAllVerdicts,
      syncSolar,
      syncDst,
      syncSect,
      syncSelfPunish,
      castFromAlmanac,
      syncAlmanacFromChart,
      openAlmanacFromChart,
      openSyncPanel,
      closeSyncPanel,
      submitRegister,
      copyMyLink,
      chooseLocalOnly,
      switchTeacher,
    };

    initTeacherToken();
    initTabKeyboard();
    initStickyTop();
    loadPersistedData();
    loadSwitches();
    // 把上次留存的批量命例先渲染出来，否则追加解析时列表看着是空的
    renderBatchList();
    renderSyncStatus();
    // 不 await：城市库慢，但首盘用不上它，让老师先看到盘
    whenCityDataReady();

    // 无条件挂：runSync 自己会问 canSync()，所以中途登记、退出、邀请码失效都不用再动监听
    window.addEventListener('online', runSync);   // 网络恢复即重试
    // 有缓存的称呼就不必再问一次 /api/me；邀请码有没有效，紧接着的 runSync 会顺带判定
    if (state.teacher.token && !state.teacher.name) fetchTeacherName();
    // 先拉后推：把别的设备上的记录接回来，再把本机的（含上次没送出去的）送上去。
    // 不 await：首屏按本机数据先出来，拉取在后台补。走 scheduleSync 而不是 runSync：
    // 拉到东西时 persist 已经排了一次推送，这里再排只是重置同一个定时器，不会推两遍。
    pullFromServer().finally(scheduleSync);

    // 时间下拉与 12 位框双向同步：改下拉 → 改写 12 位框；敲满 12 位且合法 → 回填下拉。
    // 两边都只是编辑输入，真正解析并排盘仍是「立即解析并排盘」那个按钮（走 12 位框）。
    const q12 = document.getElementById('quick-12-input');
    const preview = document.getElementById('quick-12-preview');
    const pad = (n) => String(n).padStart(2, '0');
    const dtpEl = document.getElementById('quick-dtp');
    if (dtpEl) {
      pickers.dtp = mountDateTimePicker(dtpEl, {
        value: state.input,
        onChange: (v) => {
          if (!q12) return;
          q12.value = `${v.year}${pad(v.month)}${pad(v.day)}${pad(v.hour)}${pad(v.minute)}`;
          q12.dispatchEvent(new Event('input'));
        },
      });
    }
    const regionEl = document.getElementById('quick-region');
    if (regionEl) {
      pickers.region = mountRegionPicker(regionEl, {
        value: state.input.cityName,
        cities: state.cities.length ? state.cities : undefined,
        lookup: state.lookupCityFn ?? undefined,
        onChange: (entry) => selectCity(entry.name, entry.lng, entry.approx),
      });
    }
    const almanac = mountAlmanac({ appState: state, getActiveChart, switchTab });
    pickers.almanacRegion = almanac.regionPicker;
    if (q12 && preview) {
      q12.addEventListener('input', () => {
        const val = q12.value.trim();
        if (val.length === 12) {
          const res = parse12Digit(val);
          if (res.valid) {
            preview.innerText = `✓ 识别为：${res.formatted}`;
            preview.className = 'quick-preview valid';
            pickers.dtp?.setValue(res.data);
          } else {
            preview.innerText = `✗ ${res.message}`;
            preview.className = 'quick-preview invalid';
          }
        } else if (val.length > 0) {
          preview.innerText = `输入进度：${val.length}/12 位`;
          preview.className = 'quick-preview typing';
        } else {
          preview.innerText = '';
        }
      });

      // 支持回车直接排盘
      q12.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          apply12DigitInput();
        }
      });
    }

    fillGanZhiSelects();
    fillShenShaOptions();
    restoreLastCase();
    runCompute();

    // 首盘已出，撤下遮罩——在这之前页面上是骨架里的占位盘，不能让老师看见
    document.body.classList.remove('engine-loading');

    // 没登记也没选「只在本机用」的，打开就请他填称呼——右上角那行小字老师根本注意不到。
    // 点「关闭」只是这次先不填，下次打开还会问；选了「先不登记」才不再问。
    if (state.sync.status === 'unregistered') openSyncPanel();
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}
