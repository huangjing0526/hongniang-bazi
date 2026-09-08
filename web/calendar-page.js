import { Solar } from 'lunar-javascript';
import { computeChart } from '../engine/src/chart.js';
import {
  HKO_DATE_EXCEPTIONS,
  JIE_NAMES,
  almanacPillars,
  dayGanZhiByJdn,
  dayTimeGanZhiAt,
  fmtTerm,
  hourZhiIndex,
  isYearVerified,
  jieQiTableOf,
  monthGanZhiAt,
  toEpochSecond,
} from '../engine/src/calendar.js';
import { trueSolarOffsetMinutes } from '../engine/src/solartime.js';
import { PILLAR_KEYS, ZHI } from '../engine/src/contract.js';
import { mount as mountDateTimePicker } from './components/datetime-picker.js';
import { mount as mountRegionPicker } from './components/region-picker.js';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const PILLAR_NAMES = { year: '年柱', month: '月柱', day: '日柱', time: '时柱' };
const pad = (value) => String(value).padStart(2, '0');

export const almanacState = {
  year: 1996,
  month: 8,
  day: 10,
  hour: 12,
  minute: 3,
  cityName: '甘肃省 兰州市 城关区',
  longitude: 103.825,
  sect: 1,
};

let appState = null;
let getActiveChart = null;
let switchToTab = null;
let dateTimePicker = null;
let regionPicker = null;
let fromChart = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function fieldsFromSeconds(seconds) {
  const date = new Date(seconds * 1000);
  return {
    year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
    hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds(),
  };
}

function markEdited(changes) {
  Object.assign(almanacState, changes);
  fromChart = false;
  renderAlmanac();
}

function computeAlmanacChart() {
  return computeChart({
    ...almanacState,
    applyDst: Boolean(appState.input.applyDst),
    applyTrueSolar: true,
    cityKnown: true,
    gender: appState.input.gender,
  }).charts[0];
}

function lunarLabel(year, month, day) {
  const lunar = Solar.fromYmd(year, month, day).getLunar();
  if (lunar.getDay() !== 1) return lunar.getDayInChinese();
  return `${lunar.getMonth() < 0 ? '闰' : ''}${lunar.getMonthInChinese()}月`;
}

function renderMonth(chart) {
  const { year, month, day } = almanacState;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const termsByDay = new Map();
  for (const term of jieQiTableOf(year).filter((item) => item.at.month === month)) {
    termsByDay.set(term.at.day, `${term.name} ${fmtTerm(term).slice(11)}`);
  }
  const rows = [];
  for (let currentDay = 1; currentDay <= days; currentDay += 1) {
    rows.push(`<tr class="${currentDay === day ? 'alm-selected-row' : ''}">
      <td>${currentDay} 日</td>
      <td>星期${WEEKDAYS[new Date(Date.UTC(year, month - 1, currentDay)).getUTCDay()]}</td>
      <td>${escapeHtml(lunarLabel(year, month, currentDay))}</td>
      <td class="alm-gan-zhi">${dayGanZhiByJdn(year, month, currentDay)}</td>
      <td>${escapeHtml(termsByDay.get(currentDay) ?? '')}</td>
    </tr>`);
  }
  return `<div class="card-box alm-section">
    <div class="card-title"><span>${year} 年 ${month} 月</span><span class="alm-card-note">所选日已标朱砂</span></div>
    <div class="alm-table-scroll"><table class="alm-table"><thead><tr><th>公历日</th><th>星期</th><th>农历</th><th>日干支</th><th>节气</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
  </div>`;
}

function distanceLabel(term, beijing) {
  const difference = term.seconds - toEpochSecond(beijing);
  const absoluteMinutes = Math.floor(Math.abs(difference) / 60);
  return `${difference >= 0 ? '+' : '−'}${Math.floor(absoluteMinutes / 60)} 小时 ${absoluteMinutes % 60} 分`;
}

function exceptionLabel(term) {
  const exception = HKO_DATE_EXCEPTIONS[almanacState.year]?.[term.name];
  if (!exception) return '';
  const day = Number(String(exception).split('-').at(-1));
  return `<span class="alm-exception">老历书可能记在 ${day} 日</span>`;
}

function renderTerms(chart) {
  const terms = jieQiTableOf(almanacState.year).filter((term) => term.at.month === almanacState.month);
  const birthSeconds = toEpochSecond(chart.times.beijing);
  const rows = terms.map((term) => {
    const before = monthGanZhiAt(fieldsFromSeconds(term.seconds - 1)).ganZhi;
    const after = monthGanZhiAt(fieldsFromSeconds(term.seconds + 1)).ganZhi;
    const monthChange = JIE_NAMES.has(term.name) ? `<div class="alm-term-note">此节之前月柱 ${before}，之后 ${after}</div>` : '';
    const position = birthSeconds < term.seconds ? '出生时刻 → 交节' : '交节 → 出生时刻';
    return `<tr>
      <td><strong>${term.name}</strong>${JIE_NAMES.has(term.name) ? '（节）' : '（气）'} ${exceptionLabel(term)}</td>
      <td>${fmtTerm(term)}${monthChange}</td>
      <td>${position}<br><span class="alm-distance">${distanceLabel(term, chart.times.beijing)}</span></td>
    </tr>`;
  });
  const lunarException = almanacState.year === 2057 && almanacState.month === 9
    ? '<div class="risk-box risk-has-info alm-inline-notice">2057-09-28 各家历书对是八月三十还是九月初一不一致。</div>'
    : '';
  return `<div class="card-box alm-section">
    <div class="card-title">本月节气（北京时间）</div>
    <div class="alm-table-scroll"><table class="alm-table"><thead><tr><th>节气</th><th>准确交节时刻</th><th>距出生时刻</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
    ${lunarException}
  </div>`;
}

function shiftWallTime(time, minutes) {
  return fieldsFromSeconds(toEpochSecond(time) + Math.round(minutes * 60));
}

function beijingBoundaryFor(trueSolarBoundary) {
  const firstOffset = trueSolarOffsetMinutes(trueSolarBoundary, almanacState.longitude).totalMinutes;
  const estimate = shiftWallTime(trueSolarBoundary, -firstOffset);
  const offset = trueSolarOffsetMinutes(estimate, almanacState.longitude).totalMinutes;
  return shiftWallTime(trueSolarBoundary, -offset);
}

function timeRangeLabel(index) {
  const startHour = index === 0 ? 23 : index * 2 - 1;
  const endHour = (startHour + 2) % 24;
  return `${pad(startHour)}:00–${pad(endHour)}:00`;
}

function localRangeLabel(index) {
  const startHour = index === 0 ? 23 : index * 2 - 1;
  const startDayOffset = index === 0 ? -1 : 0;
  const start = fieldsFromSeconds(toEpochSecond(almanacState) + startDayOffset * 86400 + (startHour - almanacState.hour) * 3600 - almanacState.minute * 60);
  const end = fieldsFromSeconds(toEpochSecond(start) + 7200);
  const beijingStart = beijingBoundaryFor(start);
  const beijingEnd = beijingBoundaryFor(end);
  return `${pad(beijingStart.hour)}:${pad(beijingStart.minute)}–${pad(beijingEnd.hour)}:${pad(beijingEnd.minute)}`;
}

function renderHours(chart) {
  // 高亮按真太阳时定时辰：第三列已经把每个时辰换成了本地对应的北京时区间，
  // 出生的钟表时落在哪一段就是哪一行。按钟表小时高亮会和第三列自相矛盾。
  const trueSolar = chart.times.trueSolar;
  const selectedIndex = hourZhiIndex(trueSolar.hour);
  const offset = trueSolarOffsetMinutes(chart.times.beijing, almanacState.longitude).totalMinutes;
  const rows = ZHI.map((zhi, index) => {
    const at = (hour) => ({ ...almanacState, hour, minute: 0 });
    let timePillar;
    let dayNote = '';
    if (index === 0) {
      // 子时横跨两天：早子（00–01）两派同结果；晚子（23–24）时干按次日起、日柱两派不同
      const early = dayTimeGanZhiAt(at(0), 1);
      const late1 = dayTimeGanZhiAt(at(23), 1);
      const late2 = dayTimeGanZhiAt(at(23), 2);
      timePillar = `早子（00–01）${early.time} · 晚子（23–24）${late1.time}`;
      dayNote = `<div class="alm-hour-note">晚子日柱：子初换日按次日 ${late1.day}，早晚子时按本日 ${late2.day}</div>`;
    } else {
      timePillar = dayTimeGanZhiAt(at(index * 2), 1).time;
    }
    return `<tr class="${index === selectedIndex ? 'alm-selected-row' : ''}">
      <td>${zhi}时</td><td>${timeRangeLabel(index)}</td><td>${localRangeLabel(index)}</td>
      <td class="alm-gan-zhi">${timePillar}${dayNote}</td>
    </tr>`;
  });
  const birth = `钟表时 ${pad(almanacState.hour)}:${pad(almanacState.minute)} → 真太阳时 ${pad(trueSolar.hour)}:${pad(trueSolar.minute)}`;
  return `<div class="card-box alm-section">
    <div class="card-title"><span>本日十二时辰</span><span class="alm-card-note">出生时辰已标朱砂（${birth}）</span></div>
    <div class="card-sub">本地真太阳时相对北京时间偏移 ${offset >= 0 ? '+' : ''}${offset.toFixed(1)} 分钟；下表第三列为反推的北京时间。</div>
    <div class="alm-table-scroll"><table class="alm-table alm-hours-table"><thead><tr><th>时辰</th><th>北京时区间</th><th>本地真太阳时对应北京时</th><th>时柱</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
  </div>`;
}

function renderComparison() {
  if (!fromChart) return '';
  const chart = getActiveChart();
  if (!chart) return '';
  const ours = almanacPillars({
    beijing: chart.times.beijing,
    trueSolar: chart.times.trueSolar,
    sect: appState.input.sect,
  });
  const cells = PILLAR_KEYS.map((key) => {
    const chartValue = chart.pillars[key].ganZhi;
    const same = chartValue === ours[key];
    return `<div class="alm-comparison-cell ${same ? 'alm-same' : 'alm-different'}">
      <div class="alm-comparison-name">${PILLAR_NAMES[key]}</div>
      <div class="alm-comparison-values">${chartValue}${same ? '' : ` / ${ours[key]}`}</div>
      <div>${same ? '一致' : '此柱两种推法不一致，请以万年历页为准复核'}</div>
    </div>`;
  }).join('');
  return `<div class="card-box alm-section"><div class="card-title">对照结论</div><div class="alm-comparison-grid">${cells}</div></div>`;
}

function renderAccuracy() {
  const warning = isYearVerified(almanacState.year)
    ? ''
    : '<div class="risk-box risk-has-warn alm-accuracy-warning">本年节气时刻未经交叉验证。</div>';
  return `<div class="card-box alm-section alm-source">
    <div class="card-title">来源与精度声明</div>
    ${warning}
    <p>节气时刻据本工具冻结表（北京时间，精确到秒）；表由独立天文算法生成，与香港天文台 1901–2100 逐年核对。</p>
    <p>各家万年历有的截断到分、有的四舍五入，所以这里带秒显示。</p>
  </div>`;
}

export function renderAlmanac() {
  const content = document.getElementById('almanac-content');
  if (!content || !appState) return;
  try {
    const chart = computeAlmanacChart();
    content.innerHTML = renderMonth(chart) + renderTerms(chart) + renderHours(chart) + renderComparison() + renderAccuracy();
  } catch (error) {
    console.error('渲染万年历失败:', error);
    content.innerHTML = `<div class="risk-box risk-has-warn alm-render-error">万年历暂时无法生成：${escapeHtml(error.message)}</div>`;
  }
}

export function openAlmanacFromChart() {
  Object.assign(almanacState, {
    year: appState.input.year,
    month: appState.input.month,
    day: appState.input.day,
    hour: appState.input.hour,
    minute: appState.input.minute,
    cityName: appState.input.cityName,
    longitude: appState.input.longitude,
    sect: appState.input.sect,
  });
  fromChart = true;
  dateTimePicker?.setValue(almanacState);
  regionPicker?.setValue(almanacState.cityName);
  const longitudeInput = document.getElementById('almanac-longitude');
  if (longitudeInput) longitudeInput.value = String(almanacState.longitude);
  document.querySelectorAll('input[name="almanac-sect"]').forEach((radio) => {
    radio.checked = Number(radio.value) === almanacState.sect;
  });
  switchToTab('almanac');
}

export function mountAlmanac(options) {
  appState = options.appState;
  getActiveChart = options.getActiveChart;
  switchToTab = options.switchTab;
  Object.assign(almanacState, {
    year: appState.input.year, month: appState.input.month, day: appState.input.day,
    hour: appState.input.hour, minute: appState.input.minute,
    cityName: appState.input.cityName, longitude: appState.input.longitude, sect: appState.input.sect,
  });

  dateTimePicker = mountDateTimePicker(document.getElementById('almanac-dtp'), {
    value: almanacState,
    minYear: 1900,
    maxYear: 2100,
    onChange: markEdited,
  });
  regionPicker = mountRegionPicker(document.getElementById('almanac-region'), {
    value: almanacState.cityName,
    cities: appState.cities.length ? appState.cities : undefined,
    lookup: appState.lookupCityFn ?? undefined,
    onChange: (entry) => {
      const longitudeInput = document.getElementById('almanac-longitude');
      if (longitudeInput) longitudeInput.value = String(entry.lng);
      markEdited({ cityName: entry.name, longitude: entry.lng });
    },
  });
  document.getElementById('almanac-longitude')?.addEventListener('change', (event) => {
    markEdited({ longitude: Number(event.target.value) });
  });
  document.querySelectorAll('input[name="almanac-sect"]').forEach((radio) => {
    radio.addEventListener('change', () => markEdited({ sect: Number(radio.value) }));
  });
  renderAlmanac();
  return { regionPicker };
}
