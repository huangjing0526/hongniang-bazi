// web/app.js
// 红娘八字排盘 · 业务逻辑与 UI 控制层
// 中文注释，英文变量名/函数名 (Strict adherence to task guidelines)

import { computeChart } from '../engine/src/chart.js';
import {
  PILLAR_KEYS,
  DETAIL_ROWS,
  ROW_LABELS,
  TIME_SOURCE,
  RISK_KIND,
  RISK_LEVEL,
  GAN,
  ZHI,
  isValidGanZhi,
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
    sect: 1,                // 流派1: 子初换日; 2: 早晚子时
    timeFold: 'unknown',
  },
  // 首屏那个内置样盘还挂着没被顶掉。为真时界面上要标「示例」，别让老师误当成真数据。
  showingSample: true,
  // 引擎计算输出结果
  currentResult: null,
  activeChartIndex: 0,
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
  // 云端同步（无邀请码时全程不联网，保持本机模式）
  teacher: { token: '', name: '' },
  sync: { status: 'local', lastError: '', lastSyncedAt: '' },
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
}

// 批量行里认不出出生地时的占位名。经度会兜底成 120，引擎据此报 CITY_UNKNOWN 风险。
const UNKNOWN_CITY = '未知地（按标准时）';

const CASES_KEY = 'bazi_cases';
const LEGACY_CASES_KEY = 'bazi_batch_cases';
// 上次看的是哪一条命例。存 id 不存下标——删掉一条，后面的下标就全错位了。
const ACTIVE_CASE_KEY = 'bazi_active_case';
// 已在本机删掉、但可能还留在服务端的 id。
const RETIRED_KEY = 'bazi_retired';

// 与 cloud/src/api.mjs 里 case.id / verdict.chartId 的 maxLength 对齐。
// 前端超了这个长度，服务端会整批 400——两边任一处要改，另一处必须跟着改。
const CASE_ID_MAX = 120;

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
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('t');
    if (fromUrl && fromUrl.trim()) {
      token = fromUrl.trim();
      localStorage.setItem('bazi_teacher_token', token);
      url.searchParams.delete('t');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    } else {
      token = localStorage.getItem('bazi_teacher_token') || '';
    }
  } catch (e) {
    console.error('读取邀请码失败:', e);
  }
  state.teacher.token = token;
  state.sync.status = token ? 'idle' : 'local';
}

/** 攒一下再发，避免连点几次裁定就打几次请求 */
function scheduleSync() {
  if (!state.teacher.token) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = null; runSync(); }, SYNC_DEBOUNCE_MS);
}

/** 全量推送本地命例与裁定；服务端按主键 upsert，重复推送无副作用 */
async function runSync() {
  if (!state.teacher.token) return;
  if (syncing) { syncQueuedAgain = true; return; }

  syncing = true;
  state.sync.status = 'syncing';
  renderSyncStatus();

  try {
    // 快照这一批送出去的退役 id。请求飞在路上时老师可能又删了几条，
    // 成功后只能清掉确认送达的这些，不能整个清空。
    const sentRetired = { cases: [...state.retired.cases], verdicts: [...state.retired.verdicts] };

    const resp = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-teacher-token': state.teacher.token },
      body: JSON.stringify({
        cases: state.cases,
        verdicts: state.verdicts,
        retiredCases: sentRetired.cases,
        retiredVerdicts: sentRetired.verdicts,
      }),
    });
    const body = await resp.json().catch(() => null);

    if (!resp.ok || !body || body.code !== 0) {
      const message = (body && body.message) || `同步失败（HTTP ${resp.status}）`;
      throw new Error(message);
    }

    for (const kind of ['cases', 'verdicts']) {
      state.retired[kind] = state.retired[kind].filter((id) => !sentRetired[kind].includes(id));
    }
    try {
      localStorage.setItem(RETIRED_KEY, JSON.stringify(state.retired));
    } catch (e) {
      console.error('清理退役名单失败，下次同步会重复上报（服务端幂等，无副作用）:', e);
    }

    state.sync.status = 'ok';
    state.sync.lastError = '';
    state.sync.lastSyncedAt = body.data.syncedAt;
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

/** 拉一次老师名字，顺带验证邀请码是否有效 */
async function fetchTeacherName() {
  if (!state.teacher.token) return;
  try {
    const resp = await fetch('/api/me', { headers: { 'x-teacher-token': state.teacher.token } });
    const body = await resp.json().catch(() => null);
    if (resp.ok && body && body.code === 0) {
      state.teacher.name = body.data.name || '';
    } else if (resp.status === 401 || resp.status === 403) {
      state.sync.status = 'error';
      state.sync.lastError = (body && body.message) || '邀请码无效';
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
    local: { cls: 'sync-local', text: '本机模式 · 记录只存这台电脑' },
    idle: { cls: 'sync-idle', text: `${who}待同步` },
    syncing: { cls: 'sync-idle', text: `${who}同步中…` },
    ok: { cls: 'sync-ok', text: `${who}已同步 ${pending} 条` },
    error: { cls: 'sync-error', text: `${who}待同步 ${pending} 条 · 已存本机，稍后重试` },
  };
  const view = map[state.sync.status] || map.idle;
  el.className = `sync-status ${view.cls}`;
  el.textContent = view.text;
  el.title = state.sync.lastError || '';
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

    // 性别关键词识别
    if (line.includes('女') || line.includes('坤造') || line.includes('坤')) {
      gender = 'female';
    } else if (line.includes('男') || line.includes('乾造') || line.includes('乾')) {
      gender = 'male';
    }

    // 时间来源识别
    if (line.includes('出生证') || line.includes('证')) {
      timeSource = TIME_SOURCE.CERT;
    } else if (line.includes('口述') || line.includes('家人')) {
      timeSource = TIME_SOURCE.FAMILY;
    } else if (line.includes('自报') || line.includes('本人')) {
      timeSource = TIME_SOURCE.SELF;
    }

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
    const tokens = line.split(/\s+/).filter(Boolean);
    for (const token of tokens) {
      if (/^\d{12}$/.test(token) || /^\d{4}[-/.]/.test(token)) continue;
      if (['男', '女', '乾造', '坤造', '乾', '坤', '出生证', '家人口述', '客户自报'].includes(token)) continue;
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
  const { year, month, day, hour, minute, longitude, applyDst, applyTrueSolar, sect, timeFold, gender, cityKnown } = state.input;

  try {
    const result = computeChart({
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
    });

    state.currentResult = result;
    if (state.activeChartIndex >= result.charts.length) {
      state.activeChartIndex = 0;
    }

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
  renderProfile();
  renderRisks();
  renderCityConfirmBar();
  renderDualChartBanner();
  renderToolbarAndAudit();
  renderChartTable();
  renderVerdictForm();
  // 对照页要多算两张盘。它藏着的时候不算——切过去时 switchTab 会补上。
  if (document.getElementById('tab-compare')?.classList.contains('active')) renderCompare();
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

  const risks = chart.risks || [];

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
    const affectsText = r.affects?.map((k) => PILLAR_NAMES[k] || k).join('、') || '全部';
    // 出生地缺失说的是「输入不全」，不是「各家排法有争议」，徽章不能混用
    const badge = r.kind === RISK_KIND.CITY_UNKNOWN
      ? '出生地缺失'
      : (r.level === RISK_LEVEL.WARN ? '重点分歧' : '需留心');
    html += `
      <li class="risk-item ${levelClass}">
        <span class="risk-badge">${badge}</span>
        <span class="risk-affects">[影响${affectsText}]</span>
        <span class="risk-message">${escapeHtml(r.message)}</span>
      </li>
    `;
  }
  html += `</ul>`;
  riskBoxEl.innerHTML = html;
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
    <div>${chips}</div>`;
}

/** 老师在待确认条上敲定出生地：改盘、改命例，并撤下这条 */
export function confirmCaseCity(name, lng) {
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
  selectCity(name, lng);   // 内部会 runCompute，顺带刷新待确认条
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
    // 对比标准北京时柱与真太阳时柱
    const beijingTimeGz = chart.times?.beijing ? `${chart.pillars.time.ganZhi}` : '';
    // 计算未开启真太阳时的时柱以判断是否变动
    const isChanged = state.input.applyTrueSolar && chart.risks.some((r) => r.kind === RISK_KIND.TRUE_SOLAR);
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
  const isSolarChanged = state.input.applyTrueSolar && chart.risks.some((r) => r.kind === RISK_KIND.TRUE_SOLAR);

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
              <span class="${hasConfirm ? 'note' : ''}"
                onclick="window.app.showShenShaSource('${escapeHtml(pKey)}', ${sIdx})">
                ${escapeHtml(ss.name)}${hasConfirm ? '*' : ''}
              </span>
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

  tableEl.innerHTML = html;
}

/**
 * 渲染老师裁定表单（§13.2 / 优先级 4）
 * 包含分歧柱、正确干支、依据流派、必填时间来源、理由
 */
function renderVerdictForm() {
  const formEl = document.getElementById('verdict-form-section');
  if (!formEl) return;

  const chart = getActiveChart();
  if (!chart) return;

  // 渲染当前命盘概览
  const curSummaryEl = document.getElementById('verdict-chart-summary');
  if (curSummaryEl) {
    curSummaryEl.innerText = `${state.input.name} · ${chart.ganZhi} · ${state.input.cityName} · ${chartOptionsLabel(currentChartOptions())}`;
  }
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
 * 对照页要对照的那条口径。
 *
 * 原来固定是「三开关全关 vs 当前」。可默认三个开关就是全关的，两边必然一模一样，
 * 页面写「两侧完全一致」，而上方风险条同时在喊「重点分歧，开与关所得时柱不同」——
 * 老师看到的是自相矛盾。真正该并排的是**争议本身的两边**：这个盘因为哪条口径有分歧，
 * 就把那条的开与关摆出来。
 */
const COMPARE_DIMENSIONS = [
  {
    kind: RISK_KIND.TRUE_SOLAR,
    cause: '真太阳时校正',
    left: { name: '不做真太阳时校正', patch: { applyTrueSolar: false } },
    right: { name: '做真太阳时校正', patch: { applyTrueSolar: true } },
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
  },
];

// 这个盘不在任何已知分歧区时的兜底：仍然让老师看清三个开关合起来改了什么
const COMPARE_FALLBACK = {
  kind: null,
  cause: '当前开关',
  left: { name: '未校正（按钟表时直接排）', patch: { applyTrueSolar: false, applyDst: false, sect: 1 } },
  right: { name: '当前口径', patch: {} },
};

/** 老师在对照页点了哪一边（尚未确认提交） */
let comparePendingSide = null;

/** 按盘上的风险挑一条来对照，挑不出就走兜底 */
function pickCompareDimension(chart) {
  const kinds = new Set((chart.risks || []).map((r) => r.kind));
  return COMPARE_DIMENSIONS.find((d) => kinds.has(d.kind)) ?? COMPARE_FALLBACK;
}

/** 在当前输入基础上套一组开关，算出那一侧的盘与口径快照 */
function computeSide(patch) {
  const options = { ...currentSwitches(), ...patch };
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
  return { chart, options: { ...options, timeFold: chart.input.timeFold } };
}

/** 渲染对照页（优先级 5） */
function renderCompare() {
  const chart = getActiveChart();
  if (!chart) return;

  const dim = pickCompareDimension(chart);
  const left = computeSide(dim.left.patch);
  const right = computeSide(dim.right.patch);

  const diffKeys = PILLAR_KEYS.filter(
    (k) => left.chart.pillars[k].ganZhi !== right.chart.pillars[k].ganZhi,
  );

  const column = (side, highlight) => PILLAR_KEYS.map((k) => {
    const isDiff = diffKeys.includes(k);
    return `
      <div class="comp-pillar-item ${isDiff ? 'comp-diff' : ''}">
        <span class="comp-k">${PILLAR_NAMES[k]}</span>
        <span class="comp-v ${isDiff && highlight ? 'highlight-cinnabar' : ''}">${escapeHtml(side.chart.pillars[k].ganZhi)}</span>
      </div>
    `;
  }).join('');

  setHtml('compare-base-kicker', escapeHtml(dim.left.name));
  setHtml('compare-curr-kicker', escapeHtml(dim.right.name));
  setHtml('compare-base-pillars', column(left, false));
  setHtml('compare-curr-pillars', column(right, true));

  setHtml('compare-sub', diffKeys.length
    ? `这个盘在<strong>${escapeHtml(dim.cause)}</strong>上存在争议，两种排法并排在下面，不同的柱标朱砂。
       哪一套对由您判断，工具不替您裁定——但请告诉我们您按哪一套。`
    : `这个盘按<strong>${escapeHtml(dim.cause)}</strong>的两种排法结果相同，没有需要您裁定的地方。`);

  setHtml('compare-diff-explanation', diffKeys.length
    ? `<div class="alert-cinnabar">● 两种排法有 <strong>${diffKeys.length}</strong> 处柱位不同（已朱砂高亮）：${
        diffKeys.map((k) => PILLAR_NAMES[k]).join('、')}。</div>
       <div class="note-desc"><strong>由什么引起</strong>：${escapeHtml(dim.cause)}。</div>`
    : `<div class="alert-green">● 两种排法结果<strong>完全一致</strong>。</div>
       <div class="note-desc">神煞条目差异属「表不同」，不是历法或口径错误。</div>`);

  renderCompareActions(dim, left, right, diffKeys);
}

/**
 * 一键裁定。老师在这一页要回答的就是「你按哪一套排」——
 * 这是整个试用最值钱的一次点击，原来这页却连个提交入口都没有，
 * 文案还写着「请在下方直接写出正确的四柱」，而下方什么都没有。
 */
function renderCompareActions(dim, left, right, diffKeys) {
  const el = document.getElementById('compare-actions');
  if (!el) return;

  if (diffKeys.length === 0) {
    el.innerHTML = '';
    comparePendingSide = null;
    return;
  }

  const picked = comparePendingSide;
  const sideName = picked === 'left' ? dim.left.name : dim.right.name;

  el.innerHTML = `
    <div class="compare-pick-row">
      <button type="button" class="compare-pick-btn ${picked === 'left' ? 'active' : ''}"
        onclick="window.app.pickCompareSide('left')">我按左边这套排<br>${escapeHtml(dim.left.name)}</button>
      <button type="button" class="compare-pick-btn ${picked === 'right' ? 'active' : ''}"
        onclick="window.app.pickCompareSide('right')">我按右边这套排<br>${escapeHtml(dim.right.name)}</button>
    </div>
    <button type="button" class="compare-pick-none" onclick="window.app.goWriteVerdict()">
      两边都不对，我自己写正确的四柱 →
    </button>
    ${picked ? `
      <div class="compare-confirm">
        您选的是「<strong>${escapeHtml(sideName)}</strong>」，四柱为
        <strong>${escapeHtml((picked === 'left' ? left : right).chart.ganZhi)}</strong>。
        还差一项——这个盘的出生时间是哪来的？
        <div class="radio-group">
          <label><input type="radio" name="compare-time-source" value="出生证"> 出生证</label>
          <label><input type="radio" name="compare-time-source" value="家人口述"> 家人口述</label>
          <label><input type="radio" name="compare-time-source" value="客户自报"> 客户自报</label>
        </div>
        <button type="button" class="primary-btn" onclick="window.app.submitCompareVerdict()">确认并记录</button>
      </div>` : ''}
  `;
}

/** 老师点了某一边：先把主盘切到这套口径，让他看到的就是他选的 */
export function pickCompareSide(side) {
  comparePendingSide = side;
  const chart = getActiveChart();
  if (!chart) return;

  const dim = pickCompareDimension(chart);
  Object.assign(state.input, side === 'left' ? dim.left.patch : dim.right.patch);
  runCompute();   // 内部会重跑 renderCompare，把按钮的选中态一并刷新
}

/** 确认提交对照页的一键裁定 */
export function submitCompareVerdict() {
  if (!comparePendingSide) return;
  const chart = getActiveChart();
  if (!chart) return;

  const sourceEl = document.querySelector('input[name="compare-time-source"]:checked');
  if (!sourceEl) {
    showToast('❌ 请先选出生时间的来源：出生证 / 家人口述 / 客户自报');
    return;
  }

  // 主盘此刻已经切到老师选的那一套（见 pickCompareSide），
  // 所以「他认可当前这个盘」= 无分歧，口径快照记的就是他选的这套。
  recordVerdict({
    disputedPillars: [],
    teacherGanZhi: {},
    ourGanZhi: chart.ganZhi,
    options: currentChartOptions(),
    cityName: state.input.cityName,
    longitude: Number(state.input.longitude),
    school: '',
    timeSource: sourceEl.value,
    reason: '在口径对照页选定',
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

  for (let idx = state.verdicts.length - 1; idx >= 0; idx--) {
    const v = state.verdicts[idx];
    const isConsistent = v.disputedPillars.length === 0;

    html += `
      <div class="verdict-card ${isConsistent ? 'card-consistent' : 'card-disputed'}">
        <div class="verdict-card-header">
          <span class="verdict-tag ${isConsistent ? 'tag-consistent' : 'tag-disputed'}">
            ${isConsistent ? '✅ 与我们一致' : '⚠️ 存在分歧'}
          </span>
          <span class="verdict-time">${v.createdAt ? v.createdAt.slice(0, 16).replace('T', ' ') : ''}</span>
          <button class="verdict-del-btn" onclick="window.app.deleteVerdict(${idx})">删除</button>
        </div>
        <div class="verdict-card-body">
          <div class="verdict-prop"><strong>命盘</strong>：${escapeHtml(verdictChartLabel(v, caseById))}</div>
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
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

/** 渲染批量命例列表 */
export function renderBatchList() {
  const listEl = document.getElementById('batch-cases-list');
  if (!listEl) return;

  if (state.cases.length === 0) {
    listEl.innerHTML = '<div class="empty-sub">尚无命例。可在「单个录入」逐个录，也可在上方粘贴后点「解析并追加到列表」。</div>';
    return;
  }

  let html = `<div class="batch-count-bar">本机命例 <strong>${state.cases.length}</strong> 条（单个录入与批量粘贴都在这里，点击任一条载入排盘）：</div>`;

  state.cases.forEach((c, idx) => {
    const isActive = idx === state.activeCaseIndex;
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

/** 切换 Tab */
export function switchTab(tabId) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));

  const tabBtn = document.getElementById(`tab-btn-${tabId}`);
  if (tabBtn) tabBtn.classList.add('active');

  const pane = document.getElementById(`tab-${tabId}`);
  if (pane) pane.classList.add('active');

  // 回到顶部。不然从盘底部切到「快速录入」，那一页顶上的
  // 「单个录入 / 批量录入」切换正好被吸顶的 tab 栏挡住，老师看不见它。
  window.scrollTo(0, 0);

  if (tabId === 'verdicts') {
    renderVerdictsList();
  } else if (tabId === 'compare') {
    renderCompare();
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
  if (auditBox) {
    const isHidden = auditBox.style.display === 'none' || !auditBox.style.display;
    auditBox.style.display = isHidden ? 'block' : 'none';
  }
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
  let msg = `【${ss.name}】\n口诀出处：${ss.source || '古籍通行口诀'}`;
  if (ss.pendingTeacherConfirm) {
    msg += `\n⚠️ 提示：该神煞表源待老师确认`;
  }
  showToast(msg, 4500);
}

/** 从 12 位快速输入直接排盘 */
export function apply12DigitInput() {
  const inputEl = document.getElementById('quick-12-input');
  if (!inputEl) return;

  const raw = inputEl.value;
  const res = parse12Digit(raw);
  if (!res.valid) {
    showToast(res.message);
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

  // 先落命例再排盘：老师从这条路径录入的盘也要能同步上去，否则裁定收上来无从复现
  upsertCaseFromInput();

  runCompute();
  switchTab('chart');
  showToast(`已成功录入并排盘：${res.formatted}`);
}

/** 城市检索输入 */
/** 展示名的层级：一段=省、两段=市、三段及以上=区县。 */
function cityLevelLabel(name) {
  const depth = String(name || '').trim().split(/\s+/).filter(Boolean).length;
  if (depth >= 3) return '区县';
  if (depth === 2) return '市 · 辖区质心';
  return '省';
}

export function onCitySearchInput(query) {
  const listEl = document.getElementById('city-search-results');
  if (!listEl) return;

  if (!query || !query.trim()) {
    listEl.style.display = 'none';
    listEl.innerHTML = '';
    return;
  }

  // 城市库还在路上：给个说法，别让下拉空着像是没匹配到
  if (!state.lookupCityFn) {
    listEl.style.display = 'block';
    listEl.innerHTML = '<div class="city-opt-item empty">城市库加载中…</div>';
    whenCityDataReady().then(() => {
      const inputEl = document.getElementById('city-search-input');
      if (inputEl && inputEl.value.trim()) onCitySearchInput(inputEl.value);
    });
    return;
  }

  const matches = state.lookupCityFn(query).slice(0, 10);
  if (matches.length === 0) {
    listEl.style.display = 'block';
    listEl.innerHTML = '<div class="city-opt-item empty">未找到匹配县市</div>';
    return;
  }

  let html = '';
  matches.forEach((c) => {
    html += `
      <div class="city-opt-item" onclick="window.app.selectCity('${escapeHtml(c.name)}', ${c.lng})">
        <span class="city-name">${escapeHtml(c.name)}</span>
        <span class="city-level">${cityLevelLabel(c.name)}</span>
        <span class="city-lng">${c.lng}°E</span>
      </div>
    `;
  });

  listEl.style.display = 'block';
  listEl.innerHTML = html;
}

/**
 * 出生地精度提示。
 * GeoNames 的地级市（ADM2）坐标是整个辖区的质心，不是市中心——例如杭州市 119.60
 * 而上城区 120.30，差 0.56° ≈ 2.2 分钟时差（杭州辖区西达淳安）。远小于时辰跨度，
 * 但落在时辰边界附近的盘会被它翻过去，所以引导老师选到区县。
 * 见 engine/data/cities.SOURCE.md。
 */
function cityPrecisionHint(name) {
  const depth = String(name || '').trim().split(/\s+/).filter(Boolean).length;
  if (depth >= 3) return null;
  if (depth === 2) {
    return '当前只选到市级。地级市坐标取的是整个辖区质心而非市中心，'
      + '与实际出生区县可能差几分钟时差。<b>建议精确到区县</b>，尤其当出生时间接近时辰交界。';
  }
  return '当前只选到省级，经度误差可能达到数十分钟时差，足以整柱改时柱。<b>请至少选到市，最好到区县。</b>';
}

function renderCityPrecisionHint(name) {
  const el = document.getElementById('city-precision-hint');
  if (!el) return;
  const msg = cityPrecisionHint(name);
  if (!msg) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = 'block';
  el.innerHTML = msg;
}

/** 选中城市 */
export function selectCity(name, lng) {
  state.input.cityName = name;
  state.input.longitude = lng;
  state.input.cityKnown = true;
  renderCityPrecisionHint(name);

  const cityInput = document.getElementById('city-search-input');
  if (cityInput) cityInput.value = name;

  const lngInput = document.getElementById('custom-lng-input');
  if (lngInput) lngInput.value = lng;

  const listEl = document.getElementById('city-search-results');
  if (listEl) listEl.style.display = 'none';

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
  Object.assign(state.input, {
    name: '',
    cityName: '',
    longitude: 120,
    cityKnown: false,   // 没填出生地，引擎会报 CITY_UNKNOWN，别让它悄悄按 120 度算
  });

  for (const id of ['quick-12-input', 'quick-name-input', 'city-search-input']) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  }
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
export async function applyBatchInput() {
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

/** 删除批量列表中的单条命例 */
export function removeBatchCase(index) {
  const removed = state.cases[index];
  if (!removed) return;

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
  state.cases = [];
  state.activeCaseIndex = -1;
  persistCases();
  renderBatchList();
  showToast('已清空批量命例列表');
}

/** 载入典型测试样盘库 */
export async function loadSampleCases() {
  const samples = [
    'Alanzhou 199608101203 兰州 坤造 出生证',
    '兰州夏令时 198807151100 兰州 乾造 家人口述',
    '子时交界 199303272330 兰州 乾造 客户自报',
    '夏令时重复时 198609140130 兰州 坤造 出生证',
    '立秋交节 202608071940 北京 坤造 出生证',
  ];

  const textEl = document.getElementById('batch-textarea');
  if (textEl) {
    textEl.value = samples.join('\n');
    await applyBatchInput();
  }
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

  const preview = document.getElementById('quick-12-preview');
  if (preview) {
    preview.innerText = `✓ 识别为：${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`;
    preview.className = 'quick-preview valid';
  }

  const nameInput = document.getElementById('quick-name-input');
  if (nameInput) nameInput.value = name ?? '';

  const genderRadio = document.querySelector(`input[name="quick-gender"][value="${gender}"]`);
  if (genderRadio) genderRadio.checked = true;

  const cityInput = document.getElementById('city-search-input');
  if (cityInput) cityInput.value = cityName ?? '';

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

/** 提交老师裁定（§13.2） */
export function submitVerdict() {
  const chart = getActiveChart();
  if (!chart) return;

  // 1. 获取时间来源（必填项！）
  const timeSourceEl = document.querySelector('input[name="verdict-time-source"]:checked');
  if (!timeSourceEl) {
    showToast('❌ 时间来源为必填项！请选择：出生证 / 家人口述 / 客户自报');
    return;
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
        showToast(`❌ 请填写${PILLAR_NAMES[k]}您认为正确的干支——只勾"有分歧"我们不知道该改成什么`);
        return;
      }
      if (!isValidGanZhi(gan, zhi)) {
        showToast(`❌ ${PILLAR_NAMES[k]}「${gan}${zhi}」不在六十甲子内（阳干只配阳支、阴干只配阴支），请重选`);
        return;
      }
      teacherGanZhi[k] = `${gan}${zhi}`;
    }

    if (disputedPillars.length === 0) {
      showToast('请勾选分歧柱（或勾选「与我们一致」）');
      return;
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
  });

  // 清空表单
  resetVerdictForm();

  showToast('✅ 已记录这条裁定，可在「老师裁定」里查看与导出');
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

  // 时间来源与依据流派刻意不预选、提交后也复位：
  // 预选等于替老师答了，落库后分不清「他选了出生证」和「他没管这一栏」
  for (const radio of document.querySelectorAll('input[name="verdict-time-source"]')) {
    radio.checked = false;
  }
  const schoolSelect = document.getElementById('verdict-school-select');
  if (schoolSelect) schoolSelect.value = '';
  const schoolCustom = document.getElementById('verdict-school-custom');
  if (schoolCustom) schoolCustom.value = '';
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

export function syncSolar(checked) {
  state.input.applyTrueSolar = Boolean(checked);
  const tb = document.getElementById('toolbar-solar');
  if (tb) tb.checked = checked;
  runCompute();
}

export function syncDst(checked) {
  state.input.applyDst = Boolean(checked);
  const tb = document.getElementById('toolbar-dst');
  if (tb) tb.checked = checked;
  runCompute();
}

export function syncSect(sectValue) {
  state.input.sect = Number(sectValue);
  runCompute();
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
      apply12DigitInput,
      onCitySearchInput,
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
      onDisputedPillarToggle,
      pickCompareSide,
      submitCompareVerdict,
      goWriteVerdict,
      exportVerdictsJson,
      deleteVerdict,
      clearAllVerdicts,
      syncSolar,
      syncDst,
      syncSect,
    };

    initTeacherToken();
    loadPersistedData();
    // 把上次留存的批量命例先渲染出来，否则追加解析时列表看着是空的
    renderBatchList();
    renderSyncStatus();
    // 不 await：城市库慢，但首盘用不上它，让老师先看到盘
    whenCityDataReady();

    if (state.teacher.token) {
      fetchTeacherName();
      runSync();                                        // 补传上次没送出去的
      window.addEventListener('online', () => runSync()); // 网络恢复即重试
    }

    // 监听 12 位快速输入的实时输入，满 12 位时自动预览格式
    const q12 = document.getElementById('quick-12-input');
    const preview = document.getElementById('quick-12-preview');
    if (q12 && preview) {
      q12.addEventListener('input', () => {
        const val = q12.value.trim();
        if (val.length === 12) {
          const res = parse12Digit(val);
          if (res.valid) {
            preview.innerText = `✓ 识别为：${res.formatted}`;
            preview.className = 'quick-preview valid';
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
    restoreLastCase();
    runCompute();

    // 首盘已出，撤下遮罩——在这之前页面上是骨架里的占位盘，不能让老师看见
    document.body.classList.remove('engine-loading');
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
}

