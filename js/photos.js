/**
 * 사원 사진 저장소 — IndexedDB(영구) + 메모리 캐시(동기 렌더용).
 * 사진은 연락처 id별로 저장(압축된 JPEG dataURL). 모든 처리는 기기 로컬.
 * IndexedDB 미지원/실패 시 메모리 캐시로 폴백(세션 한정).
 */
(function (global) {
  "use strict";

  var DB_NAME = "dongguDial-photos";
  var STORE = "photos";
  var cache = {};      // id(string) -> dataURL  (동기 조회용)
  var dbp = null;

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
    /** 부팅 시 모든 사진을 메모리 캐시로 적재 */
    loadAll: function () {
      return store("readonly").then(function (os) {
        return new Promise(function (res) {
          var req = os.openCursor();
          req.onsuccess = function (e) {
            var c = e.target.result;
            if (c) { cache[c.key] = c.value; c.continue(); }
            else res(cache);
          };
          req.onerror = function () { res(cache); };
        });
      }).catch(function () { return cache; });
    },
    /** 동기 조회(캐시) — 렌더링용 */
    get: function (id) { return cache[id] != null ? cache[id] : (cache[String(id)] || null); },
    has: function (id) { return !!Photos.get(id); },
    /** 저장(캐시 즉시 + IndexedDB 비동기) */
    set: function (id, dataURL) {
      cache[id] = dataURL;
      return store("readwrite").then(function (os) {
        return new Promise(function (res) { var r = os.put(dataURL, id); r.onsuccess = function () { res(); }; r.onerror = function () { res(); }; });
      }).catch(function () {});
    },
    remove: function (id) {
      delete cache[id]; delete cache[String(id)];
      return store("readwrite").then(function (os) {
        return new Promise(function (res) { var r = os.delete(id); r.onsuccess = function () { res(); }; r.onerror = function () { res(); }; });
      }).catch(function () {});
    },
    /** 전체 캐시 사본(백업용) */
    all: function () { return Object.assign({}, cache); },
    count: function () { return Object.keys(cache).length; },
    clearAll: function () {
      Object.keys(cache).forEach(function (k) { delete cache[k]; });
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
