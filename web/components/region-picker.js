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

/**
 * @param {HTMLElement} el 挂载点，内容会被替换
 * @param {object} opts
 * @param {string} [opts.value]  当前出生地展示名（可以是名录里没有的字符串，会原样留在搜索框里）
 * @param {(entry:{name:string,lng:number,lat:number,approx?:boolean,level:string}) => void} [opts.onChange]
 * @param {object[]} [opts.cities]  名录；没有就等 setCities
 * @param {(query:string) => object[]} [opts.lookup]  模糊搜索（engine/src/city.js 的 lookupCity）
 * @param {boolean} [opts.requireLeaf=false]  只在选到没有下级的那一层（区县，或没有区县的市）才触发 onChange。
 *   重名确认条要这个：选了省就当场敲定，条子会立刻收掉，老师根本来不及选到区县。
 * @param {string} [opts.searchPlaceholder]
 */
export function mount(el, { value = '', onChange, cities, lookup, requireLeaf = false, searchPlaceholder = '或直接搜：输入省、市或区县，如 兰州、朝阳' } = {}) {
  el.classList.add('rp');
  el.innerHTML = `
    <div class="rp-row">
      <select class="select-input rp-select" data-level="province" aria-label="省"></select>
      <select class="select-input rp-select" data-level="city" aria-label="市"></select>
      <select class="select-input rp-select" data-level="county" aria-label="区县"></select>
    </div>
    <div class="city-search-wrap rp-search">
      <input type="text" class="text-input rp-search-input" autocomplete="off" placeholder="${escapeHtml(searchPlaceholder)}">
      <div class="city-results-drop rp-results"></div>
    </div>`;

  const selects = {};
  for (const s of el.querySelectorAll('select')) selects[s.dataset.level] = s;
  const searchInput = el.querySelector('.rp-search-input');
  const results = el.querySelector('.rp-results');

  let tree = new Map();
  let lookupFn = lookup ?? null;
  let currentName = value;

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
    tree = buildTree(list ?? []);
    if (lookupImpl) lookupFn = lookupImpl;
    fillSelect(selects.province, [...tree.keys()], PLACEHOLDER.province);
    setValue(currentName);
  }

  /** 按展示名回填三个下拉；名录里没有的名字只留在搜索框，下拉归零 */
  function setValue(name) {
    currentName = String(name ?? '');
    searchInput.value = currentName;
    const [p, c, d] = segmentsOf(currentName);
    selects.province.value = tree.has(p) ? p : '';
    refreshCityOptions(c);
    refreshCountyOptions(d);
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
    searchInput.value = node.entry.name;
    if (!requireLeaf || node.isLeaf) emit(node.entry);
  };

  function hideResults() {
    results.style.display = 'none';
    results.innerHTML = '';
  }

  const handleSearch = () => {
    const query = searchInput.value.trim();
    if (!query) { hideResults(); return; }
    if (!lookupFn) {
      results.style.display = 'block';
      results.innerHTML = '<div class="city-opt-item empty">城市库加载中…</div>';
      return;
    }
    const matches = lookupFn(query).slice(0, 10);
    results.style.display = 'block';
    if (matches.length === 0) {
      // 名录再全也有漏。给一条不卡住的路，并让我们知道缺了哪个地名
      results.innerHTML = `<div class="city-opt-item empty">没找到「${escapeHtml(query)}」。
        可先选到所在的市（经度差几分钟），并把这个区县名告诉我们补上。</div>`;
      return;
    }
    const levelLabel = { county: '区县', city: '市 · 辖区质心', province: '省' };
    results.innerHTML = matches.map((c, i) => `
      <div class="city-opt-item" data-index="${i}">
        <span class="city-name">${escapeHtml(c.name)}</span>
        <span class="city-level">${c.approx ? '坐标待补' : levelLabel[levelOf(c.name)]}</span>
        <span class="city-lng">${c.lng}°E</span>
      </div>`).join('');
    results.querySelectorAll('.city-opt-item[data-index]').forEach((item) => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();   // 别让输入框先失焦把下拉收掉
        const entry = matches[Number(item.dataset.index)];
        setValue(entry.name);
        emit(entry);
      });
    });
  };

  const handleBlur = () => setTimeout(hideResults, 150);

  el.addEventListener('change', handleSelect);
  searchInput.addEventListener('input', handleSearch);
  searchInput.addEventListener('blur', handleBlur);

  fillSelect(selects.province, [], PLACEHOLDER.province);
  if (cities) setCities(cities, lookup);
  else setValue(currentName);

  return {
    getValue: () => selectedEntry(),
    getName: () => currentName,
    setValue,
    setCities,
    destroy() {
      el.removeEventListener('change', handleSelect);
      searchInput.removeEventListener('input', handleSearch);
      searchInput.removeEventListener('blur', handleBlur);
      el.innerHTML = '';
    },
  };
}
