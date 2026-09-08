// 年 / 月 / 日 / 时 / 分 五个下拉的通用时间控件。
//
// 录入表单与万年历页共用。值的形状与 state.input 的时间字段完全一致，
// 所以它和 12 位速记框可以互相同步，引擎一行不用改。

import { ZHI } from '../../engine/src/contract.js';

const pad = (n) => String(n).padStart(2, '0');

/** 小时 → 时辰。23 与 0 都是子，1、2 是丑，以此类推。 */
export const zhiOfHour = (hour) => ZHI[Math.floor(((hour + 1) % 24) / 2)];

const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

function fillOptions(select, items, selected) {
  select.innerHTML = '';
  for (const { value, label } of items) {
    const opt = document.createElement('option');
    opt.value = String(value);
    opt.textContent = label;
    if (value === selected) opt.selected = true;
    select.appendChild(opt);
  }
}

/**
 * @param {HTMLElement} el 挂载点，内容会被替换
 * @param {object} opts
 * @param {{year:number,month:number,day:number,hour:number,minute:number}} [opts.value]
 * @param {(value:object) => void} [opts.onChange]  任一下拉改动后触发，参数是 getValue()
 * @param {number} [opts.minYear=1900] @param {number} [opts.maxYear=2100]
 *   年份下拉的范围。setValue 传进来的年份不在范围内时会临时补一项，不会吞掉输入。
 */
export function mount(el, { value, onChange, minYear = 1900, maxYear = 2100 } = {}) {
  el.classList.add('dtp');
  el.innerHTML = ['year', 'month', 'day', 'hour', 'minute'].map((k) => `
    <label class="dtp-field dtp-${k}">
      <select class="select-input dtp-select" data-field="${k}" aria-label="${{ year: '年', month: '月', day: '日', hour: '时', minute: '分' }[k]}"></select>
      <span class="dtp-unit">${{ year: '年', month: '月', day: '日', hour: '时', minute: '分' }[k]}</span>
    </label>`).join('');

  const selects = {};
  for (const s of el.querySelectorAll('select')) selects[s.dataset.field] = s;

  const current = () => Number(selects.year.value);
  const currentMonth = () => Number(selects.month.value);

  function fillYears(selectedYear) {
    const lo = Math.min(minYear, selectedYear);
    const hi = Math.max(maxYear, selectedYear);
    const years = [];
    for (let y = lo; y <= hi; y++) years.push({ value: y, label: String(y) });
    fillOptions(selects.year, years, selectedYear);
  }

  function fillDays(selectedDay) {
    const n = daysInMonth(current(), currentMonth());
    const days = [];
    for (let d = 1; d <= n; d++) days.push({ value: d, label: pad(d) });
    // 从 31 号切到小月时把日钳到月末，别让下拉停在一个不存在的选项上
    fillOptions(selects.day, days, Math.min(selectedDay, n));
  }

  fillOptions(selects.month, Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: pad(i + 1) })), 1);
  fillOptions(selects.hour, Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${pad(h)} ${zhiOfHour(h)}` })), 0);
  fillOptions(selects.minute, Array.from({ length: 60 }, (_, m) => ({ value: m, label: pad(m) })), 0);

  function getValue() {
    return {
      year: Number(selects.year.value),
      month: Number(selects.month.value),
      day: Number(selects.day.value),
      hour: Number(selects.hour.value),
      minute: Number(selects.minute.value),
    };
  }

  function setValue(v) {
    if (!v) return;
    fillYears(Number(v.year));
    selects.month.value = String(Number(v.month));
    fillDays(Number(v.day));
    selects.hour.value = String(Number(v.hour));
    selects.minute.value = String(Number(v.minute));
  }

  const handleChange = (e) => {
    if (e.target === selects.year || e.target === selects.month) fillDays(Number(selects.day.value));
    onChange?.(getValue());
  };
  el.addEventListener('change', handleChange);

  const now = new Date();
  setValue(value ?? { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), hour: 12, minute: 0 });

  return {
    getValue,
    setValue,
    destroy() {
      el.removeEventListener('change', handleChange);
      el.innerHTML = '';
    },
  };
}
