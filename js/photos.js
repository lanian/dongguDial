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
  // at-rest 암호화: 활성 시 사진을 { tE:<썸네일봉투>, fE:<원본봉투> } 로 저장. 암복호는 Storage 키에 위임.
  function isEnc(v) { return !!(v && typeof v === "object" && v.tE); }
  function S() { return global.Storage; }
  function encActive() { return !!(S() && S().encActive && S().encActive()); }
  function _allItems() {
    return store("readonly").then(function (os) {
      return new Promise(function (res) {
        var items = [], req = os.openCursor();
        req.onsuccess = function (e) { var c = e.target.result; if (c) { items.push({ k: c.key, v: c.value }); c.continue(); } else res(items); };
        req.onerror = function () { res(items); };
      });
    }).catch(function () { return []; });
  }
  function _put(os, key, val) { return new Promise(function (r) { var rq = os.put(val, key); rq.onsuccess = function () { r(); }; rq.onerror = function () { r(); }; }); }
  // 가져오기 검증: base64 이미지 dataURL 만, 비정상 대용량 차단(개당 ~12MB)
  var MAX_PHOTO_LEN = 12 * 1024 * 1024;
  function validDataUrl(s) { return typeof s === "string" && s.length <= MAX_PHOTO_LEN && /^data:image\/[a-z0-9.+-]+;base64,/i.test(s); }
  function sanitizePhoto(v) {
    if (validDataUrl(v)) return v; // legacy 문자열
    if (v && typeof v === "object") {
      var out = {};
      if (validDataUrl(v.thumb)) out.thumb = v.thumb;
      if (validDataUrl(v.full)) out.full = v.full;
      if (out.thumb || out.full) return out;
    }
    return null;
  }

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
          var chain = Promise.resolve(), done = function () { res(cache); }, req = os.openCursor();
          req.onsuccess = function (e) {
            var c = e.target.result;
            if (c) {
              var key = c.key, val = c.value;
              if (isEnc(val)) { // 암호문 → 썸네일만 복호화하여 캐시(원본은 뷰어에서 지연 복호화)
                if (val.fE) fullIds[key] = true;
                chain = chain.then(function () { return S().decryptJSON(val.tE).then(function (t) { cache[key] = t; }); }).catch(function () {});
              } else { cache[key] = thumbOf(val); if (hasFullVal(val)) fullIds[key] = true; }
              c.continue();
            } else { chain.then(done, done); }
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
          r.onsuccess = function () {
            var v = r.result;
            if (isEnc(v) && v.fE) { S().decryptJSON(v.fE).then(function (f) { res(f || thumb); }).catch(function () { res(thumb); }); }
            else res((v && typeof v === "object" && v.full) || thumb);
          };
          r.onerror = function () { res(thumb); };
        });
      }).catch(function () { return thumb; });
    },
    /** 저장: 캐시엔 썸네일만, IDB엔 { thumb, full } 전체 */
    set: function (id, val) {
      cache[id] = thumbOf(val); // 캐시는 항상 평문 썸네일(동기 렌더)
      var thumb = thumbOf(val), full = hasFullVal(val) ? val.full : null;
      if (full != null) fullIds[id] = true; else { delete fullIds[id]; delete fullIds[String(id)]; }
      function put(stored) {
        return store("readwrite").then(function (os) { return _put(os, id, stored); }).catch(function () {});
      }
      if (encActive()) { // 활성: thumb/full 각각 봉투로 암호화 저장
        var stored = {}, jobs = [];
        if (thumb != null) jobs.push(S().encryptJSON(thumb).then(function (e) { stored.tE = e; }));
        if (full != null) jobs.push(S().encryptJSON(full).then(function (e) { stored.fE = e; }));
        return Promise.all(jobs).then(function () { return put(stored); }).catch(function () {});
      }
      return put(val); // 평문
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
          var out = {}, chain = Promise.resolve(), done = function () { res(out); }, req = os.openCursor();
          req.onsuccess = function (e) {
            var c = e.target.result;
            if (c) {
              var key = c.key, val = c.value;
              if (isEnc(val)) { // 백업엔 평문 dataURL 로(봉투 백업은 복원 불가). 백업 파일 자체 보호는 ‘암호화 백업’.
                chain = chain.then(function () {
                  var o = {}, jobs = [S().decryptJSON(val.tE).then(function (t) { o.thumb = t; }).catch(function () {})];
                  if (val.fE) jobs.push(S().decryptJSON(val.fE).then(function (f) { o.full = f; }).catch(function () {}));
                  return Promise.all(jobs).then(function () { if (o.thumb || o.full) out[key] = o; });
                });
              } else { out[key] = val; }
              c.continue();
            } else { chain.then(done, done); }
          };
          req.onerror = function () { res(out); };
        });
      }).catch(function () { return {}; });
    },
    /** 백업 스트리밍용: IDB 의 각 사진을 한 건씩 콜백으로 흘려보낸다(전체 맵을 메모리에 올리지 않음).
     *  onItem(id, value) 가 throw 해도 순회를 멈추지 않는다. 반환: Promise<처리건수>. */
    streamAll: function (onItem) {
      return store("readonly").then(function (os) {
        return new Promise(function (res) {
          var n = 0, chain = Promise.resolve(), done = function () { res(n); }, req = os.openCursor();
          req.onsuccess = function (e) {
            var c = e.target.result;
            if (c) {
              var key = c.key, val = c.value;
              if (isEnc(val)) { // 한 건씩 복호화하여 평문으로 흘려보냄(전체 맵 메모리 적재 회피 유지)
                chain = chain.then(function () {
                  var o = {}, jobs = [S().decryptJSON(val.tE).then(function (t) { o.thumb = t; }).catch(function () {})];
                  if (val.fE) jobs.push(S().decryptJSON(val.fE).then(function (f) { o.full = f; }).catch(function () {}));
                  return Promise.all(jobs).then(function () { n++; try { onItem(key, o); } catch (_) {} });
                });
              } else { n++; try { onItem(key, val); } catch (_) {} }
              c.continue();
            } else { chain.then(done, done); }
          };
          req.onerror = function () { res(n); };
        });
      }).catch(function () { return 0; });
    },
    count: function () { return Object.keys(cache).length; },
    clearAll: function () {
      Object.keys(cache).forEach(function (k) { delete cache[k]; });
      Object.keys(fullIds).forEach(function (k) { delete fullIds[k]; });
      return store("readwrite").then(function (os) {
        return new Promise(function (res) { var r = os.clear(); r.onsuccess = function () { res(); }; r.onerror = function () { res(); }; });
      }).catch(function () {});
    },
    /** 평문 사진을 현재 활성 키로 일괄 암호화(데이터 암호화 켠 직후). 반환: Promise<암호화 건수>.
     *  per-item 포맷 판별이라 중간 중단돼도 손실 없음(다음 부팅에서 평문/암호문 혼재 정상 처리). */
    encryptAll: function () {
      if (!encActive()) return Promise.resolve(0);
      return _allItems().then(function (items) {
        var chain = Promise.resolve(), n = 0;
        items.forEach(function (it) {
          if (isEnc(it.v)) return; // 이미 암호화됨
          var thumb = thumbOf(it.v), full = hasFullVal(it.v) ? it.v.full : null;
          chain = chain.then(function () {
            var stored = {}, jobs = [];
            if (thumb != null) jobs.push(S().encryptJSON(thumb).then(function (e) { stored.tE = e; }));
            if (full != null) jobs.push(S().encryptJSON(full).then(function (e) { stored.fE = e; }));
            return Promise.all(jobs).then(function () {
              return store("readwrite").then(function (os) { return _put(os, it.k, stored); }).then(function () { n++; });
            });
          });
        });
        return chain.then(function () { return n; });
      }).catch(function () { return 0; });
    },
    /** 암호화 사진을 활성 키로 복호화하여 평문 {thumb,full} 로 되돌림(암호화 끄기/PIN 변경 직전). 반환: Promise<건수> */
    decryptAll: function () {
      if (!encActive()) return Promise.resolve(0);
      return _allItems().then(function (items) {
        var chain = Promise.resolve(), n = 0;
        items.forEach(function (it) {
          if (!isEnc(it.v)) return; // 이미 평문
          chain = chain.then(function () {
            var out = {}, jobs = [S().decryptJSON(it.v.tE).then(function (t) { out.thumb = t; }).catch(function () {})];
            if (it.v.fE) jobs.push(S().decryptJSON(it.v.fE).then(function (f) { out.full = f; }).catch(function () {}));
            return Promise.all(jobs).then(function () {
              if (!(out.thumb || out.full)) return;
              return store("readwrite").then(function (os) { return _put(os, it.k, out); }).then(function () { n++; });
            });
          });
        });
        return chain.then(function () { return n; });
      }).catch(function () { return 0; });
    },
    /** 백업에서 복구(map: id->{thumb,full}|dataURL). 악의적/손상 백업 방어: data:image/ 형식·크기 검증 후 저장. */
    importMap: function (map, replace) {
      var p = replace ? Photos.clearAll() : Promise.resolve();
      if (!map || typeof map !== "object") return p;
      return p.then(function () {
        var ids = Object.keys(map);
        var chain = Promise.resolve();
        ids.forEach(function (id) {
          if (id === "__proto__" || id === "constructor" || id === "prototype") return; // 방어
          var v = sanitizePhoto(map[id]);
          if (v == null) return; // 형식/크기 위반 → 건너뜀
          chain = chain.then(function () { return Photos.set(id, v); });
        });
        return chain;
      });
    },
  };

  global.Photos = Photos;
})(typeof window !== "undefined" ? window : globalThis);
