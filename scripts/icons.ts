// يولّد أيقونات PNG لوضع التطبيق (PWA) من public/icons/icon.svg عبر Chrome
//   npx tsx scripts/icons.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = fileURLToPath(new URL("..", import.meta.url));
const svg = readFileSync(resolve(root, "public/icons/icon.svg"), "utf8");
const chrome = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
const jobs: [string, number, number, string][] = [
  ["icon-192.png", 192, 1, "transparent"],
  ["icon-512.png", 512, 1, "transparent"],
  ["apple-touch-icon.png", 180, 1, "#140c33"],
  // أيقونة قابلة للقص: الرسم داخل المنطقة الآمنة (80%) على خلفية كاملة
  ["icon-maskable-512.png", 512, 0.8, "#3b1a8f"],
];
for (const [file, size, scale, bg] of jobs) {
  await page.setViewport({ width: size, height: size });
  const inner = Math.round(size * scale);
  await page.setContent(`<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: resolve(root, "public/icons", file) as `${string}.png`, omitBackground: bg === "transparent" });
  console.log("✓", file);
}
await browser.close();
