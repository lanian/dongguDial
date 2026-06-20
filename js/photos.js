/**
 * 사원 사진 저장소 — IndexedDB(영구) + 메모리 캐시(동기 렌더용).
 * 사진은 연락처 id별로 저장(압축된 JPEG dataURL). 모든 처리는 기기 로컬.
 * IndexedDB 미지원/실패 시 메모리 캐시로 폴백(세션 한정).
 */
(function (global) {
  "use strict";

  var DB_NAME = "dongguDial-photos";
  var STORE = "photos";
  var cache = {};      // id(string) -> thumb dataURL  (동기 렌더용 — full 은 메모리에 안 올림)
  var fullIds = {};    // id -> true : full 원본이 IDB 에 별도로 존재(뷰어 열 때 지연 로드)
  var dbp = null;
  function thumbOf(v) { return v == null ? null : (typeof v === "string" ? v : (v.thumb || v.full || null)); }
  function hasFullVal(v) { return !!(v && typeof v === "object" && v.full); }

  function openDB() {
    if (dbp) return dbp;
    if (!global.indexedDB) return (dbp = Promise.reject(new Error("no-idb")));
    dbp = new Promise(function (res, rej) {
      var r = global.indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function store(mode) {
    return openDB().then(function (db) { return db.transaction(STORE, mode).objectStore(STORE); });
  }

  var Photos = {
    /** 부팅 시 썸네일만 메모리 캐시로 적재(full 은 안 올림 → 부팅 빠름·메모리↓) */
    loadAll: function () {
      return store("readonly").then(function (os) {
        return new Promise(function (res) {
          var req = os.openCursor();
          req.onsuccess = function (e) {
            var c = e.target.result;
            if (c) { cache[c.key] = thumbOf(c.value); if (hasFullVal(c.value)) fullIds[c.key] = true; c.continue(); }
            else res(cache);
          };
          req.onerror = function () { res(cache); };
        });
      }).catch(function () { return cache; });
    },
    /** 썸네일 dataURL(동기) — 리스트·아바타 렌더용 */
    get: function (id) { return cache[id] != null ? cache[id] : (cache[String(id)] != null ? cache[String(id)] : null); },
    has: function (id) { return Photos.get(id) != null; },
    /** 원본(full) dataURL — 전체화면 뷰어용. 비동기 지연 로드(IDB). 없으면 썸네일 폴백.
     *  반환: Promise<dataURL|null> */
    getFull: function (id) {
      var thumb = Photos.get(id);
      if (!(fullIds[id] || fullIds[String(id)])) return Promise.resolve(thumb); // full 없음 → 썸네일
      return store("readonly").then(function (os) {
        return new Promise(function (res) {
          var r = os.get(id);
          r.onsuccess = function () { var v = r.result; res((v && typeof v === "object" && v.full) || thumb); };
          r.onerror = function () { res(thumb); };
        });
      }).catch(function () { return thumb; });
    },
    /** 저장: 캐시엔 썸네일만, IDB엔 { thumb, full } 전체 */
    set: function (id, val) {
      cache[id] = thumbOf(val);
      if (hasFullVal(val)) fullIds[id] = true; else { delete fullIds[id]; delete fullIds[String(id)]; }
      return store("readwrite").then(function (os) {
        return new Promise(function (res) { var r = os.put(val, id); r.onsuccess = function () { res(); }; r.onerror = function () { res(); }; });
      }).catch(function () {});
    },
    remove: function (id) {
      delete cache[id]; delete cache[String(id)];
      delete fullIds[id]; delete fullIds[String(id)];
      return store("readwrite").then(function (os) {
        return new Promise(function (res) { var r = os.delete(id); r.onsuccess = function () { res(); }; r.onerror = function () { res(); }; });
      }).catch(function () {});
    },
    /** 전체(thumb+full) 사본 — 백업용. 비동기(IDB 전체 읽기). 반환: Promise<map> */
    all: function () {
      return store("readonly").then(function (os) {
        return new Promise(function (res) {
          var out = {}, req = os.openCursor();
          req.onsuccess = function (e) { var c = e.target.result; if (c) { out[c.key] = c.value; c.continue(); } else res(out); };
          req.onerror = function () { res(out); };
        });
      }).catch(function () { return {}; });
    },
    count: function () { return Object.keys(cache).length; },
    clearAll: function () {
      Object.keys(cache).forEach(function (k) { delete cache[k]; });
      Object.keys(fullIds).forEach(function (k) { delete fullIds[k]; });
      return store("readwrite").then(function (os) {
        return new Promise(function (res) { var r = os.clear(); r.onsuccess = function () { res(); }; r.onerror = function () { res(); }; });
      }).catch(function () {});
    },
    /** 백업에서 복구(map: id->dataURL) */
    importMap: function (map, replace) {
      var p = replace ? Photos.clearAll() : Promise.resolve();
      if (!map || typeof map !== "object") return p;
      return p.then(function () {
        var ids = Object.keys(map);
        var chain = Promise.resolve();
        ids.forEach(function (id) { chain = chain.then(function () { return Photos.set(id, map[id]); }); });
        return chain;
      });
    },
  };

  global.Photos = Photos;
})(typeof window !== "undefined" ? window : globalThis);
