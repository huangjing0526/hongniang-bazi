// web/lunar-esm.js
// 导出浏览器全局环境下的 Solar / Lunar / EightChar 对象供引擎与前端 ESM 模块无缝加载

const g = typeof window !== 'undefined' ? window : globalThis;

export const Solar = g.Solar;
export const Lunar = g.Lunar;
export const EightChar = g.EightChar;

export default g.Solar;
