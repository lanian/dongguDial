/**
 * 로컬 저장소: 즐겨찾기 / 최근 / 테마 / 연락처 편집·추가.
 * 모든 사용자 데이터는 기기 안에서만 관리한다(서버 전송 없음).
 */
(function (global) {
  "use strict";

  var FAV_KEY = "dongguDial.favorites.v1";
  var RECENT_KEY = "dongguDial.recent.v1";
  var THEME_KEY = "dongguDial.theme.v1";
  var EDITS_KEY = "dongguDial.edits.v1";     // { [id]: {field:val,..., __deleted?:true} }  (기본 연락처 오버레이)
  var CUSTOM_KEY = "dongguDial.custom.v1";   // [ {id, ...} ]  (사용자가 추가한 연락처)
  var DEPT_EDITS_KEY = "dongguDial.deptEdits.v1";   // { [id]: {name,parentId,sortOrder,level,__deleted?} }
  var DEPT_CUSTOM_KEY = "dongguDial.deptCustom.v1"; // [ {id,name,parentId,level,sortOrder} ]
  var BASE_HIDDEN_KEY = "dongguDial.baseHidden.v1"; // true면 번들 샘플(기본) 데이터 숨김
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
  }

  var Storage = {
    // ---------- 즐겨찾기 ----------
    getFavorites: function () { return read(FAV_KEY, []); },
    isFavorite: function (id) { return read(FAV_KEY, []).indexOf(id) !== -1; },
    toggleFavorite: function (id) {
      var favs = read(FAV_KEY, []);
      var idx = favs.indexOf(id);
      if (idx === -1) favs.push(id); else favs.splice(idx, 1);
      write(FAV_KEY, favs);
      return idx === -1;
    },

    // ---------- 최근 ----------
    getRecent: function () { return read(RECENT_KEY, []); },
    pushRecent: function (id) {
      var recent = read(RECENT_KEY, []).filter(function (x) { return x !== id; });
      recent.unshift(id);
      if (recent.length > RECENT_LIMIT) recent = recent.slice(0, RECENT_LIMIT);
      write(RECENT_KEY, recent);
    },

    // ---------- 테마 ----------
    getTheme: function () { return read(THEME_KEY, "system"); },
    setTheme: function (t) { write(THEME_KEY, t); },

    // ---------- 편집 / 추가 (로컬) ----------
    getEdits: function () { return read(EDITS_KEY, {}); },
    getCustom: function () { return read(CUSTOM_KEY, []); },

    isCustom: function (id) {
      return read(CUSTOM_KEY, []).some(function (c) { return c.id === id; });
    },

    /** 연락처 저장: 커스텀이면 객체 갱신, 기본이면 오버레이 저장 */
    saveContact: function (id, fields) {
      var customs = read(CUSTOM_KEY, []);
      var i = customs.findIndex(function (c) { return c.id === id; });
      if (i !== -1) {
        customs[i] = Object.assign({}, customs[i], fields, { id: id });
        write(CUSTOM_KEY, customs);
      } else {
        var edits = read(EDITS_KEY, {});
        edits[id] = Object.assign({}, edits[id], fields);
        write(EDITS_KEY, edits);
      }
    },

    /** 새 연락처 추가 → 부여된 id 반환 */
    addContact: function (fields) {
      var customs = read(CUSTOM_KEY, []);
      var id = uid("u");
      customs.push(Object.assign({ id: id }, fields));
      write(CUSTOM_KEY, customs);
      return id;
    },

    /** 삭제: 커스텀은 제거, 기본은 __deleted 표시 */
    deleteContact: function (id) {
      var customs = read(CUSTOM_KEY, []);
      var n = customs.filter(function (c) { return c.id !== id; });
      if (n.length !== customs.length) {
        write(CUSTOM_KEY, n);
      } else {
        var edits = read(EDITS_KEY, {});
        edits[id] = { __deleted: true };
        write(EDITS_KEY, edits);
      }
      var favs = read(FAV_KEY, []).filter(function (x) { return x !== id; });
      write(FAV_KEY, favs);
    },

    /** 한 연락처의 편집 되돌리기(기본 연락처만) */
    resetContact: function (id) {
      var edits = read(EDITS_KEY, {});
      if (edits[id]) { delete edits[id]; write(EDITS_KEY, edits); }
    },

    // ---------- 부서 편집 / 추가 (로컬) ----------
    getDeptEdits: function () { return read(DEPT_EDITS_KEY, {}); },
    getDeptCustom: function () { return read(DEPT_CUSTOM_KEY, []); },
    isCustomDept: function (id) {
      return read(DEPT_CUSTOM_KEY, []).some(function (d) { return d.id === id; });
    },
    saveDept: function (id, fields) {
      var customs = read(DEPT_CUSTOM_KEY, []);
      var i = customs.findIndex(function (d) { return d.id === id; });
      if (i !== -1) {
        customs[i] = Object.assign({}, customs[i], fields, { id: id });
        write(DEPT_CUSTOM_KEY, customs);
      } else {
        var edits = read(DEPT_EDITS_KEY, {});
        edits[id] = Object.assign({}, edits[id], fields);
        write(DEPT_EDITS_KEY, edits);
      }
    },
    addDept: function (fields) {
      var customs = read(DEPT_CUSTOM_KEY, []);
      var id = uid("d");
      customs.push(Object.assign({ id: id }, fields));
      write(DEPT_CUSTOM_KEY, customs);
      return id;
    },
    deleteDept: function (id) {
      var customs = read(DEPT_CUSTOM_KEY, []);
      var n = customs.filter(function (d) { return d.id !== id; });
      if (n.length !== customs.length) {
        write(DEPT_CUSTOM_KEY, n);
      } else {
        var edits = read(DEPT_EDITS_KEY, {});
        edits[id] = { __deleted: true };
        write(DEPT_EDITS_KEY, edits);
      }
    },

    /** 번들 기본(샘플) 데이터 숨김 여부 — 전체 명부를 가져온 파일로 대체할 때 사용 */
    getBaseHidden: function () { return read(BASE_HIDDEN_KEY, false) === true; },
    setBaseHidden: function (v) { write(BASE_HIDDEN_KEY, !!v); },

    /** 모든 편집/추가 초기화 (연락처 + 부서, 기본 데이터 다시 표시) */
    resetAllEdits: function () {
      write(EDITS_KEY, {});
      write(CUSTOM_KEY, []);
      write(DEPT_EDITS_KEY, {});
      write(DEPT_CUSTOM_KEY, []);
      write(BASE_HIDDEN_KEY, false);
    },

    isEdited: function (id) {
      var edits = read(EDITS_KEY, {});
      return !!edits[id];
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
      };
    },

    exportData: function () {
      return {
        app: "dongguDial",
        type: "backup",
        version: 3,
        exportedAt: new Date().toISOString(),
        favorites: read(FAV_KEY, []),
        recent: read(RECENT_KEY, []),
        theme: read(THEME_KEY, "system"),
        edits: read(EDITS_KEY, {}),
        custom: read(CUSTOM_KEY, []),
        deptEdits: read(DEPT_EDITS_KEY, {}),
        deptCustom: read(DEPT_CUSTOM_KEY, []),
        baseHidden: read(BASE_HIDDEN_KEY, false) === true,
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

      var favs, recent, edits, custom, deptEdits, deptCustom;
      if (mode === "replace") {
        favs = inFav.slice();
        recent = inRecent.slice(0, RECENT_LIMIT);
        edits = inEdits;
        custom = inCustom;
        deptEdits = inDeptEdits;
        deptCustom = inDeptCustom;
      } else {
        var curFav = read(FAV_KEY, []);
        favs = curFav.slice();
        inFav.forEach(function (x) { if (favs.indexOf(x) === -1) favs.push(x); });
        recent = [];
        inRecent.concat(read(RECENT_KEY, [])).forEach(function (x) {
          if (recent.indexOf(x) === -1) recent.push(x);
        });
        recent = recent.slice(0, RECENT_LIMIT);
        edits = Object.assign({}, read(EDITS_KEY, {}), inEdits);
        // custom: id 기준 병합(가져온 것이 우선)
        var byId = {};
        read(CUSTOM_KEY, []).concat(inCustom).forEach(function (c) { if (c && c.id) byId[c.id] = c; });
        custom = Object.keys(byId).map(function (k) { return byId[k]; });
        deptEdits = Object.assign({}, read(DEPT_EDITS_KEY, {}), inDeptEdits);
        var dById = {};
        read(DEPT_CUSTOM_KEY, []).concat(inDeptCustom).forEach(function (d) { if (d && d.id) dById[d.id] = d; });
        deptCustom = Object.keys(dById).map(function (k) { return dById[k]; });
      }
      write(FAV_KEY, favs);
      write(RECENT_KEY, recent);
      write(EDITS_KEY, edits);
      write(CUSTOM_KEY, custom);
      write(DEPT_EDITS_KEY, deptEdits);
      write(DEPT_CUSTOM_KEY, deptCustom);
      if (mode === "replace") write(BASE_HIDDEN_KEY, data.baseHidden === true);
      else if (data.baseHidden === true) write(BASE_HIDDEN_KEY, true);
      if (data.theme) write(THEME_KEY, data.theme);
      return { favorites: favs.length, recent: recent.length,
        edits: Object.keys(edits).length, custom: custom.length,
        deptCustom: deptCustom.length };
    },
  };

  global.Storage = Storage;
})(window);
