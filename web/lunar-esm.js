// web/lunar-esm.js
// 把 lunar-javascript 的 UMD 包按需载入，再以 ESM 形式导出给引擎与前端使用。
//
// 这个包 425KB（gzip 后 109KB），且没有官方 min 版。以前它是 <head> 里一个阻塞
// 解析的 <script>，整页要等它下完才开始渲染，首屏白屏几秒。现在改成由本模块自己
// 注入：HTML 立刻能画出来。index.html 里配了 rel=preload，下载仍在解析时就开始，
// 不比原来晚，只是不再挡着渲染。

const LUNAR_SRC = '/engine/node_modules/lunar-javascript/lunar.js';

const g = typeof window !== 'undefined' ? window : globalThis;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`历法底座加载失败：${src}`));
    document.head.appendChild(el);
  });
}

// 顶层 await：引擎里 `import { Solar } from 'lunar-javascript'` 拿到的就是加载完的真身
if (!g.Solar) {
  await loadScript(LUNAR_SRC);
}

if (!g.Solar) {
  throw new Error('历法底座已加载但未挂出全局 Solar，检查 lunar.js 是否完整');
}

export const Solar = g.Solar;
export const Lunar = g.Lunar;
export const EightChar = g.EightChar;

export default g.Solar;
