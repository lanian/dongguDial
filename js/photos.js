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
  // 메모리 캐시·리스트 아바타용(소형). list(96) 우선, 없으면 thumb(256)·full 폴백(레거시 사진).
  function cacheOf(v) { return v == null ? null : (typeof v === "string" ? v : (v.list || v.thumb || v.full || null)); }
  function hasFullVal(v) { return !!(v && typeof v === "object" && v.full); }
  // at-rest 암호화: 활성 시 { lE:<리스트봉투>, tE:<hero썸네일봉투>, fE:<원본봉투> } 로 저장. 암복호는 Storage 키에 위임.
  function isEnc(v) { return !!(v && typeof v === "object" && (v.lE || v.tE)); }
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
  // 키 정규화: 캐시·IDB 모두 String(id) 로 통일(연락처 id 가 숫자/문자열 혼재해도 일관). get/set 의 타입 불일치 방지.
  function K(id) { return String(id); }
  // IDB 레코드 조회 — 정규(String) 키 우선, 없으면 원래(레거시 숫자) 키로 재시도. 반환: Promise<value|undefined>
  function _getRec(os, id) {
    return new Promise(function (res) {
      var sid = String(id), r = os.get(sid);
      r.onsuccess = function () {
        if (r.result !== undefined || sid === id) { res(r.result); return; }
        var r2 = os.get(id); // 레거시 숫자 키 폴백
        r2.onsuccess = function () { res(r2.result); };
        r2.onerror = function () { res(undefined); };
      };
      r.onerror = function () { res(undefined); };
    });
  }
  // 쓰기 영속화 체인 — pagehide/visibilitychange 에서 flush() 로 대기 가능(사진 유실 방지).
  var _writeChain = Promise.resolve();
  function _track(p) { _writeChain = _writeChain.then(function () { return p; }, function () {}); return p; }
  // 가져오기 검증: base64 이미지 dataURL 만, 비정상 대용량 차단(개당 ~12MB)
  var MAX_PHOTO_LEN = 12 * 1024 * 1024;
  function validDataUrl(s) { return typeof s === "string" && s.length <= MAX_PHOTO_LEN && /^data:image\/[a-z0-9.+-]+;base64,/i.test(s); }
  function sanitizePhoto(v) {
    if (validDataUrl(v)) return v; // legacy 문자열
    if (v && typeof v === "object") {
      var out = {};
      if (validDataUrl(v.list)) out.list = v.list;
      if (validDataUrl(v.thumb)) out.thumb = v.thumb;
      if (validDataUrl(v.full)) out.full = v.full;
      if (out.list || out.thumb || out.full) return out;
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
              var key = K(c.key), val = c.value; // 캐시 키는 String 정규화(숫자/문자열 혼재 무관)
              if (isEnc(val)) { // 암호문 → 리스트 소형(lE, 없으면 tE)만 복호화하여 캐시. hero/원본은 지연 복호화
                if (val.fE) fullIds[key] = true;
                var env = val.lE || val.tE;
                chain = chain.then(function () { return S().decryptJSON(env).then(function (t) { cache[key] = t; }); }).catch(function () {});
              } else { cache[key] = cacheOf(val); if (hasFullVal(val)) fullIds[key] = true; }
              c.continue();
            } else { chain.then(done, done); }
          };
          req.onerror = function () { res(cache); };
        });
      }).catch(function () { return cache; });
    },
    /** 썸네일 dataURL(동기) — 리스트·아바타 렌더용. 키는 String 정규화. */
    get: function (id) { var v = cache[K(id)]; return v != null ? v : null; },
    has: function (id) { return Photos.get(id) != null; },
    /** 원본(full) dataURL — 전체화면 뷰어용. 비동기 지연 로드(IDB). 없으면 썸네일 폴백.
     *  반환: Promise<dataURL|null> */
    getFull: function (id) {
      var thumb = Photos.get(id);
      if (!fullIds[K(id)]) return Promise.resolve(thumb); // full 없음 → 썸네일
      return store("readonly").then(function (os) { return _getRec(os, id); }).then(function (v) {
        if (isEnc(v) && v.fE) return S().decryptJSON(v.fE).then(function (f) { return f || thumb; }).catch(function () { return thumb; });
        return (v && typeof v === "object" && v.full) || thumb;
      }).catch(function () { return thumb; });
    },
    /** 상세 hero(256) dataURL — 비동기. 리스트 소형(캐시)을 우선 보여준 뒤 업그레이드용. 없으면 캐시 폴백. */
    getHero: function (id) {
      var c = Photos.get(id);
      return store("readonly").then(function (os) { return _getRec(os, id); }).then(function (v) {
        if (isEnc(v) && v.tE) return S().decryptJSON(v.tE).then(function (t) { return t || c; }).catch(function () { return c; });
        return (v && typeof v === "object" && (v.thumb || v.full)) || c;
      }).catch(function () { return c; });
    },
    /** 저장: 캐시엔 리스트 소형만, IDB엔 { list, thumb, full } 전체(활성 시 각각 암호화) */
    set: function (id, val) {
      var k = K(id);
      cache[k] = cacheOf(val); // 캐시는 항상 평문 리스트 소형(동기 렌더)
      var isObj = val && typeof val === "object";
      var list = isObj ? (val.list || val.thumb) : val; // 소형 우선, 없으면 thumb·문자열
      var thumb = isObj ? val.thumb : null;             // hero 전용(있을 때만)
      var full = isObj ? val.full : null;
      if (full != null) fullIds[k] = true; else delete fullIds[k];
      function put(stored) {
        return store("readwrite").then(function (os) { return _put(os, k, stored); }).catch(function () {});
      }
      if (encActive()) { // 활성: list/thumb/full 각각 봉투로 암호화 저장
        var stored = {}, jobs = [];
        if (list != null) jobs.push(S().encryptJSON(list).then(function (e) { stored.lE = e; }));
        if (thumb != null) jobs.push(S().encryptJSON(thumb).then(function (e) { stored.tE = e; }));
        if (full != null) jobs.push(S().encryptJSON(full).then(function (e) { stored.fE = e; }));
        return _track(Promise.all(jobs).then(function () { return put(stored); }).catch(function () {}));
      }
      return _track(put(val)); // 평문
    },
    remove: function (id) {
      var k = K(id);
      delete cache[k]; delete fullIds[k];
      return _track(store("readwrite").then(function (os) {
        return Promise.all([
          new Promise(function (res) { var r = os.delete(k); r.onsuccess = function () { res(); }; r.onerror = function () { res(); }; }),
          (k === id) ? Promise.resolve() // 레거시 숫자 키도 제거
            : new Promise(function (res) { var r = os.delete(id); r.onsuccess = function () { res(); }; r.onerror = function () { res(); }; }),
        ]);
      }).catch(function () {}));
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
                  var o = {}, jobs = [];
                  if (val.lE) jobs.push(S().decryptJSON(val.lE).then(function (t) { o.list = t; }).catch(function () {}));
                  if (val.tE) jobs.push(S().decryptJSON(val.tE).then(function (t) { o.thumb = t; }).catch(function () {}));
                  if (val.fE) jobs.push(S().decryptJSON(val.fE).then(function (f) { o.full = f; }).catch(function () {}));
                  return Promise.all(jobs).then(function () { if (o.list || o.thumb || o.full) out[key] = o; });
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
                  var o = {}, jobs = [];
                  if (val.lE) jobs.push(S().decryptJSON(val.lE).then(function (t) { o.list = t; }).catch(function () {}));
                  if (val.tE) jobs.push(S().decryptJSON(val.tE).then(function (t) { o.thumb = t; }).catch(function () {}));
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
    /** 대기 중인 사진 IDB 쓰기가 끝날 때까지 대기(종료 직전 호출 → 사진 유실 방지). */
    flush: function () { return _writeChain; },
    clearAll: function () {
      Object.keys(cache).forEach(function (k) { delete cache[k]; });
      Object.keys(fullIds).forEach(function (k) { delete fullIds[k]; });
      return _track(store("readwrite").then(function (os) {
        return new Promise(function (res) { var r = os.clear(); r.onsuccess = function () { res(); }; r.onerror = function () { res(); }; });
      }).catch(function () {}));
    },
    /** 평문 사진을 현재 활성 키로 일괄 암호화(데이터 암호화 켠 직후). 반환: Promise<{done, failed}>.
     *  per-item 처리·실패 격리 — 한 건 실패해도 나머지 진행. failed>0 이면 호출측이 경고(평문 잔존). */
    encryptAll: function () {
      if (!encActive()) return Promise.resolve({ done: 0, failed: 0 });
      return _allItems().then(function (items) {
        var chain = Promise.resolve(), done = 0, failed = 0;
        items.forEach(function (it) {
          if (isEnc(it.v)) return; // 이미 암호화됨
          var isObj = it.v && typeof it.v === "object";
          var list = isObj ? (it.v.list || it.v.thumb) : it.v, thumb = isObj ? it.v.thumb : null, full = isObj ? it.v.full : null;
          chain = chain.then(function () {
            var stored = {}, jobs = [];
            if (list != null) jobs.push(S().encryptJSON(list).then(function (e) { stored.lE = e; }));
            if (thumb != null) jobs.push(S().encryptJSON(thumb).then(function (e) { stored.tE = e; }));
            if (full != null) jobs.push(S().encryptJSON(full).then(function (e) { stored.fE = e; }));
            return Promise.all(jobs)
              .then(function () { return store("readwrite").then(function (os) { return _put(os, it.k, stored); }); })
              .then(function () { done++; }, function () { failed++; }); // 실패 격리
          });
        });
        return chain.then(function () { return { done: done, failed: failed }; });
      }).catch(function () { return { done: 0, failed: -1 }; }); // -1 = 전체 실패(스토어 접근 불가 등)
    },
    /** 암호화 사진을 활성 키로 복호화하여 평문 {list,thumb,full} 로 되돌림(암호화 끄기/PIN 변경 직전).
     *  반환: Promise<{done, failed}>. failed>0 이면 암호화를 끄면 그 사진들이 영구 손실 → 호출측이 중단해야 함. */
    decryptAll: function () {
      if (!encActive()) return Promise.resolve({ done: 0, failed: 0 });
      return _allItems().then(function (items) {
        var chain = Promise.resolve(), done = 0, failed = 0;
        items.forEach(function (it) {
          if (!isEnc(it.v)) return; // 이미 평문
          chain = chain.then(function () {
            var out = {}, jobs = [];
            if (it.v.lE) jobs.push(S().decryptJSON(it.v.lE).then(function (t) { out.list = t; }));
            if (it.v.tE) jobs.push(S().decryptJSON(it.v.tE).then(function (t) { out.thumb = t; }));
            if (it.v.fE) jobs.push(S().decryptJSON(it.v.fE).then(function (f) { out.full = f; }));
            return Promise.all(jobs)
              .then(function () { return store("readwrite").then(function (os) { return _put(os, it.k, out); }); })
              .then(function () { done++; }, function () { failed++; }); // 복호/기록 실패 격리
          });
        });
        return chain.then(function () { return { done: done, failed: failed }; });
      }).catch(function () { return { done: 0, failed: -1 }; });
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
