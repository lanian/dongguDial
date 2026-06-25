"use strict";
// photos.js 단위 테스트 — 3단 피라미드(list/thumb/full) 라우팅, 레거시 폴백,
// at-rest 암호화 왕복(콜드 재시작 포함), 마이그레이션(encryptAll/decryptAll), 백업 평문화, sanitize.
// 브라우저 의존(IndexedDB)을 위해 최소 in-memory fake IDB 를 주입하고, crypto 는 node webcrypto 사용.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

// ---- 최소 in-memory IndexedDB (photos.js 가 쓰는 open/createObjectStore/transaction/
//      objectStore/openCursor/get/put/delete/clear 만 지원). 요청은 event 기반이라 비동기로 발화. ----
function fakeIndexedDB() {
  var dbs = {};
  function fire(req, make) {
    setTimeout(function () {
      try { req.result = make(); if (req.onsuccess) req.onsuccess({ target: req }); }
      catch (e) { req.error = e; if (req.onerror) req.onerror({ target: req }); }
    }, 0);
  }
  function makeStore(map) {
    return {
      get: function (k) { var r = {}; fire(r, function () { return map.get(k); }); return r; },
      put: function (v, k) { var r = {}; fire(r, function () { map.set(k, v); }); return r; },
      delete: function (k) { var r = {}; fire(r, function () { map.delete(k); }); return r; },
      clear: function () { var r = {}; fire(r, function () { map.clear(); }); return r; },
      openCursor: function () {
        var r = {}, entries = Array.from(map.entries()), i = 0;
        function step() {
          setTimeout(function () {
            if (i < entries.length) {
              var e = entries[i];
              r.result = { key: e[0], value: e[1], continue: function () { i++; step(); } };
            } else { r.result = null; }
            if (r.onsuccess) r.onsuccess({ target: r });
          }, 0);
        }
        step();
        return r;
      },
    };
  }
  return {
    open: function (name) {
      var req = {};
      if (!dbs[name]) dbs[name] = {};
      var db = {
        createObjectStore: function (s) { dbs[name][s] = dbs[name][s] || new Map(); return {}; },
        transaction: function (s) {
          return { objectStore: function () { var m = dbs[name][s] || (dbs[name][s] = new Map()); return makeStore(m); } };
        },
      };
      setTimeout(function () {
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      }, 0);
      return req;
    },
  };
}

// 공유 상태(localStorage·IDB)를 유지한 채 storage.js/photos.js 를 (재)로드한다.
function makeEnv() {
  var ls = {};
  global.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null; },
    setItem: function (k, v) { ls[k] = String(v); },
    removeItem: function (k) { delete ls[k]; },
    clear: function () { for (var k of Object.keys(ls)) delete ls[k]; },
  };
  var idb = fakeIndexedDB();
  global.indexedDB = idb;
  function load(win, rel) { new Function("window", fs.readFileSync(path.join(ROOT, rel), "utf8"))(win); }
  function fresh(opts) { // opts.photosOnly: Storage 유지(언락 상태 보존)하고 photos 만 새로
    var win = (opts && opts.win) || {};
    win.crypto = globalThis.crypto; win.indexedDB = idb;
    if (!(opts && opts.photosOnly)) load(win, "js/storage.js");
    load(win, "js/photos.js");
    return win;
  }
  return { fresh: fresh };
}

const DURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("평문 3단 라우팅: get=list, getHero=thumb, getFull=full", async () => {
  var P = makeEnv().fresh().Photos;
  await P.set(1, { list: "L96", thumb: "T256", full: "F1280" });
  assert.equal(P.get(1), "L96");                 // 리스트·캐시 = 소형
  assert.equal(await P.getHero(1), "T256");      // hero = 중간
  assert.equal(await P.getFull(1), "F1280");     // 뷰어 = 원본
});

test("레거시 폴백: list 없으면 get 이 thumb 로", async () => {
  var P = makeEnv().fresh().Photos;
  await P.set(2, { thumb: "T", full: "F" });
  assert.equal(P.get(2), "T");
  assert.equal(await P.getHero(2), "T");
  assert.equal(await P.getFull(2), "F");
});

test("암호화 왕복 + 콜드 재시작: encryptAll→봉투, 재로드·언락·loadAll→복호화", async () => {
  var env = makeEnv();
  var win = env.fresh();
  await win.Photos.set(7, { list: "L", thumb: "T", full: "F" });
  await win.Storage.encEnable("1234");
  var n = await win.Photos.encryptAll();
  assert.deepEqual(n, { done: 1, failed: 0 });
  // 원본 IDB 가 봉투({lE,tE,fE})이고 평문 누출 없음
  var raw = await new Promise(function (res) {
    var rq = global.indexedDB.open("dongguDial-photos");
    rq.onsuccess = function () { var g = rq.result.transaction("photos").objectStore("photos").get("7"); g.onsuccess = function () { res(g.result); }; };
  });
  assert.ok(raw.lE && raw.tE && raw.fE, "lE/tE/fE 봉투 존재");
  assert.ok(!JSON.stringify(raw).includes("\"L\""), "평문 마커 누출 없음");

  // 콜드 재시작: storage+photos 새로 로드(_enc 초기화=잠김) → 언락 → loadAll
  var win2 = env.fresh();
  assert.equal(win2.Storage.encLocked(), true);
  await win2.Storage.encUnlock("1234");
  await win2.Photos.loadAll();
  assert.equal(win2.Photos.get(7), "L");           // 썸네일 복호화 적재
  assert.equal(await win2.Photos.getHero(7), "T"); // hero 복호화
  assert.equal(await win2.Photos.getFull(7), "F"); // 원본 복호화
});

test("decryptAll: 암호문 → 평문 {list,thumb,full} 복원", async () => {
  var env = makeEnv();
  var win = env.fresh();
  await win.Photos.set(9, { list: "L", thumb: "T", full: "F" });
  await win.Storage.encEnable("1234");
  await win.Photos.encryptAll();
  await win.Photos.decryptAll();
  var raw = await new Promise(function (res) {
    var rq = global.indexedDB.open("dongguDial-photos");
    rq.onsuccess = function () { var g = rq.result.transaction("photos").objectStore("photos").get("9"); g.onsuccess = function () { res(g.result); }; };
  });
  assert.deepEqual(raw, { list: "L", thumb: "T", full: "F" });
});

test("백업 all(): 암호화 사진을 평문 3단으로 출력(복원 가능)", async () => {
  var win = makeEnv().fresh();
  await win.Photos.set(3, { list: "L", thumb: "T", full: "F" });
  await win.Storage.encEnable("1234");
  await win.Photos.encryptAll();
  var all = await win.Photos.all();
  assert.deepEqual(all[3], { list: "L", thumb: "T", full: "F" });
});

test("importMap/sanitize: 유효 dataURL 저장, 비정상 거부", async () => {
  var P = makeEnv().fresh().Photos;
  await P.importMap({ 5: { list: DURL, thumb: DURL, full: DURL }, 6: { thumb: "not-a-dataurl" } }, true);
  assert.equal(P.get(5), DURL);          // 5: 유효 → 저장(list 우선)
  assert.equal(P.get(6), null);          // 6: 비정상 → 건너뜀
});

test("키 정규화: 숫자 id 로 저장 → 문자열 id 로 조회(및 반대) 일관", async () => {
  var P = makeEnv().fresh().Photos;
  await P.set(42, { list: "L", thumb: "T", full: "F" }); // 숫자 키 저장
  assert.equal(P.get("42"), "L");                         // 문자열 조회(DOM dataset 경로) 일치
  assert.equal(P.get(42), "L");                           // 숫자 조회도 일치
  assert.equal(await P.getHero("42"), "T");               // getHero 문자열 id
  assert.equal(await P.getFull("42"), "F");               // getFull 문자열 id (이전엔 썸네일로 폴백되던 버그)
});

test("flush(): 대기 중 쓰기 완료까지 await 가능", async () => {
  var P = makeEnv().fresh().Photos;
  assert.equal(typeof P.flush().then, "function"); // thenable
  P.set(11, { list: "L", thumb: "T", full: "F" });  // await 안 함
  await P.flush();                                  // flush 가 보장
  var raw = await new Promise(function (res) {
    var rq = global.indexedDB.open("dongguDial-photos");
    rq.onsuccess = function () { var g = rq.result.transaction("photos").objectStore("photos").get("11"); g.onsuccess = function () { res(g.result); }; };
  });
  assert.ok(raw && raw.list === "L", "flush 후 IDB 기록 완료");
});

test("decryptAll: 복호 불가 봉투는 failed 로 집계(성공 위장 안 함)", async () => {
  var env = makeEnv();
  var win = env.fresh();
  await win.Storage.encEnable("1234");
  // 활성 키로 정상 1건 + 가짜(복호 불가) 봉투 1건을 직접 주입
  await win.Photos.set(1, { list: "L", thumb: "T", full: "F" }); // 정상 암호화 저장
  await new Promise(function (res) {
    var rq = global.indexedDB.open("dongguDial-photos");
    rq.onsuccess = function () {
      var os = rq.result.transaction("photos", "readwrite").objectStore("photos");
      var p = os.put({ lE: { _enc: 1, iv: "AAAAAAAAAAAAAAAA", ct: "BBBB" } }, "2"); // 손상 봉투
      p.onsuccess = function () { res(); }; p.onerror = function () { res(); };
    };
  });
  var r = await win.Photos.decryptAll();
  assert.equal(r.done, 1, "정상 1건 복호");
  assert.equal(r.failed, 1, "손상 1건 failed 집계 → 호출측이 끄기 중단 가능");
});
