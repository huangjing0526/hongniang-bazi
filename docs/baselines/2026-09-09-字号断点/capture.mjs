// 字号与断点任务的像素回归截图脚本。
// 基线是在 a37b36b（动代码之前）截的；改完用同一条命令再截一组，逐张比。
//
//   node cloud/server.mjs 起服务（DB_PATH 指到临时库，别碰 data/）
//   node docs/baselines/2026-09-09-字号断点/capture.mjs <输出目录> [端口]
//
// 依赖 playwright，用系统已装的 Chrome，不下载浏览器内核：
//   mkdir -p /tmp/pw && cd /tmp/pw && npm init -y
//   PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright
//   然后跑脚本时带上 PLAYWRIGHT_DIR=/tmp/pw

import path from 'node:path';
import fs from 'node:fs';

// 本仓是零依赖的，playwright 装在仓库外；PLAYWRIGHT_DIR 指向那个目录（含 node_modules）
const { chromium } = process.env.PLAYWRIGHT_DIR
  ? await import(new URL('node_modules/playwright/index.mjs', `file://${process.env.PLAYWRIGHT_DIR}/`).href)
  : await import('playwright');

const OUT = process.argv[2];
const PORT = process.argv[3] || '8099';
if (!OUT) { console.error('用法：node capture.mjs <输出目录> [端口]'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

// 六张组合。最后一张把浏览器默认字号调到 24px（≈150%）——改造前它不会有任何变化，
// 那正是第 2 条要修的东西；改造后这张应该整体变大且不夹字。
const SHOTS = [
  { name: '1-375x812',            w: 375,  h: 812 },
  { name: '2-1023x900',           w: 1023, h: 900 },
  { name: '3-1024x768',           w: 1024, h: 768 },
  { name: '4-1080x900',           w: 1080, h: 900 },
  { name: '5-1440x900',           w: 1440, h: 900 },
  { name: '6-1024x768-字号150',   w: 1024, h: 768, fontSize: 24 },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });

for (const s of SHOTS) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h } });
  const page = await ctx.newPage();
  if (s.fontSize) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Page.setFontSizes', { fontSizes: { standard: s.fontSize, fixed: s.fontSize } });
  }
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // 固定路径：登记 → 载入样盘库 → 停在第 1 条的「基本排盘」页
  const nameInput = page.locator('#register-name-input');
  if (await nameInput.isVisible().catch(() => false)) {
    await nameInput.fill('基线');
    await page.click('#register-submit-btn');
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.app.closeSyncPanel?.());
    await page.waitForTimeout(300);
  }
  await page.click('#tab-btn-quick');   await page.waitForTimeout(300);
  await page.click('#mode-btn-batch');  await page.waitForTimeout(300);
  await page.click('#load-sample-cases-btn'); await page.waitForTimeout(3000);
  await page.click('#tab-btn-chart');   await page.waitForTimeout(1000);

  // 两处天生不可复现，截图前中和掉，基线与复测两边同样处理：
  //   body::before 是 position:fixed 的装饰渐变，整页截图时合成位置不稳定
  //   #sync-status 是「已同步 N 条」，文案随同步时机变
  await page.addStyleTag({ content: `
    body::before { display: none !important; }
    #sync-status { visibility: hidden !important; }
  ` });
  await page.waitForTimeout(300);

  await page.screenshot({ path: path.join(OUT, `${s.name}.png`), fullPage: true });
  console.log('✓', s.name);
  await ctx.close();
}
await browser.close();
