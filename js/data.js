/**
 * 연락처 데이터 로딩 / 조회 / 검색.
 * 정적 JSON(data/contacts.json) 을 한 번 로드해 메모리에 보관한다.
 */
(function (global) {
  "use strict";

  var state = {
    contacts: [],
    departments: [],
    byId: {},
    deptById: {},
  };

  function normalizeDigits(s) {
    return (s || "").replace(/\D/g, "");
  }

  // 한글 초성 추출 (검색 보조용)
  var CHO = [
    "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
    "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
  ];
  function chosung(str) {
    var out = "";
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code >= 0xac00 && code <= 0xd7a3) {
        out += CHO[Math.floor((code - 0xac00) / 588)];
      } else {
        out += str[i];
      }
    }
    return out;
  }

  var INDEX_BASE = { "ㄲ": "ㄱ", "ㄸ": "ㄷ", "ㅃ": "ㅂ", "ㅆ": "ㅅ", "ㅉ": "ㅈ" };
  function nameInitial(name) {
    if (!name) return "#";
    var ch = chosung(name.charAt(0));
    if (!/[ㄱ-ㅎ]/.test(ch)) return "#";
    return INDEX_BASE[ch] || ch;
  }

  function buildSearchIndex(c) {
    var parts = [c.name, c.dept, c.team, c.position, c.work].filter(Boolean);
    c._haystack = parts.join(" ").toLowerCase();
    c._choName = chosung(c.name || "");
    c._phoneDigits = normalizeDigits(c.phone) + " " + normalizeDigits(c.tel);
  }

  var Data = {
    /** JSON 로드 후 인덱싱 */
    load: function () {
      return fetch("data/contacts.json", { cache: "no-cache" })
        .then(function (res) {
          if (!res.ok) throw new Error("데이터 로드 실패: " + res.status);
          return res.json();
        })
        .then(function (json) {
          state.departments = (json.departments || []).slice().sort(function (a, b) {
            return (a.sortOrder || 0) - (b.sortOrder || 0);
          });
          state.deptById = {};
          state.departments.forEach(function (d) {
            state.deptById[d.id] = d;
          });

          state.contacts = json.contacts || [];
          state.byId = {};
          state.contacts.forEach(function (c) {
            state.byId[c.id] = c;
            buildSearchIndex(c);
          });
          return state;
        });
    },

    getById: function (id) {
      return state.byId[id];
    },

    getDepartments: function () {
      return state.departments;
    },

    /** 부서 → 멤버순 정렬된 연락처 그룹 배열 반환 */
    groupedByDept: function () {
      var groups = [];
      state.departments.forEach(function (d) {
        var members = state.contacts
          .filter(function (c) {
            return c.deptId === d.id;
          })
          .sort(function (a, b) {
            return (a.memberSortOrder || 0) - (b.memberSortOrder || 0);
          });
        if (members.length) groups.push({ dept: d, members: members });
      });
      // 부서 미지정 연락처
      var orphans = state.contacts.filter(function (c) {
        return !state.deptById[c.deptId];
      });
      if (orphans.length) {
        groups.push({ dept: { id: 0, name: "기타" }, members: orphans });
      }
      return groups;
    },

    /** 가나다(초성) 인덱스 순서 */
    nameIndexOrder: ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ", "#"],

    /** 이름 첫 글자의 대표 초성(쌍자음은 기본자음으로) */
    nameInitial: function (name) {
      return nameInitial(name);
    },

    /** 초성별 그룹 [{key, members}] (이름 가나다순) */
    groupedByName: function () {
      var map = {};
      state.contacts.forEach(function (c) {
        var k = nameInitial(c.name);
        (map[k] = map[k] || []).push(c);
      });
      return Data.nameIndexOrder
        .filter(function (k) { return map[k]; })
        .map(function (k) {
          return {
            key: k,
            members: map[k].sort(function (a, b) {
              return (a.name || "").localeCompare(b.name || "", "ko");
            }),
          };
        });
    },

    /** id 목록을 연락처 객체 목록으로 (없는 id 는 제외) */
    resolveIds: function (ids) {
      return ids
        .map(function (id) {
          return state.byId[id];
        })
        .filter(Boolean);
    },

    /** 통합 검색: 이름/부서/팀/직책/업무 + 초성 + 전화번호 */
    search: function (query) {
      var q = (query || "").trim().toLowerCase();
      if (!q) return [];
      var qDigits = normalizeDigits(q);
      return state.contacts.filter(function (c) {
        if (c._haystack.indexOf(q) !== -1) return true;
        if (c._choName.indexOf(q) !== -1) return true;
        if (qDigits && c._phoneDigits.indexOf(qDigits) !== -1) return true;
        return false;
      });
    },
  };

  global.Data = Data;
})(window);
