// 省 → 市 → 区县 三级联动 + 模糊搜索的通用出生地控件。
//
// 录入表单、批量重名确认条、万年历页共用。数据就是 engine/data/cities.json 那 3206 条
// （展示名「省 市 县」三段），挂载时按空格切段建树，不另备一份数据。
//
// 城市库是懒加载的（253KB，不挡首盘），所以组件允许先挂载、后 setCities。

/** 展示名切段 */
const segmentsOf = (name) => String(name ?? '').trim().split(/\s+/).filter(Boolean);

const PLACEHOLDER = { province: '省 / 直辖市', city: '市', county: '区县' };

/**
 * 把名录建成 省 → 市 → 区县 三层树。
 * 直辖市在名录里写成「北京市 北京市 东城区」，市那一层只有与省同名的一项，界面上把它折掉。
 * 省直辖县级市写成「湖北省 仙桃市」，到市这一层就是叶子，区县下拉为空。
 */
export function buildTree(cities) {
  const provinces = new Map();
  for (const entry of cities) {
    const [p, c, d] = segmentsOf(entry.name);
    if (!p) continue;
    if (!provinces.has(p)) provinces.set(p, { name: p, entry: null, cities: new Map() });
    const prov = provinces.get(p);
    if (!c) { prov.entry = entry; continue; }
    if (!prov.cities.has(c)) prov.cities.set(c, { name: c, entry: null, counties: new Map() });
    const city = prov.cities.get(c);
    if (!d) { city.entry = entry; continue; }
    city.counties.set(d, { name: d, entry });
  }
  return provinces;
}

function fillSelect(select, names, placeholder, selected) {
  select.innerHTML = '';
  const first = document.createElement('option');
  first.value = '';
  first.textContent = placeholder;
  select.appendChild(first);
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (name === selected) opt.selected = true;
    select.appendChild(opt);
  }
  select.disabled = names.length === 0;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 展示名的层级：一段=省、两段=市、三段=区县 */
export function levelOf(name) {
  const depth = segmentsOf(name).length;
  return depth >= 3 ? 'county' : depth === 2 ? 'city' : 'province';
}

/** 每个实例一个 id：候选列表要被 aria-controls / aria-activedescendant 指名道姓 */
let pickerSeq = 0;

// 三个实例传的都是同一个名录数组，树又只读，没必要各建一棵（每棵约 3210 个包装
// 对象）。重名确认条还会随每次重排 destroy + 重新 mount，不 memo 就是每改一次
// 日期都重建一遍整棵树。
let treeCacheList = null;
let treeCacheTree = null;
function treeFor(list) {
  if (list !== treeCacheList) {
    treeCacheList = list;
    treeCacheTree = buildTree(list);
  }
  return treeCacheTree;
}

/**
 * @param {HTMLElement} el 挂载点，内容会被替换
 * @param {object} opts
 * @param {string} [opts.value]  当前出生地展示名。名录里有的回填进三个下拉、搜索框留空；
 *   名录里没有的（批量粘贴常见）原样留在搜索框里，否则就丢了
 * @param {(entry:{name:string,lng:number,lat:number,approx?:boolean,level:string}) => void} [opts.onChange]
 * @param {object[]} [opts.cities]  名录；没有就等 setCities
 * @param {(query:string) => object[]} [opts.lookup]  模糊搜索（engine/src/city.js 的 lookupCity）
 * @param {boolean} [opts.requireLeaf=false]  只在选到没有下级的那一层（区县，或没有区县的市）才触发 onChange。
 *   重名确认条要这个：选了省就当场敲定，条子会立刻收掉，老师根本来不及选到区县。
 * @param {string} [opts.searchPlaceholder]
 */
export function mount(el, { value = '', onChange, cities, lookup, requireLeaf = false, searchPlaceholder = '或直接搜：输入省、市或区县，如 兰州、朝阳' } = {}) {
  el.classList.add('rp');
  const resultsId = `rp-results-${++pickerSeq}`;
  el.innerHTML = `
    <div class="rp-row">
      <select class="select-input rp-select" data-level="province" aria-label="省"></select>
      <select class="select-input rp-select" data-level="city" aria-label="市"></select>
      <select class="select-input rp-select" data-level="county" aria-label="区县"></select>
    </div>
    <div class="city-search-wrap rp-search">
      <input type="text" class="text-input rp-search-input" autocomplete="off"
             role="combobox" aria-expanded="false" aria-autocomplete="list"
             aria-controls="${resultsId}" aria-label="搜索出生地"
             placeholder="${escapeHtml(searchPlaceholder)}">
      <div class="city-results-drop rp-results" id="${resultsId}" role="listbox" aria-label="出生地候选"></div>
    </div>`;

  const selects = {};
  for (const s of el.querySelectorAll('select')) selects[s.dataset.level] = s;
  const searchInput = el.querySelector('.rp-search-input');
  const results = el.querySelector('.rp-results');

  let tree = new Map();
  let lookupFn = lookup ?? null;
  let currentName = value;
  let currentMatches = [];   // 当前候选，键盘选中要按下标取
  let itemEls = [];          // 候选的 DOM，建列表时存一次，免得每次按键重查
  let activeIndex = -1;      // 高亮到第几条，-1 是没高亮

  const provinceNode = () => tree.get(selects.province.value);
  const cityNode = () => {
    const prov = provinceNode();
    if (!prov) return null;
    // 直辖市：市那一层被折掉了，下拉里没选项，但树里就是与省同名的那一个
    return prov.cities.get(selects.city.value) ?? (isMunicipality(prov) ? prov.cities.get(prov.name) : null);
  };
  const isMunicipality = (prov) => prov.cities.size === 1 && prov.cities.has(prov.name);

  function refreshCityOptions(selectedCity) {
    const prov = provinceNode();
    if (!prov) { fillSelect(selects.city, [], PLACEHOLDER.city); selects.city.hidden = false; return; }
    if (isMunicipality(prov)) {
      fillSelect(selects.city, [], PLACEHOLDER.city);
      selects.city.hidden = true;
      return;
    }
    selects.city.hidden = false;
    fillSelect(selects.city, [...prov.cities.keys()], PLACEHOLDER.city, selectedCity);
  }

  function refreshCountyOptions(selectedCounty) {
    const city = cityNode();
    fillSelect(selects.county, city ? [...city.counties.keys()] : [], PLACEHOLDER.county, selectedCounty);
  }

  /** 三个下拉当前指向的名录条目：选到哪层就是哪层；isLeaf 表示这一层下面没有可选项了 */
  function selectedNode() {
    const prov = provinceNode();
    if (!prov) return null;
    const city = cityNode();
    if (!city) return { entry: prov.entry, isLeaf: prov.cities.size === 0 };
    const county = city.counties.get(selects.county.value);
    if (county) return { entry: county.entry, isLeaf: true };
    return { entry: city.entry ?? prov.entry, isLeaf: city.counties.size === 0 };
  }
  const selectedEntry = () => selectedNode()?.entry ?? null;

  function setCities(list, lookupImpl) {
    tree = treeFor(list ?? []);
    if (lookupImpl) lookupFn = lookupImpl;
    fillSelect(selects.province, [...tree.keys()], PLACEHOLDER.province);
    setValue(currentName);
  }

  /**
   * 按展示名回填三个下拉。
   *
   * 搜索框永远是纯搜索框，不兼职显示「当前选的是哪儿」——那件事归三个下拉。
   * 原来不管选没选中都把全名填进去，结果 placeholder（唯一写着「可以直接搜」
   * 的那句）永远被盖住，老师根本不知道这个框能搜；点进去打字还会拼到旧名字
   * 后面，搜出「没找到」。名录外的名字也不必往这儿留：解析不出的行在
   * app.js 里早已被换成 UNKNOWN_CITY 那句占位话，留下来只是拿一句不是地名的
   * 话盖住提示，而那正是老师最需要看见提示的时候。
   */
  function setValue(name) {
    currentName = String(name ?? '');
    const [p, c, d] = segmentsOf(currentName);
    selects.province.value = tree.has(p) ? p : '';
    refreshCityOptions(c);
    refreshCountyOptions(d);
    searchInput.value = '';
    hideResults();
  }

  function emit(entry) {
    if (!entry) return;
    currentName = entry.name;
    onChange?.({ ...entry, level: levelOf(entry.name) });
  }

  const handleSelect = (e) => {
    const level = e.target.dataset.level;
    if (level === 'province') { refreshCityOptions(); refreshCountyOptions(); }
    if (level === 'city') refreshCountyOptions();
    const node = selectedNode();
    if (!node?.entry) return;
    // 下拉自己已经显示了选中的是哪儿，不必再往搜索框抄一遍
    searchInput.value = '';
    hideResults();
    if (!requireLeaf || node.isLeaf) emit(node.entry);
  };

  function hideResults() {
    if (results.style.display === 'none') return;
    results.style.display = 'none';
    results.innerHTML = '';
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
    activeIndex = -1;
    currentMatches = [];
    itemEls = [];
  }

  /** 高亮第 i 条候选，取模绕圈。只改变化的那两条：改全部 10 条里有 8 条是空写。 */
  function setActive(i) {
    if (itemEls.length === 0) return;
    const prev = itemEls[activeIndex];
    if (prev) {
      prev.classList.remove('active');
      prev.setAttribute('aria-selected', 'false');
    }
    activeIndex = (i + itemEls.length) % itemEls.length;
    const el = itemEls[activeIndex];
    el.classList.add('active');
    el.setAttribute('aria-selected', 'true');
    searchInput.setAttribute('aria-activedescendant', el.id);
    // scrollIntoView 每次都强制同步布局，这页有大张排盘表，代价比上面所有
    // DOM 写入加起来还高。本来就看得见就别调。
    const top = el.offsetTop - results.scrollTop;
    if (top < 0 || top + el.offsetHeight > results.clientHeight) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  /** 选中一条候选：回填下拉、清空搜索框、通知外面 */
  function pick(entry) {
    if (!entry) return;
    setValue(entry.name);
    emit(entry);
  }

  const handleSearch = (e) => {
    // 中文输入法在拼音上屏前照样派发 input（isComposing=true）。打「兰州」是
    // 7 次拉丁字母 + 1 次上屏，前 7 次一条都匹配不上，却每次全表扫 3206 条、
    // 还在老师眼前闪一次「没找到 lanzhou」。等上屏再搜。
    if (e?.isComposing) return;
    const query = searchInput.value.trim();
    if (!query) { hideResults(); return; }
    if (!lookupFn) {
      results.style.display = 'block';
      results.innerHTML = '<div class="city-opt-item empty">城市库加载中…</div>';
      return;
    }
    const matches = lookupFn(query).slice(0, 10);
    currentMatches = matches;
    activeIndex = -1;
    results.style.display = 'block';
    searchInput.setAttribute('aria-expanded', 'true');
    if (matches.length === 0) {
      // 名录再全也有漏。给一条不卡住的路，并让我们知道缺了哪个地名
      results.innerHTML = `<div class="city-opt-item empty">没找到「${escapeHtml(query)}」。
        可先选到所在的市（经度差几分钟），并把这个区县名告诉我们补上。</div>`;
      return;
    }
    const levelLabel = { county: '区县', city: '市 · 辖区质心', province: '省' };
    results.innerHTML = matches.map((c, i) => `
      <div class="city-opt-item" data-index="${i}" id="${resultsId}-${i}" role="option" aria-selected="false">
        <span class="city-name">${escapeHtml(c.name)}</span>
        <span class="city-level">${c.approx ? '坐标待补' : levelLabel[levelOf(c.name)]}</span>
        <span class="city-lng">${c.lng}°E</span>
      </div>`).join('');
    itemEls = [...results.querySelectorAll('.city-opt-item[data-index]')];
  };

  // 委托到列表上，mount 时绑一次。原来每敲一个字都要给最多 10 条各绑一个监听器，
  // 打一个地名就是上百个闭包随即作废。
  const handleResultsMouseDown = (e) => {
    const item = e.target.closest('.city-opt-item[data-index]');
    if (!item) return;
    e.preventDefault();   // 别让输入框先失焦把下拉收掉
    pick(currentMatches[Number(item.dataset.index)]);
  };

  /**
   * 候选列表原来只认鼠标：条目是裸 div，按 ↓ 没高亮、按 Enter 不选中，
   * 键盘用户根本挑不了。这里补上 ↑↓ 选、Enter 定、Esc 收。
   */
  const handleKeydown = (e) => {
    const open = currentMatches.length > 0;
    if (e.key === 'Escape') { hideResults(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open) { handleSearch(); return; }
      e.preventDefault();
      // setActive 取模绕圈：+1 从「没高亮」走到第一条，传 -1 直接绕到最后一条。
      // ↑ 那支不能写成 activeIndex - 1：没高亮时是 -2，会绕到倒数第二条、跳过末条。
      if (e.key === 'ArrowDown') setActive(activeIndex + 1);
      else setActive(activeIndex < 0 ? -1 : activeIndex - 1);
      return;
    }
    if (open && (e.key === 'Home' || e.key === 'End')) {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : -1);
      return;
    }
    if (e.key === 'Enter') {
      // 拦下来：这个框在表单里，回车原本会提交，看着就像「输入被吃掉了」
      e.preventDefault();
      // 只认高亮的那条。不高亮就不猜——「朝阳」有北京朝阳区和辽宁朝阳市，
      // 替老师默认一个正好差 14 分钟时差，足够翻掉一个时辰。
      if (open && activeIndex >= 0) pick(currentMatches[activeIndex]);
    }
  };

  const handleBlur = () => setTimeout(hideResults, 150);

  // 一个 signal 管全部监听器，destroy 里 abort 一次即可，不用逐条对账
  const listeners = new AbortController();
  const on = (target, type, fn) => target.addEventListener(type, fn, { signal: listeners.signal });
  on(el, 'change', handleSelect);
  on(searchInput, 'input', handleSearch);
  on(searchInput, 'compositionend', handleSearch);   // 拼音上屏那一下才真正去搜
  on(searchInput, 'keydown', handleKeydown);
  on(searchInput, 'blur', handleBlur);
  on(results, 'mousedown', handleResultsMouseDown);

  fillSelect(selects.province, [], PLACEHOLDER.province);
  if (cities) setCities(cities, lookup);
  else setValue(currentName);

  return {
    getValue: () => selectedEntry(),
    getName: () => currentName,
    setValue,
    setCities,
    destroy() {
      listeners.abort();
      el.innerHTML = '';
    },
  };
}
