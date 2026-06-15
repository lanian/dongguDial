/**
 * 즐겨찾기 / 최근 본 연락처 로컬 저장소.
 * Android 앱의 Favorites / RecentContacts 테이블을 localStorage 로 대체한다.
 */
(function (global) {
  "use strict";

  var FAV_KEY = "dongguDial.favorites.v1";
  var RECENT_KEY = "dongguDial.recent.v1";
  var RECENT_LIMIT = 30;

  function read(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* 저장 실패는 무시 (시크릿 모드 등) */
    }
  }

  var Storage = {
    getFavorites: function () {
      return read(FAV_KEY);
    },

    isFavorite: function (id) {
      return read(FAV_KEY).indexOf(id) !== -1;
    },

    toggleFavorite: function (id) {
      var favs = read(FAV_KEY);
      var idx = favs.indexOf(id);
      if (idx === -1) {
        favs.push(id);
      } else {
        favs.splice(idx, 1);
      }
      write(FAV_KEY, favs);
      return idx === -1; // true = 즐겨찾기 추가됨
    },

    getRecent: function () {
      return read(RECENT_KEY); // 최신순
    },

    pushRecent: function (id) {
      var recent = read(RECENT_KEY).filter(function (x) {
        return x !== id;
      });
      recent.unshift(id);
      if (recent.length > RECENT_LIMIT) {
        recent = recent.slice(0, RECENT_LIMIT);
      }
      write(RECENT_KEY, recent);
    },

    // ---------- 백업 / 복구 ----------

    counts: function () {
      return { favorites: read(FAV_KEY).length, recent: read(RECENT_KEY).length };
    },

    /** 현재 로컬 데이터(즐겨찾기·최근)를 백업 객체로 직렬화 */
    exportData: function () {
      return {
        app: "dongguDial",
        type: "backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        favorites: read(FAV_KEY),
        recent: read(RECENT_KEY),
      };
    },

    /**
     * 백업 객체로 복구. mode: "merge"(기본) | "replace".
     * 반환: 적용 후 개수 {favorites, recent}. 형식 오류 시 throw.
     */
    importData: function (data, mode) {
      if (!data || data.app !== "dongguDial" || data.type !== "backup") {
        throw new Error("행정전화부 백업 파일이 아닙니다.");
      }
      var inFav = Array.isArray(data.favorites)
        ? data.favorites.filter(function (x) { return typeof x === "number"; })
        : [];
      var inRecent = Array.isArray(data.recent)
        ? data.recent.filter(function (x) { return typeof x === "number"; })
        : [];

      var favs, recent;
      if (mode === "replace") {
        favs = inFav.slice();
        recent = inRecent.slice(0, RECENT_LIMIT);
      } else {
        // merge: 기존 우선 유지하며 중복 제거
        var curFav = read(FAV_KEY);
        favs = curFav.slice();
        inFav.forEach(function (x) {
          if (favs.indexOf(x) === -1) favs.push(x);
        });
        // 최근: 가져온 항목을 앞쪽에 두되 기존과 합쳐 중복 제거 후 제한
        recent = [];
        inRecent.concat(read(RECENT_KEY)).forEach(function (x) {
          if (recent.indexOf(x) === -1) recent.push(x);
        });
        recent = recent.slice(0, RECENT_LIMIT);
      }
      write(FAV_KEY, favs);
      write(RECENT_KEY, recent);
      return { favorites: favs.length, recent: recent.length };
    },
  };

  global.Storage = Storage;
})(window);
