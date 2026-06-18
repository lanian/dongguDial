/**
 * 로컬 저장소: 즐겨찾기 / 최근 / 테마 / 연락처 편집·추가.
 * 모든 사용자 데이터는 기기 안에서만 관리한다(서버 전송 없음).
 */
(function (global) {
  "use strict";

  var FAV_KEY = "dongguDial.favorites.v1";
  var RECENT_KEY = "dongguDial.recent.v1";
  var THEME_KEY = "dongguDial.theme.v1";
  var SHOW_DEFAULT_ICON_KEY = "dongguDial.showDefaultIcon.v1"; // true면 사진 없는 모든 연락처를 기본 아이콘(실루엣)으로 표시
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
  var ORG_COLLAPSED_KEY = "dongguDial.orgCollapsed.v1"; // { [deptId]: true }  (조직도 접힌 부서) — 키 존재=초기화됨
  var FAV_COLLAPSED_KEY = "dongguDial.favCollapsed.v1"; // { [groupId]: true } (즐겨찾기 접힌 그룹)
  var RECENT_LIMIT = 30;

  // 고유 id 생성기 (같은 ms 에 여러 건 추가해도 충돌 없도록 카운터 결합)
  var _seq = 0;
  function uid(prefix) {
    _seq += 1;
    return prefix + Date.now().toString(36) + _seq.toString(36);
  }

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    if (key === FAV_KEY) _favSet = null; // 즐겨찾기 변경 시 캐시 무효화
  }

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
    // id 배열만 필요할 때(목록 해석 등). 신규/레거시 포맷 모두 안전.
    getRecent: function () { return normRecent(read(RECENT_KEY, [])).map(function (e) { return e.id; }); },
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

    // ---------- 접근 잠금(지문/PIN) ----------
    isLockEnabled: function () { return read(LOCK_ENABLED_KEY, false) === true; },
    setLockEnabled: function (v) { write(LOCK_ENABLED_KEY, !!v); },
    getLockCred: function () { return read(LOCK_CRED_KEY, null); },
    setLockCred: function (id) { write(LOCK_CRED_KEY, id || null); },
    getLockPin: function () { return read(LOCK_PIN_KEY, null); },     // {salt,hash} | null
    setLockPin: function (rec) { write(LOCK_PIN_KEY, rec || null); },
    clearLock: function () {
      write(LOCK_ENABLED_KEY, false);
      try { localStorage.removeItem(LOCK_CRED_KEY); localStorage.removeItem(LOCK_PIN_KEY); } catch (e) {}
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
    resetContact: function (id) {
      var edits = read(EDITS_KEY, {});
      if (edits[id]) { delete edits[id]; write(EDITS_KEY, edits); }
    },
    isEdited: function (id) { return !!read(EDITS_KEY, {})[id]; },

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
        recent: read(RECENT_KEY, []).length,
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
        version: 4,
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
        throw new Error("행정전화부 백업 파일이 아닙니다.");
      }
      var inFav = Array.isArray(data.favorites) ? data.favorites : [];
      var inRecent = Array.isArray(data.recent) ? data.recent : [];
      var inEdits = (data.edits && typeof data.edits === "object") ? data.edits : {};
      var inCustom = Array.isArray(data.custom) ? data.custom : [];
      var inDeptEdits = (data.deptEdits && typeof data.deptEdits === "object") ? data.deptEdits : {};
      var inDeptCustom = Array.isArray(data.deptCustom) ? data.deptCustom : [];
      var inFavGroups = Array.isArray(data.favGroups) ? data.favGroups : [];
      var inFavGroupMap = (data.favGroupMap && typeof data.favGroupMap === "object") ? data.favGroupMap : {};
      var inMemberOrder = (data.memberOrder && typeof data.memberOrder === "object") ? data.memberOrder : {};

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
      if (data.theme) write(THEME_KEY, data.theme);
      if (typeof data.showDefaultIcon === "boolean") write(SHOW_DEFAULT_ICON_KEY, data.showDefaultIcon);
      return { favorites: favs.length, recent: recent.length,
        edits: Object.keys(edits).length, custom: custom.length,
        deptCustom: deptCustom.length };
    },
  };

  global.Storage = Storage;
})(window);
