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
    applyDst: false,        // 默认关，由老师按需开
    applyTrueSolar: false,  // 默认关；开启后兰州这类西部盘会跨时辰
    sect: 1,                // 流派1: 子初换日; 2: 早晚子时
    timeFold: 'unknown',
  },
  // 引擎计算输出结果
  currentResult: null,
  activeChartIndex: 0,
  // 批量命例列表
  batchCases: [],
  activeCaseIndex: -1,
  // 历史裁定记录
  verdicts: [],
  // 城市检索缓存
  cities: [],
  lookupCityFn: null,
  // 云端同步（无邀请码时全程不联网，保持本机模式）
  teacher: { token: '', name: '' },
  sync: { status: 'local', lastError: '', lastSyncedAt: '' },
};

// ============================================================================
// 1. 初始化与城市数据加载
// ============================================================================

/** 尝试导入或异步加载城市库，支持优雅降级 */
async function initCityData() {
  try {
    const cityModule = await import('../engine/src/city.js');
    state.lookupCityFn = cityModule.lookupCity;
  } catch (err) {
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
    } catch (e2) {
      console.error('加载城市数据失败:', e2);
      state.lookupCityFn = () => [];
    }
  }
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
    const savedCases = localStorage.getItem('bazi_batch_cases');
    if (savedCases) {
      state.batchCases = JSON.parse(savedCases);
    }
  } catch (e) {
    console.error('读取 localStorage 失败:', e);
  }
}

/** 保存批量命例至 localStorage */
function persistBatchCases() {
  try {
    localStorage.setItem('bazi_batch_cases', JSON.stringify(state.batchCases));
  } catch (e) {
    console.error('保存批量命例至 localStorage 失败:', e);
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
    const resp = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-teacher-token': state.teacher.token },
      body: JSON.stringify({ cases: state.batchCases, verdicts: state.verdicts }),
    });
    const body = await resp.json().catch(() => null);

    if (!resp.ok || !body || body.code !== 0) {
      const message = (body && body.message) || `同步失败（HTTP ${resp.status}）`;
      throw new Error(message);
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

  const pending = state.batchCases.length + state.verdicts.length;
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
    let cityName = '未知地（按标准时）';
    let longitude = 120.0;
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
      // 城市查找测试
      if (state.lookupCityFn) {
        const foundCities = state.lookupCityFn(token);
        if (foundCities.length > 0) {
          cityName = foundCities[0].name;
          longitude = foundCities[0].lng;
          continue;
        }
      }
      if (name === `命例 ${idx + 1}` && token.length <= 8) {
        name = token;
      }
    }

    parsed.push({
      id: `case_${Date.now()}_${idx}`,
      raw: line,
      name,
      gender,
      cityName,
      longitude,
      timeSource,
      parsedTime: dateTimeParsed,
      status: dateTimeParsed ? 'valid' : 'error',
      errorMsg: dateTimeParsed ? '' : '未能提取到有效出生时间（需 12 位数字或 YYYY-MM-DD HH:mm）',
    });
  }

  return parsed;
}

// ============================================================================
// 3. 核心排盘驱动
// ============================================================================

/** 执行排盘并更新当前状态 */
export function runCompute() {
  const { year, month, day, hour, minute, longitude, applyDst, applyTrueSolar, sect, timeFold, gender } = state.input;

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

/** 综合渲染主入口 */
function renderAll() {
  renderProfile();
  renderRisks();
  renderDualChartBanner();
  renderToolbarAndAudit();
  renderChartTable();
  renderVerdictForm();
  renderCompare();
  updateVerdictBadge();
}

/** 渲染命主基本信息 */
function renderProfile() {
  const chart = getActiveChart();
  if (!chart) return;

  const dayZhi = chart.pillars.day.zhi;
  const avatarEl = document.getElementById('profile-avatar');
  if (avatarEl) avatarEl.innerText = dayZhi;

  const nameRowEl = document.getElementById('profile-name-row');
  if (nameRowEl) {
    const sealText = state.input.gender === 'female' ? '坤' : '乾';
    nameRowEl.innerHTML = `${escapeHtml(state.input.name)} <span class="seal">${sealText}</span>`;
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

  let html = `<div class="risk-title">⚠️ 历法分歧风险提醒（老师重点复核）：</div><ul class="risk-list">`;
  for (const r of risks) {
    const levelClass = r.level === RISK_LEVEL.WARN ? 'level-warn' : 'level-info';
    const affectsText = r.affects?.map((k) => PILLAR_NAMES[k] || k).join('、') || '全部';
    html += `
      <li class="risk-item ${levelClass}">
        <span class="risk-badge">${r.level === RISK_LEVEL.WARN ? '重点分歧' : '需留心'}</span>
        <span class="risk-affects">[影响${affectsText}]</span>
        <span class="risk-message">${escapeHtml(r.message)}</span>
      </li>
    `;
  }
  html += `</ul>`;
  riskBoxEl.innerHTML = html;
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

  const chartId = `${state.input.year}${String(state.input.month).padStart(2,'0')}${String(state.input.day).padStart(2,'0')}${String(state.input.hour).padStart(2,'0')}${String(state.input.minute).padStart(2,'0')}-${state.input.cityName.slice(0,6)}-${state.input.gender}`;

  // 渲染当前命盘概览
  const curSummaryEl = document.getElementById('verdict-chart-summary');
  if (curSummaryEl) {
    curSummaryEl.innerText = `${state.input.name} · ${chart.ganZhi} · ${state.input.cityName}`;
  }
}

/** 渲染对照抽屉与对照页（优先级 5） */
function renderCompare() {
  const chart = getActiveChart();
  if (!chart) return;

  // 基准盘 = 不做任何校正，直接按钟表时排。用来让老师看清三个开关各改了什么，
  // 不代表任何其他工具的输出。
  const baselineResult = computeChart({
    year: state.input.year,
    month: state.input.month,
    day: state.input.day,
    hour: state.input.hour,
    minute: state.input.minute,
    longitude: Number(state.input.longitude),
    applyDst: false,
    applyTrueSolar: false,
    sect: 1,
    gender: state.input.gender,
  });
  const baseChart = baselineResult.charts[0];

  const basePillars = baseChart.pillars;
  const currPillars = chart.pillars;

  let baseHtml = '';
  let currHtml = '';
  let diffCount = 0;

  for (const k of PILLAR_KEYS) {
    const isDiff = basePillars[k].ganZhi !== currPillars[k].ganZhi;
    if (isDiff) diffCount++;

    baseHtml += `
      <div class="comp-pillar-item ${isDiff ? 'comp-diff' : ''}">
        <span class="comp-k">${PILLAR_NAMES[k]}</span>
        <span class="comp-v">${escapeHtml(basePillars[k].ganZhi)}</span>
      </div>
    `;
    currHtml += `
      <div class="comp-pillar-item ${isDiff ? 'comp-diff' : ''}">
        <span class="comp-k">${PILLAR_NAMES[k]}</span>
        <span class="comp-v ${isDiff ? 'highlight-cinnabar' : ''}">${escapeHtml(currPillars[k].ganZhi)}</span>
      </div>
    `;
  }

  const baseValEl = document.getElementById('compare-base-pillars');
  if (baseValEl) baseValEl.innerHTML = baseHtml;

  const currValEl = document.getElementById('compare-curr-pillars');
  if (currValEl) currValEl.innerHTML = currHtml;


  // 列出当前开关里哪些真的参与了计算，作为分歧成因
  const causes = [];
  if (state.input.applyTrueSolar) causes.push('真太阳时校正');
  if (state.input.applyDst) causes.push('夏令时回拨');
  if (state.input.sect === 2) causes.push('早晚子时流派');

  const descEl = document.getElementById('compare-diff-explanation');
  if (descEl) {
    if (diffCount === 0) {
      descEl.innerHTML = `
        <div class="alert-green">● 当前开关未改变四柱，两侧<strong>完全一致</strong>。</div>
        <div class="note-desc">神煞条目差异属「表不同」，不是历法或口径错误。</div>
      `;
    } else {
      descEl.innerHTML = `
        <div class="alert-cinnabar">● 发现 <strong>${diffCount}</strong> 处柱位口径分歧（已朱砂高亮）。</div>
        <div class="note-desc">
          <strong>由什么引起</strong>：${causes.length ? causes.join('、') : '子时换日流派'}。
          哪一套对由您判断，工具<strong>不替您裁定</strong>；若两边都不对，请在下方直接写出正确的四柱。
        </div>
      `;
    }
  }
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
  const consistentPercent = total > 0 ? ((consistent / total) * 100).toFixed(1) : '0.0';

  html += `
    <div class="verdict-stats-bar">
      <span>已沉淀 <strong>${total}</strong> 份裁定</span>
      <span>与我们一致率：<strong>${consistentPercent}%</strong>（${consistent}/${total}）</span>
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
          <div class="verdict-prop"><strong>命盘识别</strong>：${escapeHtml(v.chartId)}</div>
          ${
            !isConsistent
              ? `<div class="verdict-prop"><strong>分歧柱位</strong>：${v.disputedPillars.map((k) => PILLAR_NAMES[k] || k).join('、')}</div>
                 <div class="verdict-prop"><strong>老师认定干支</strong>：${JSON.stringify(v.teacherGanZhi)}</div>`
              : ''
          }
          <div class="verdict-prop"><strong>时间来源（必填项）</strong>：<span class="source-tag">${escapeHtml(v.timeSource)}</span></div>
          <div class="verdict-prop"><strong>依据流派</strong>：${escapeHtml(v.school || '默认 / 未填')}</div>
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

  if (state.batchCases.length === 0) {
    listEl.innerHTML = '<div class="empty-sub">尚未解析命例，请在上方输入框粘贴后点击「批量解析」。</div>';
    return;
  }

  let html = `<div class="batch-count-bar">已解析 <strong>${state.batchCases.length}</strong> 条命例（点击任一条立即载入排盘）：</div>`;

  state.batchCases.forEach((c, idx) => {
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
        <div class="batch-item-time">${timeStr} · 来源：${escapeHtml(c.timeSource)}</div>
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

  if (!query || !query.trim() || !state.lookupCityFn) {
    listEl.style.display = 'none';
    listEl.innerHTML = '';
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

/** 批量解析文本 */
export function applyBatchInput() {
  const textEl = document.getElementById('batch-textarea');
  if (!textEl) return;

  const text = textEl.value.trim();
  if (!text) {
    showToast('请在文本框中粘贴命例数据');
    return;
  }

  const cases = parseBatchCases(text);
  if (cases.length === 0) {
    showToast('未识别到任何有效命例');
    return;
  }

  // 按原始行去重：跳过列表里已有的，以及本批内部的重复行
  const seen = new Set(state.batchCases.map((c) => normalizeRawLine(c.raw)));
  const fresh = [];
  for (const c of cases) {
    const key = normalizeRawLine(c.raw);
    if (seen.has(key)) continue;
    seen.add(key);
    fresh.push(c);
  }

  const skipped = cases.length - fresh.length;
  if (fresh.length === 0) {
    showToast(`这 ${cases.length} 条命例都已在列表中，未重复追加`);
    return;
  }

  // 追加到现有列表末尾，不覆盖之前解析过的命例
  const startIndex = state.batchCases.length;
  const hadActiveCase = state.activeCaseIndex >= 0;
  state.batchCases = state.batchCases.concat(fresh);
  persistBatchCases();

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
  showToast(`已追加 ${fresh.length} 条命例${skipTip}，列表共 ${state.batchCases.length} 条`);
}

/** 删除批量列表中的单条命例 */
export function removeBatchCase(index) {
  if (!state.batchCases[index]) return;

  state.batchCases.splice(index, 1);
  // 删掉当前排盘那条则取消高亮，删掉它前面的则整体前移一位
  if (index === state.activeCaseIndex) {
    state.activeCaseIndex = -1;
  } else if (index < state.activeCaseIndex) {
    state.activeCaseIndex -= 1;
  }

  persistBatchCases();
  renderBatchList();
}

/** 清空批量命例列表 */
export function clearBatchCases() {
  if (state.batchCases.length === 0) return;
  if (!confirm('确定清空批量命例列表吗？此操作不可恢复！')) return;
  state.batchCases = [];
  state.activeCaseIndex = -1;
  persistBatchCases();
  renderBatchList();
  showToast('已清空批量命例列表');
}

/** 载入典型测试样盘库 */
export function loadSampleCases() {
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
    applyBatchInput();
  }
}

/** 选中并排特定批次命例 */
export function selectBatchCase(index) {
  const c = state.batchCases[index];
  if (!c) return;

  if (c.status === 'error' || !c.parsedTime) {
    showToast(`无法排盘：${c.errorMsg}`);
    return;
  }

  loadCaseToChart(c, index);
  switchTab('chart');
}

/** 将命例数据载入并执行排盘 */
function loadCaseToChart(c, index) {
  state.activeCaseIndex = index;
  state.input.name = c.name;
  state.input.gender = c.gender;
  state.input.cityName = c.cityName;
  state.input.longitude = c.longitude;
  Object.assign(state.input, c.parsedTime);

  // 同步快速录入区界面值
  const q12 = document.getElementById('quick-12-input');
  if (q12 && c.parsedTime) {
    const pad = (n) => String(n).padStart(2, '0');
    q12.value = `${c.parsedTime.year}${pad(c.parsedTime.month)}${pad(c.parsedTime.day)}${pad(c.parsedTime.hour)}${pad(c.parsedTime.minute)}`;
  }

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
      if (chk && chk.checked) {
        disputedPillars.push(k);
        const valInput = document.getElementById(`verdict-gz-${k}`);
        if (valInput && valInput.value.trim()) {
          teacherGanZhi[k] = valInput.value.trim();
        }
      }
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

  const chartId = `${state.input.year}${String(state.input.month).padStart(2,'0')}${String(state.input.day).padStart(2,'0')}${String(state.input.hour).padStart(2,'0')}${String(state.input.minute).padStart(2,'0')}-${state.input.name}-${state.input.gender}`;

  // 构建符合契约 contract.js 的 Verdict 对象
  const verdict = {
    id: newId(),
    chartId,
    disputedPillars,
    teacherGanZhi,
    school,
    timeSource,
    reason,
    createdAt: new Date().toISOString(),
  };

  state.verdicts.push(verdict);
  persistVerdicts();

  // 清空表单
  resetVerdictForm();

  showToast('✅ 老师裁定已当场记录并存入本地！可在「裁定记录」随时导出');
}

/** 重置裁定表单 */
function resetVerdictForm() {
  const isConsistent = document.getElementById('verdict-consistent');
  if (isConsistent) isConsistent.checked = false;

  for (const k of PILLAR_KEYS) {
    const chk = document.getElementById(`verdict-pillar-${k}`);
    if (chk) chk.checked = false;
    const gzInp = document.getElementById(`verdict-gz-${k}`);
    if (gzInp) gzInp.value = '';
    const group = document.getElementById(`verdict-group-${k}`);
    if (group) group.style.display = 'none';
  }

  const reasonInput = document.getElementById('verdict-reason-input');
  if (reasonInput) reasonInput.value = '';
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
  state.verdicts.splice(index, 1);
  persistVerdicts();
  renderVerdictsList();
  showToast('已删除裁定');
}

/** 清空全部裁定 */
export function clearAllVerdicts() {
  if (state.verdicts.length === 0) return;
  if (!confirm('确定清空所有本地保存的裁定吗？此操作不可恢复！')) return;
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
      applyBatchInput,
      loadSampleCases,
      clearBatchCases,
      removeBatchCase,
      selectBatchCase,
      submitVerdict,
      onConsistentToggle,
      onDisputedPillarToggle,
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
    await initCityData();

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

    // 运行初次排盘（默认 Alanzhou 黄金用例 1996-08-10 12:03）
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

