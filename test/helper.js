"use strict";
// 브라우저 IIFE 모듈(window 에 부착)을 Node 에서 로드하기 위한 테스트 헬퍼.
// 각 loadApp() 호출은 새 window(=신규 상태)와 빈 localStorage 를 제공한다.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

function loadApp(baseData) {
  const store = {};
  global.localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };
  global.indexedDB = undefined; // 사진 모듈은 테스트 대상 아님(IDB 폴백)
  const BASE = baseData || { departments: [], contacts: [] };
  global.fetch = () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve(JSON.parse(JSON.stringify(BASE))),
  });
  const win = {};
  const load = (rel) => { new Function("window", fs.readFileSync(path.join(ROOT, rel), "utf8"))(win); };
  load("js/storage.js");       // window.Storage
  load("js/auth.js");          // window.Lock
  load("js/backup-crypto.js"); // window.BackupCrypto
  load("js/import.js");  // window.Importer
  load("js/data.js");    // window.Data (rebuild 가 window.Storage 사용)
  return { win, store };
}

module.exports = { loadApp };
