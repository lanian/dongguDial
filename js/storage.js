/**
 * 로컬 저장소: 즐겨찾기 / 최근 / 테마 / 연락처 편집·추가.
 * 모든 사용자 데이터는 기기 안에서만 관리한다(서버 전송 없음).
 */
(function (global) {
  "use strict";

  var FAV_KEY = "dongguDial.favorites.v1";
  var RECENT_KEY = "dongguDial.recent.v1";
  var THEME_KEY = "dongguDial.theme.v1";
  var FONT_SCALE_KEY = "dongguDial.fontScale.v1"; // 글자 크기 배율 "1" | "1.15" | "1.3"
  var SHOW_DEFAULT_ICON_KEY = "dongguDial.showDefaultIcon.v1"; // true면 사진 없는 모든 연락처를 기본 아이콘(실루엣)으로 표시
  var ROW_TAP_KEY = "dongguDial.rowTapMode.v1"; // 행 탭 동작: "expand"(펼쳐 보기) | "detail"(바로 상세)
  var EDITS_KEY = "dongguDial.edits.v1";     // { [id]: {field:val,..., __deleted?:true} }  (기본 연락처 오버레이)
  var CUSTOM_KEY = "dongguDial.custom.v1";   // [ {id, ...} ]  (사용자가 추가한 연락처)
  var DEPT_EDITS_KEY = "dongguDial.deptEdits.v1";   // { [id]: {name,parentId,sortOrder,level,__deleted?} }
  var DEPT_CUSTOM_KEY = "dongguDial.deptCustom.v1"; // [ {id,name,parentId,level,sortOrder} ]
  var BASE_HIDDEN_KEY = "dongguDial.baseHidden.v1"; // true면 번들 샘플(기본) 데이터 숨김
  var FAV_GROUPS_KEY = "dongguDial.favGroups.v1";    // [ {id,name,sortOrder} ]  (즐겨찾기 그룹 정의)
  var FAV_GROUP_MAP_KEY = "dongguDial.favGroupMap.v1"; // { [contactId]: [groupId,...] }  (연락처별 소속 그룹, 다중)
  var MEMBER_ORDER_KEY = "dongguDial.memberOrder.v1"; // { [contactId]: N }  (부서 내 사원 표시 순서)
  var LOCK_ENABLED_KEY = "dongguDial.lock.enabled.v1"; // true면 접근 시 잠금
  var LOCK_CRED_KEY = "dongguDial.lock.cred.v1";       // WebAuthn 자격증명 id(base64url) — 지문 해제용
  var LOCK_PIN_KEY = "dongguDial.lock.pin.v1";         // { salt, hash }  (PIN 대체 인증, SHA-256)
  var LOCK_FAIL_KEY = "dongguDial.lock.fail.v1";       // { count, lockedUntil }  (PIN 무차별 대입 방지)
  var ORG_COLLAPSED_KEY = "dongguDial.orgCollapsed.v1"; // { [deptId]: true }  (조직도 접힌 부서) — 키 존재=초기화됨
  var FAV_COLLAPSED_KEY = "dongguDial.favCollapsed.v1"; // { [groupId]: true } (즐겨찾기 접힌 그룹)
  var ENC_KEY = "dongguDial.enc.v1"; // 암호화 설정(평문): { on, salt, iter, check:{_enc,iv,ct} }
  var ENC_ITER = 600000;             // PBKDF2 반복(백업과 동일). 잠금 해제 시 1회만 유도.
  var RECENT_LIMIT = 30;

  // ---------- at-rest 암호화(선택) ----------
  // PII 보유 키만 암호화 대상. 테마·글자크기·접힘상태·잠금설정은 평문 유지(비민감·빈번 변경).
  // 활성 시 read/write 는 '메모리 평문 캐시'로 동작(API 동기 유지)하고, 영속화는 봉투(AES-GCM)로
  // 비동기 기록한다. 키는 PIN에서 유도해 메모리에만 보관(콜드스타트 때 PIN으로 재유도).
  var SENSITIVE = Object.create(null);
  var _enc = { active: false, key: null, cache: Object.create(null) };
  function markSensitive(k) { SENSITIVE[k] = true; }

  function _b64e(buf) { var b = new Uint8Array(buf), s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function _b64d(s) { var a = atob(s), u = new Uint8Array(a.length); for (var i = 0; i < a.length; i++) u[i] = a.charCodeAt(i); return u; }
  function _subtle() { return (global.crypto && global.crypto.subtle) ? global.crypto.subtle : null; }
  function _deriveKey(pin, saltBytes, iter) {
    var subtle = _subtle();
    return subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]).then(function (km) {
      return subtle.deriveKey({ name: "PBKDF2", salt: saltBytes, iterations: iter || ENC_ITER, hash: "SHA-256" },
        km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function _encVal(key, valueObj) { // → Promise<{_enc,iv,ct}>
    var iv = global.crypto.getRandomValues(new Uint8Array(12));
    var pt = new TextEncoder().encode(JSON.stringify(valueObj));
    return _subtle().encrypt({ name: "AES-GCM", iv: iv }, key, pt).then(function (ct) {
      return { _enc: 1, iv: _b64e(iv), ct: _b64e(ct) };
    });
  }
  function _decVal(key, env) { // → Promise<valueObj>
    return _subtle().decrypt({ name: "AES-GCM", iv: _b64d(env.iv) }, key, _b64d(env.ct))
      .then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); });
  }
  function _clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function _rawParse(k) { try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch (e) { return null; } }
  // 봉투를 만들어 localStorage 에 동기 기록(마이그레이션/재암호화용 — 한 키)
  function _persistEnc(k) {
    if (_enc.cache[k] === undefined) { try { localStorage.removeItem(k); } catch (e) {} return Promise.resolve(); }
    return _encVal(_enc.key, _enc.cache[k]).then(function (env) { try { localStorage.setItem(k, JSON.stringify(env)); } catch (e) {} });
  }
  function _persistAll() {
    return Object.keys(SENSITIVE).reduce(function (p, k) { return p.then(function () { return _persistEnc(k); }); }, Promise.resolve());
  }
  // 활성 중 write 의 비동기 영속화(키별 직렬화 — 마지막 값으로 수렴)
  var _flushChain = Promise.resolve();
  function _flushKey(k) {
    _flushChain = _flushChain.then(function () { if (_enc.active && _enc.key) return _persistEnc(k); }).catch(function () {});
    return _flushChain;
  }

  // 고유 id 생성기 (같은 ms 에 여러 건 추가해도 충돌 없도록 카운터 결합)
  var _seq = 0;
  function uid(prefix) {
    _seq += 1;
    return prefix + Date.now().toString(36) + _seq.toString(36);
  }

  function read(key, fallback) {
    if (_enc.active && SENSITIVE[key]) { // 활성: 메모리 평문 캐시에서 읽음(동기)
      var c = _enc.cache[key];
      return c === undefined ? fallback : _clone(c);
    }
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      if (v && typeof v === "object" && v._enc === 1) return fallback; // 암호화됨·미해제 → 빈 값
      return v;
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    if (key === FAV_KEY) _favSet = null; // 즐겨찾기 변경 시 캐시 무효화
    if (_enc.active && SENSITIVE[key]) { // 활성: 캐시에 동기 반영 + 비동기 암호 기록
      _enc.cache[key] = _clone(value);
      _flushKey(key);
      return;
    }
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  // 민감 키 등록(선언 이후 실행) — 위 read/write 가 참조
  [FAV_KEY, RECENT_KEY, EDITS_KEY, CUSTOM_KEY, DEPT_EDITS_KEY, DEPT_CUSTOM_KEY,
    FAV_GROUPS_KEY, FAV_GROUP_MAP_KEY, MEMBER_ORDER_KEY].forEach(markSensitive);

  // 최근 목록 정규화: 레거시(id 배열)와 신규({id,ts} 배열)를 모두 [{id,ts}]로 통일.
  // 레거시 항목은 시각 정보가 없어 ts=0(이전)으로 둔다. id 기준 중복 제거(앞이 우선).
  function normRecent(arr) {
    if (!Array.isArray(arr)) return [];
    var out = [], seen = {};
    arr.forEach(function (e) {
      var id, ts;
      if (e && typeof e === "object") { id = e.id; ts = +e.ts || 0; }
      else { id = e; ts = 0; }
      if (id == null || seen[id]) return;
      seen[id] = true;
      out.push({ id: id, ts: ts });
    });
    return out;
  }

  // 가져온 객체 맵에서 프로토타입 오염 키 제거(JSON.parse 는 __proto__ 를 일반 own 키로 둠)
  function stripProto(o) {
    if (!o || typeof o !== "object") return {};
    var clean = {};
    Object.keys(o).forEach(function (k) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") return;
      clean[k] = o[k];
    });
    return clean;
  }

  // 즐겨찾기 메모리 캐시: isFavorite 가 행마다 호출되므로(목록 렌더) localStorage
  // 읽기·파싱을 매번 하지 않도록 Set(객체 맵)으로 캐싱. write(FAV_KEY) 시 무효화.
  var _favSet = null;
  function favSet() {
    if (!_favSet) {
      _favSet = Object.create(null);
      read(FAV_KEY, []).forEach(function (id) { _favSet[id] = true; });
    }
    return _favSet;
  }

  /** 연락처/부서 공통 오버레이 스토어(편집=edits 오버레이, 추가=custom 배열) */
  function overlayStore(editsKey, customKey, idPrefix) {
    return {
      getEdits: function () { return read(editsKey, {}); },
      getCustom: function () { return read(customKey, []); },
      isCustom: function (id) { return read(customKey, []).some(function (x) { return x.id === id; }); },
      save: function (id, fields) {
        var customs = read(customKey, []);
        var i = customs.findIndex(function (x) { return x.id === id; });
        if (i !== -1) {
          customs[i] = Object.assign({}, customs[i], fields, { id: id });
          write(customKey, customs);
        } else {
          var e = read(editsKey, {});
          e[id] = Object.assign({}, e[id], fields);
          write(editsKey, e);
        }
      },
      add: function (fields) {
        var customs = read(customKey, []);
        var id = uid(idPrefix);
        customs.push(Object.assign({ id: id }, fields));
        write(customKey, customs);
        return id;
      },
      remove: function (id) {
        var customs = read(customKey, []);
        var n = customs.filter(function (x) { return x.id !== id; });
        if (n.length !== customs.length) { write(customKey, n); return; }
        var e = read(editsKey, {});
        e[id] = { __deleted: true };
        write(editsKey, e);
      },
      clear: function () { write(editsKey, {}); write(customKey, []); },
    };
  }
  var contactStore = overlayStore(EDITS_KEY, CUSTOM_KEY, "u");
  var deptStore = overlayStore(DEPT_EDITS_KEY, DEPT_CUSTOM_KEY, "d");

  // ---------- 백업 스키마 버저닝 ----------
  // 백업 구조가 바뀌면 CURRENT_BACKUP_VERSION 을 올리고, 직전 버전→다음 버전 변환기를
  // BACKUP_MIGRATIONS[n] 에 등록한다. importData 가 가져오기 직전에 자동 적용해 구버전
  // 백업 호환을 보장한다(흩어진 임시 호환 로직을 한곳으로 모으는 토대).
  var CURRENT_BACKUP_VERSION = 4;
  var BACKUP_MIGRATIONS = {
    // 예) 4: function (d) { /* v4 → v5 구조 변환 */ return d; },
  };
  function migrateBackup(data) {
    var v = (typeof data.version === "number" && data.version > 0) ? data.version : 1;
    while (v < CURRENT_BACKUP_VERSION) {
      var fn = BACKUP_MIGRATIONS[v];
      if (!fn) break; // 해당 단계 변환기가 없으면 가능한 범위까지만(이후는 방어적 읽기로 흡수)
      data = fn(data) || data;
      v++;
    }
    return data;
  }

  var Storage = {
    // ---------- 즐겨찾기 ----------
    getFavorites: function () { return read(FAV_KEY, []); },
    isFavorite: function (id) { return favSet()[id] === true; },
    toggleFavorite: function (id) {
      var favs = read(FAV_KEY, []);
      var idx = favs.indexOf(id);
      if (idx === -1) favs.push(id); else favs.splice(idx, 1);
      write(FAV_KEY, favs);
      if (idx !== -1) {
        // 즐겨찾기 해제 시 그룹 소속도 함께 제거
        var map = read(FAV_GROUP_MAP_KEY, {});
        if (map[id]) { delete map[id]; write(FAV_GROUP_MAP_KEY, map); }
      }
      return idx === -1;
    },

    // ---------- 즐겨찾기 그룹 (다중 소속) ----------
    getFavGroups: function () {
      return read(FAV_GROUPS_KEY, []).slice().sort(function (a, b) {
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });
    },
    addFavGroup: function (name, color) {
      name = (name || "").trim();
      if (!name) return null;
      var groups = read(FAV_GROUPS_KEY, []);
      var max = groups.reduce(function (m, g) { return Math.max(m, g.sortOrder || 0); }, 0);
      var id = uid("g");
      groups.push({ id: id, name: name, sortOrder: max + 10, color: color || null });
      write(FAV_GROUPS_KEY, groups);
      return id;
    },
    renameFavGroup: function (id, name) {
      name = (name || "").trim();
      if (!name) return;
      var groups = read(FAV_GROUPS_KEY, []);
      var g = groups.find(function (x) { return x.id === id; });
      if (g) { g.name = name; write(FAV_GROUPS_KEY, groups); }
    },
    setFavGroupColor: function (id, color) {
      var groups = read(FAV_GROUPS_KEY, []);
      var g = groups.find(function (x) { return x.id === id; });
      if (g) { g.color = color || null; write(FAV_GROUPS_KEY, groups); }
    },
    removeFavGroup: function (id) {
      write(FAV_GROUPS_KEY, read(FAV_GROUPS_KEY, []).filter(function (g) { return g.id !== id; }));
      var map = read(FAV_GROUP_MAP_KEY, {}), changed = false;
      Object.keys(map).forEach(function (cid) {
        var arr = map[cid].filter(function (gid) { return gid !== id; });
        if (arr.length !== map[cid].length) changed = true;
        if (arr.length) map[cid] = arr; else delete map[cid];
      });
      if (changed) write(FAV_GROUP_MAP_KEY, map);
    },
    /** dir<0 위로, dir>0 아래로 형제와 순서 교환 */
    moveFavGroup: function (id, dir) {
      var groups = read(FAV_GROUPS_KEY, []).slice().sort(function (a, b) {
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });
      var i = groups.findIndex(function (g) { return g.id === id; });
      var j = i + (dir < 0 ? -1 : 1);
      if (i < 0 || j < 0 || j >= groups.length) return;
      var a = groups[i].sortOrder || 0, b = groups[j].sortOrder || 0;
      groups[i].sortOrder = b; groups[j].sortOrder = a;
      write(FAV_GROUPS_KEY, groups);
    },
    getFavGroupMap: function () { return read(FAV_GROUP_MAP_KEY, {}); },

    // ---------- 부서 내 사원 순서 ----------
    getMemberOrder: function () { return read(MEMBER_ORDER_KEY, {}); },
    setMemberOrder: function (id, n) {
      var m = read(MEMBER_ORDER_KEY, {});
      if (n == null) delete m[id]; else m[id] = n;
      write(MEMBER_ORDER_KEY, m);
    },
    /** 해당 연락처가 속한 그룹 id 목록(삭제된 그룹은 제외) */
    getContactFavGroups: function (contactId) {
      var ids = read(FAV_GROUP_MAP_KEY, {})[contactId] || [];
      var exist = {};
      read(FAV_GROUPS_KEY, []).forEach(function (g) { exist[g.id] = true; });
      return ids.filter(function (gid) { return exist[gid]; });
    },
    /** 연락처의 그룹 소속 토글. 그룹 지정 시 자동으로 즐겨찾기에 포함. 반환: 지정됨(true)/해제됨(false) */
    toggleContactFavGroup: function (contactId, groupId) {
      var favs = read(FAV_KEY, []);
      if (favs.indexOf(contactId) === -1) { favs.push(contactId); write(FAV_KEY, favs); }
      var map = read(FAV_GROUP_MAP_KEY, {});
      var arr = map[contactId] ? map[contactId].slice() : [];
      var idx = arr.indexOf(groupId), on;
      if (idx === -1) { arr.push(groupId); on = true; } else { arr.splice(idx, 1); on = false; }
      if (arr.length) map[contactId] = arr; else delete map[contactId];
      write(FAV_GROUP_MAP_KEY, map);
      return on;
    },

    // ---------- 최근 ----------
    // {id, ts} 항목 배열 — 날짜 그룹화용
    getRecentEntries: function () { return normRecent(read(RECENT_KEY, [])); },
    pushRecent: function (id) {
      var list = normRecent(read(RECENT_KEY, [])).filter(function (e) { return e.id !== id; });
      list.unshift({ id: id, ts: Date.now() });
      if (list.length > RECENT_LIMIT) list = list.slice(0, RECENT_LIMIT);
      write(RECENT_KEY, list);
    },
    removeRecent: function (id) {
      write(RECENT_KEY, normRecent(read(RECENT_KEY, [])).filter(function (e) { return e.id !== id; }));
    },
    clearRecent: function () { write(RECENT_KEY, []); },

    // ---------- 테마 ----------
    getTheme: function () { return read(THEME_KEY, "system"); },
    setTheme: function (t) { write(THEME_KEY, t); },

    // ---------- 글자 크기(접근성) ----------
    getFontScale: function () { var v = read(FONT_SCALE_KEY, "1"); return /^(1|1\.15|1\.3)$/.test(String(v)) ? String(v) : "1"; },
    setFontScale: function (v) { write(FONT_SCALE_KEY, String(v)); },

    // ---------- 조직도·즐겨찾기 접힘 상태(콜드스타트에도 유지) ----------
    // 조직도는 "키 존재 여부"로 최초 진입(전부 접기)을 판별한다. null=미초기화.
    getOrgCollapsed: function () {
      var v = read(ORG_COLLAPSED_KEY, null);
      return (v && typeof v === "object") ? v : null;
    },
    setOrgCollapsed: function (map) { write(ORG_COLLAPSED_KEY, map || {}); },
    getFavCollapsed: function () {
      var v = read(FAV_COLLAPSED_KEY, null);
      return (v && typeof v === "object") ? v : {};
    },
    setFavCollapsed: function (map) { write(FAV_COLLAPSED_KEY, map || {}); },

    // ---------- 프로필 기본 아이콘(실루엣) 전역 표시 ----------
    getShowDefaultIcon: function () { return read(SHOW_DEFAULT_ICON_KEY, false) === true; },
    setShowDefaultIcon: function (v) { write(SHOW_DEFAULT_ICON_KEY, !!v); },

    // ---------- 행 탭 동작(펼쳐 보기 / 바로 상세) ----------
    getRowTapMode: function () { return read(ROW_TAP_KEY, "detail") === "expand" ? "expand" : "detail"; },
    setRowTapMode: function (v) { write(ROW_TAP_KEY, v === "expand" ? "expand" : "detail"); },

    // ---------- 접근 잠금(지문/PIN) ----------
    isLockEnabled: function () { return read(LOCK_ENABLED_KEY, false) === true; },
    setLockEnabled: function (v) { write(LOCK_ENABLED_KEY, !!v); },
    getLockCred: function () { return read(LOCK_CRED_KEY, null); },
    setLockCred: function (id) { write(LOCK_CRED_KEY, id || null); },
    getLockPin: function () { return read(LOCK_PIN_KEY, null); },     // {salt,hash} | null
    setLockPin: function (rec) { write(LOCK_PIN_KEY, rec || null); },
    getLockFails: function () { return read(LOCK_FAIL_KEY, { count: 0, lockedUntil: 0 }); }, // 무차별 대입 방지
    setLockFails: function (rec) { write(LOCK_FAIL_KEY, rec || { count: 0, lockedUntil: 0 }); },
    clearLock: function () {
      write(LOCK_ENABLED_KEY, false);
      try {
        localStorage.removeItem(LOCK_CRED_KEY); localStorage.removeItem(LOCK_PIN_KEY);
        localStorage.removeItem(LOCK_FAIL_KEY);
      } catch (e) {}
    },

    // ---------- 연락처 편집 / 추가 (공통 스토어 위임) ----------
    getEdits: function () { return contactStore.getEdits(); },
    getCustom: function () { return contactStore.getCustom(); },
    isCustom: function (id) { return contactStore.isCustom(id); },
    saveContact: function (id, fields) { contactStore.save(id, fields); },
    addContact: function (fields) { return contactStore.add(fields); },
    deleteContact: function (id) {
      contactStore.remove(id);
      write(FAV_KEY, read(FAV_KEY, []).filter(function (x) { return x !== id; }));
      var map = read(FAV_GROUP_MAP_KEY, {});
      if (map[id]) { delete map[id]; write(FAV_GROUP_MAP_KEY, map); }
      // 최근 목록에 남은 죽은 id 정리(즐겨찾기·그룹과 동일하게 일관 정리)
      write(RECENT_KEY, normRecent(read(RECENT_KEY, [])).filter(function (e) { return e.id !== id; }));
    },

    // ---------- 부서 편집 / 추가 (공통 스토어 위임) ----------
    getDeptEdits: function () { return deptStore.getEdits(); },
    getDeptCustom: function () { return deptStore.getCustom(); },
    isCustomDept: function (id) { return deptStore.isCustom(id); },
    saveDept: function (id, fields) { deptStore.save(id, fields); },
    addDept: function (fields) { return deptStore.add(fields); },
    deleteDept: function (id) { deptStore.remove(id); },

    /** 번들 기본(샘플) 데이터 숨김 여부 — 전체 명부를 가져온 파일로 대체할 때 사용 */
    getBaseHidden: function () { return read(BASE_HIDDEN_KEY, false) === true; },
    setBaseHidden: function (v) { write(BASE_HIDDEN_KEY, !!v); },

    /** 모든 편집/추가 초기화 (연락처 + 부서, 기본 데이터 다시 표시) */
    resetAllEdits: function () {
      contactStore.clear();
      deptStore.clear();
      write(MEMBER_ORDER_KEY, {});
      write(BASE_HIDDEN_KEY, false);
    },

    // ---------- 백업 / 복구 ----------
    counts: function () {
      return {
        favorites: read(FAV_KEY, []).length,
        recent: normRecent(read(RECENT_KEY, [])).length, // 중복·삭제분 제외한 실제 건수
        edits: Object.keys(read(EDITS_KEY, {})).length,
        custom: read(CUSTOM_KEY, []).length,
        deptEdits: Object.keys(read(DEPT_EDITS_KEY, {})).length,
        deptCustom: read(DEPT_CUSTOM_KEY, []).length,
        favGroups: read(FAV_GROUPS_KEY, []).length,
      };
    },

    exportData: function () {
      return {
        app: "dongguDial",
        type: "backup",
        version: CURRENT_BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        favorites: read(FAV_KEY, []),
        recent: normRecent(read(RECENT_KEY, [])),
        theme: read(THEME_KEY, "system"),
        showDefaultIcon: read(SHOW_DEFAULT_ICON_KEY, false) === true,
        edits: read(EDITS_KEY, {}),
        custom: read(CUSTOM_KEY, []),
        deptEdits: read(DEPT_EDITS_KEY, {}),
        deptCustom: read(DEPT_CUSTOM_KEY, []),
        baseHidden: read(BASE_HIDDEN_KEY, false) === true,
        favGroups: read(FAV_GROUPS_KEY, []),
        favGroupMap: read(FAV_GROUP_MAP_KEY, {}),
        memberOrder: read(MEMBER_ORDER_KEY, {}),
      };
    },

    importData: function (data, mode) {
      if (!data || data.app !== "dongguDial" || data.type !== "backup") {
        throw new Error("행정전화번호 백업 파일이 아닙니다.");
      }
      data = migrateBackup(data); // 구버전 백업을 현재 스키마로 정규화
      var inFav = Array.isArray(data.favorites) ? data.favorites : [];
      var inRecent = Array.isArray(data.recent) ? data.recent : [];
      var inEdits = stripProto(data.edits);
      var inCustom = Array.isArray(data.custom) ? data.custom.map(stripProto) : []; // 항목 키도 정제(__proto__ 등)
      var inDeptEdits = stripProto(data.deptEdits);
      var inDeptCustom = Array.isArray(data.deptCustom) ? data.deptCustom.map(stripProto) : [];
      var inFavGroups = Array.isArray(data.favGroups) ? data.favGroups.map(stripProto) : [];
      var inFavGroupMap = stripProto(data.favGroupMap);
      var inMemberOrder = stripProto(data.memberOrder);

      var favs, recent, edits, custom, deptEdits, deptCustom, favGroups, favGroupMap, memberOrder;
      if (mode === "replace") {
        favs = inFav.slice();
        recent = normRecent(inRecent).slice(0, RECENT_LIMIT);
        edits = inEdits;
        custom = inCustom;
        deptEdits = inDeptEdits;
        deptCustom = inDeptCustom;
        favGroups = inFavGroups.slice();
        favGroupMap = JSON.parse(JSON.stringify(inFavGroupMap));
        memberOrder = JSON.parse(JSON.stringify(inMemberOrder));
      } else {
        var curFav = read(FAV_KEY, []);
        favs = curFav.slice();
        inFav.forEach(function (x) { if (favs.indexOf(x) === -1) favs.push(x); });
        // id 기준 병합 후 최신 ts 우선, 시간 내림차순 정렬
        var rMerged = {};
        normRecent(inRecent).concat(normRecent(read(RECENT_KEY, []))).forEach(function (e) {
          if (!rMerged[e.id] || e.ts > rMerged[e.id].ts) rMerged[e.id] = e;
        });
        recent = Object.keys(rMerged).map(function (k) { return rMerged[k]; })
          .sort(function (a, b) { return b.ts - a.ts; })
          .slice(0, RECENT_LIMIT);
        edits = Object.assign({}, read(EDITS_KEY, {}), inEdits);
        // custom: id 기준 병합(가져온 것이 우선)
        var byId = {};
        read(CUSTOM_KEY, []).concat(inCustom).forEach(function (c) { if (c && c.id) byId[c.id] = c; });
        custom = Object.keys(byId).map(function (k) { return byId[k]; });
        deptEdits = Object.assign({}, read(DEPT_EDITS_KEY, {}), inDeptEdits);
        var dById = {};
        read(DEPT_CUSTOM_KEY, []).concat(inDeptCustom).forEach(function (d) { if (d && d.id) dById[d.id] = d; });
        deptCustom = Object.keys(dById).map(function (k) { return dById[k]; });
        // 그룹: id 기준 병합(가져온 것이 이름·순서 우선)
        var gById = {};
        read(FAV_GROUPS_KEY, []).concat(inFavGroups).forEach(function (g) { if (g && g.id) gById[g.id] = g; });
        favGroups = Object.keys(gById).map(function (k) { return gById[k]; });
        // 소속 맵: 연락처별 그룹 id 합집합
        favGroupMap = JSON.parse(JSON.stringify(read(FAV_GROUP_MAP_KEY, {})));
        Object.keys(inFavGroupMap).forEach(function (cid) {
          var cur = favGroupMap[cid] ? favGroupMap[cid].slice() : [];
          (inFavGroupMap[cid] || []).forEach(function (gid) { if (cur.indexOf(gid) === -1) cur.push(gid); });
          if (cur.length) favGroupMap[cid] = cur;
        });
        // 사원 순서: 가져온 것이 우선
        memberOrder = Object.assign({}, read(MEMBER_ORDER_KEY, {}), inMemberOrder);
      }
      write(FAV_KEY, favs);
      write(RECENT_KEY, recent);
      write(EDITS_KEY, edits);
      write(CUSTOM_KEY, custom);
      write(DEPT_EDITS_KEY, deptEdits);
      write(DEPT_CUSTOM_KEY, deptCustom);
      write(FAV_GROUPS_KEY, favGroups);
      write(FAV_GROUP_MAP_KEY, favGroupMap);
      write(MEMBER_ORDER_KEY, memberOrder);
      if (mode === "replace") write(BASE_HIDDEN_KEY, data.baseHidden === true);
      else if (data.baseHidden === true) write(BASE_HIDDEN_KEY, true);
      if (["light", "dark", "system"].indexOf(data.theme) >= 0) write(THEME_KEY, data.theme); // 화이트리스트만
      if (typeof data.showDefaultIcon === "boolean") write(SHOW_DEFAULT_ICON_KEY, data.showDefaultIcon);
      return { favorites: favs.length, recent: recent.length,
        edits: Object.keys(edits).length, custom: custom.length,
        deptCustom: deptCustom.length };
    },

    // ---------- at-rest 암호화(PIN 유도 키, 선택) ----------
    encSupported: function () { return !!_subtle(); },
    encEnabled: function () { var c = _rawParse(ENC_KEY); return !!(c && c.on); },   // 설정상 켜짐
    encActive: function () { return _enc.active; },                                   // 이번 세션 해제됨
    encLocked: function () { return this.encEnabled() && !_enc.active; },             // 켜졌지만 미해제

    /** 대기 중인 암호화 쓰기(비동기 영속화)가 끝날 때까지 기다린다.
     *  암호화 활성 시 write()는 메모리만 동기 갱신하고 디스크 기록은 백그라운드라,
     *  앱이 백그라운드/종료될 때(pagehide·visibilitychange) 호출해 마지막 편집 유실을 막는다.
     *  평문 모드는 write 가 동기(localStorage)라 이미 안전 → 즉시 resolve. */
    flush: function () { return _enc.active ? _flushChain : Promise.resolve(); },

    /** 외부 저장소(사진 IDB 등)가 동일 PIN 유도 키로 값을 암복호하도록 위임. 활성 시에만.
     *  encryptJSON(obj)→Promise<{_enc,iv,ct}>, decryptJSON(env)→Promise<obj>. */
    encryptJSON: function (v) { return (_enc.active && _enc.key) ? _encVal(_enc.key, v) : Promise.reject(new Error("enc-inactive")); },
    decryptJSON: function (env) { return (_enc.active && _enc.key) ? _decVal(_enc.key, env) : Promise.reject(new Error("enc-inactive")); },

    /** 콜드스타트: PIN으로 키 유도→검증→모든 민감 키 복호화하여 메모리 캐시 적재 */
    encUnlock: function (pin) {
      var cfg = _rawParse(ENC_KEY);
      if (!cfg || !cfg.on) return Promise.reject(new Error("암호화 비활성"));
      return _deriveKey(pin, _b64d(cfg.salt), cfg.iter).then(function (key) {
        return _decVal(key, cfg.check).then(function (v) {        // 키 검증(센티넬)
          if (!v || v.s !== "dongguDial") throw new Error("키 검증 실패");
          var cache = Object.create(null);
          return Object.keys(SENSITIVE).reduce(function (p, k) {
            return p.then(function () {
              var env = _rawParse(k);
              if (!env) return;
              if (!(env && env._enc === 1)) { cache[k] = env; return; } // 평문 혼재 방어
              return _decVal(key, env).then(function (val) { cache[k] = val; });
            });
          }, Promise.resolve()).then(function () {
            _enc.key = key; _enc.cache = cache; _enc.active = true; _favSet = null;
          });
        });
      });
    },

    /** 켜기: 현재 평문 민감 키를 캐시로 올리고 전부 암호화 저장. pin에서 키 유도. */
    encEnable: function (pin) {
      if (_enc.active) return Promise.resolve();
      if (!_subtle()) return Promise.reject(new Error("이 브라우저는 암호화를 지원하지 않습니다"));
      var salt = global.crypto.getRandomValues(new Uint8Array(16));
      return _deriveKey(pin, salt, ENC_ITER).then(function (key) {
        var cache = Object.create(null);
        Object.keys(SENSITIVE).forEach(function (k) {
          var v = _rawParse(k);
          if (v != null && !(typeof v === "object" && v._enc === 1)) cache[k] = v; // 평문만 적재
        });
        _enc.key = key; _enc.cache = cache; _enc.active = true; _favSet = null;
        return _encVal(key, { s: "dongguDial" }).then(function (check) {
          return _persistAll().then(function () {
            try { localStorage.setItem(ENC_KEY, JSON.stringify({ on: true, salt: _b64e(salt), iter: ENC_ITER, check: check })); } catch (e) {}
          });
        });
      });
    },

    /** 끄기: 캐시(평문)를 localStorage 평문으로 되돌리고 설정 제거 */
    encDisable: function () {
      if (!_enc.active) { try { localStorage.removeItem(ENC_KEY); } catch (e) {} return Promise.resolve(); }
      Object.keys(SENSITIVE).forEach(function (k) {
        var v = _enc.cache[k];
        try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
      });
      try { localStorage.removeItem(ENC_KEY); } catch (e) {}
      _enc.active = false; _enc.key = null; _enc.cache = Object.create(null); _favSet = null;
      return Promise.resolve();
    },

    /** PIN 변경 시 새 키로 재암호화(캐시는 그대로) */
    encReencrypt: function (newPin) {
      if (!_enc.active) return Promise.resolve();
      var salt = global.crypto.getRandomValues(new Uint8Array(16));
      return _deriveKey(newPin, salt, ENC_ITER).then(function (key) {
        _enc.key = key;
        return _encVal(key, { s: "dongguDial" }).then(function (check) {
          return _persistAll().then(function () {
            try { localStorage.setItem(ENC_KEY, JSON.stringify({ on: true, salt: _b64e(salt), iter: ENC_ITER, check: check })); } catch (e) {}
          });
        });
      });
    },
  };

  global.Storage = Storage;
})(window);
