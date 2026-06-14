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
  };

  global.Storage = Storage;
})(window);
