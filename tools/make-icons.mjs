/**
 * PWA 아이콘(PNG) 생성기 — 마스터 SVG(icons/icon.svg)에서 렌더링.
 *
 * 연락처 수첩 + 인물 실루엣 + 우상단 신호등 점(창 컨트롤 모티프), 라이트 타일 배경.
 *  - any(192/512)·favicon: 둥근 모서리 + 투명 배경(디자인 그대로)
 *  - maskable(512): 풀블리드(모서리까지 채움) + 안전영역(아트워크 0.80 축소) — OS 마스크 대비
 *  - apple-touch(180): 풀블리드(iOS가 자체 라운딩)
 *
 * 실행(이 저장소는 무의존성이라 도구만 별도 설치):
 *   npm i -D playwright && npx playwright install chromium
 *   node tools/make-icons.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "icons");

const DEFS = `<defs>
<linearGradient id="tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E7F0FE"/></linearGradient>
<linearGradient id="bk" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="#2C7AF2"/><stop offset="1" stop-color="#1A5BD8"/></linearGradient>
<linearGradient id="bksheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(255,255,255,.18)"/><stop offset="0.5" stop-color="rgba(255,255,255,0)"/></linearGradient>
</defs>`;
// 아트워크(배경 타일/테두리 제외) — icons/icon.svg 와 동일한 소스
const ART = `
<rect x="286" y="372" width="80" height="52" rx="26" fill="#1552C9"/><rect x="286" y="470" width="80" height="52" rx="26" fill="#1552C9"/><rect x="286" y="568" width="80" height="52" rx="26" fill="#1552C9"/>
<rect x="326" y="300" width="372" height="476" rx="72" fill="url(#bk)"/>
<rect x="326" y="300" width="372" height="476" rx="72" fill="url(#bksheen)"/>
<circle cx="512" cy="470" r="72" fill="#FFFFFF"/>
<path d="M398 668 v-24 a114 114 0 0 1 228 0 v24 z" fill="#FFFFFF"/>
<circle cx="690" cy="250" r="34" fill="#FC3D17"/><circle cx="766" cy="250" r="34" fill="#27B24A"/><circle cx="842" cy="250" r="34" fill="#1F6FEB"/>`;

function buildSVG(size, { rx, border, scale }) {
  const tile = `<rect x="0" y="0" width="1024" height="1024" rx="${rx}" fill="url(#tile)"/>`;
  const brd = border ? `<rect x="3" y="3" width="1018" height="1018" rx="${rx - 2}" fill="none" stroke="#D8E4F7" stroke-width="3"/>` : "";
  const art = scale === 1 ? ART : `<g transform="translate(512,512) scale(${scale}) translate(-512,-512)">${ART}</g>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">${DEFS}${tile}${brd}${art}</svg>`;
}

const TARGETS = [
  { file: "icon-192.png", size: 192, opts: { rx: 232, border: true, scale: 1 }, omit: true },
  { file: "icon-512.png", size: 512, opts: { rx: 232, border: true, scale: 1 }, omit: true },
  { file: "icon-maskable-512.png", size: 512, opts: { rx: 0, border: false, scale: 0.80 }, omit: false },
  { file: "apple-touch-icon.png", size: 180, opts: { rx: 0, border: false, scale: 0.90 }, omit: false },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of TARGETS) {
  const svg = buildSVG(t.size, t.opts);
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{background:transparent}</style>${svg}`, { waitUntil: "load" });
  await (await page.$("svg")).screenshot({ path: path.join(OUT, t.file), omitBackground: t.omit });
  console.log("wrote", t.file);
}
await browser.close();
