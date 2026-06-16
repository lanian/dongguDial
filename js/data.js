/**
 * 연락처 데이터 로딩 / 조회 / 검색.
 * 정적 JSON(data/contacts.json) 을 한 번 로드해 메모리에 보관한다.
 */
(function (global) {
  "use strict";

  var state = {
    base: [],          // JSON 원본 연락처
    contacts: [],      // 편집/추가 오버레이가 적용된 유효 연락처
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

  // 부서를 트리(DFS) 순서로 — 부모 바로 뒤에 그 자손들. 부모 이동 시 자손이 따라옴.
  function deptTreeOrder(depts, byId) {
    var byParent = {};
    depts.forEach(function (d) { (byParent[d.parentId || 0] = byParent[d.parentId || 0] || []).push(d); });
    var out = [], seen = {};
    function walk(pid) {
      (byParent[pid] || []).forEach(function (d) {
        if (seen[d.id]) return;
        seen[d.id] = true; out.push(d); walk(d.id);
      });
    }
    // 최상위(부모 없음 또는 부모가 사라진 고아)부터 sortOrder 순으로, 각자 자손 DFS
    depts.forEach(function (d) {
      if ((!d.parentId || !byId[d.parentId]) && !seen[d.id]) { seen[d.id] = true; out.push(d); walk(d.id); }
    });
    // 순환 등으로 남은 항목 보강
    depts.forEach(function (d) { if (!seen[d.id]) { seen[d.id] = true; out.push(d); } });
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
          state.baseDepartments = (json.departments || []).slice();
          state.base = json.contacts || [];
          Data.rebuild();
          return state;
        });
    },

    /** 부서·연락처 오버레이(편집/추가/삭제)를 기본 데이터에 병합해 유효 상태 재구성 */
    rebuild: function () {
      var S = global.Storage;
      var hideBase = !!(S && S.getBaseHidden && S.getBaseHidden());

      // 1) 부서: 오버레이 적용 → sortOrder(직제) 정렬
      var deptEdits = (S && S.getDeptEdits) ? S.getDeptEdits() : {};
      var deptCustom = (S && S.getDeptCustom) ? S.getDeptCustom() : [];
      var depts = [];
      if (!hideBase) {
        (state.baseDepartments || []).forEach(function (d) {
          var e = deptEdits[d.id];
          if (e && e.__deleted) return;
          depts.push(e ? Object.assign({}, d, e) : d);
        });
      }
      deptCustom.forEach(function (d) {
        var e = deptEdits[d.id];
        if (e && e.__deleted) return;
        depts.push(e ? Object.assign({}, d, e) : Object.assign({ _custom: true }, d));
      });
      depts.sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
      state.departments = depts;
      state.deptById = {};
      depts.forEach(function (d) { state.deptById[d.id] = d; });
      state.departmentsTree = deptTreeOrder(depts, state.deptById); // 표시용 트리 순서

      // 2) 연락처: 오버레이 적용(항상 사본, 부서명은 deptById 단일 원천화)
      var edits = (S && S.getEdits) ? S.getEdits() : {};
      var customs = (S && S.getCustom) ? S.getCustom() : [];
      var memberOrder = (S && S.getMemberOrder) ? S.getMemberOrder() : {};
      var eff = [];
      function add(c, isCustom) {
        var e = edits[c.id];
        if (e && e.__deleted) return;
        var v = Object.assign({}, c, e || {});
        if (e) v._edited = true;
        if (isCustom) v._custom = true;
        // 사용자 지정 사원 순서(별도 맵) — _edited 표시 없이 표시 순서만 덮어씀
        if (memberOrder[v.id] != null) v.memberSortOrder = memberOrder[v.id];
        var d = state.deptById[v.deptId];
        if (d) v.dept = d.name; // 부서명 변경이 연락처 표시·검색에 즉시 반영
        eff.push(v);
      }
      if (!hideBase) state.base.forEach(function (c) { add(c, false); });
      customs.forEach(function (c) { add(c, true); });
      state.contacts = eff;
      state.byId = {};
      state.membersByDept = {};
      eff.forEach(function (c) {
        state.byId[c.id] = c;
        (state.membersByDept[c.deptId] = state.membersByDept[c.deptId] || []).push(c);
        buildSearchIndex(c);
      });
    },

    getById: function (id) {
      return state.byId[id];
    },

    getDepartments: function () {
      return state.departmentsTree || state.departments;
    },

    getDeptById: function (id) {
      return state.deptById[id]; // 객체 키는 문자열 강제 → 숫자/문자 id 모두 조회
    },

    /** parentId 체인으로 계산한 표시용 깊이(0=최상위). level 비정규화 의존 제거 */
    depthOf: function (id) {
      var d = state.deptById[id], n = 0, guard = 0;
      while (d && d.parentId && state.deptById[d.parentId] && guard++ < 64) {
        d = state.deptById[d.parentId];
        n++;
      }
      return n;
    },

    /** 부서 조직 경로(최상위→해당 부서) [{id,name}...] */
    deptPath: function (id) {
      var out = [], d = state.deptById[id], guard = 0;
      while (d && guard++ < 64) {
        out.unshift({ id: d.id, name: d.name });
        d = d.parentId ? state.deptById[d.parentId] : null;
      }
      return out;
    },

    /** 부서 직속 인원(멤버순 정렬) */
    membersOfDept: function (id) {
      return (state.membersByDept[id] || []).slice().sort(function (a, b) {
        return (a.memberSortOrder || 0) - (b.memberSortOrder || 0);
      });
    },

    /** 부서별 직속 인원 수 맵 */
    directCountByDept: function () {
      var m = {};
      Object.keys(state.membersByDept || {}).forEach(function (k) { m[k] = state.membersByDept[k].length; });
      return m;
    },

    /** 상위부서별 하위부서 수 맵 */
    childCountByParent: function () {
      var m = {};
      state.departments.forEach(function (d) {
        if (d.parentId) m[d.parentId] = (m[d.parentId] || 0) + 1;
      });
      return m;
    },

    /** 부서 → 멤버순 정렬된 연락처 그룹 배열 반환 */
    groupedByDept: function () {
      var groups = [];
      (state.departmentsTree || state.departments).forEach(function (d) {
        var members = Data.membersOfDept(d.id);
        if (members.length) groups.push({ dept: d, members: members });
      });
      var orphans = state.contacts.filter(function (c) { return !state.deptById[c.deptId]; });
      if (orphans.length) groups.push({ dept: { id: 0, name: "기타" }, members: orphans });
      return groups;
    },

    /** 임의 연락처 목록(예: 검색 결과)을 부서 트리 순서로 그룹화 */
    groupContactsByDept: function (contacts) {
      var byDept = {};
      contacts.forEach(function (c) {
        (byDept[c.deptId] = byDept[c.deptId] || []).push(c);
      });
      function sortMembers(arr) {
        return arr.slice().sort(function (a, b) {
          return (a.memberSortOrder || 0) - (b.memberSortOrder || 0);
        });
      }
      var groups = [];
      (state.departmentsTree || state.departments).forEach(function (d) {
        var members = byDept[d.id];
        if (members && members.length) groups.push({ dept: d, members: sortMembers(members) });
      });
      var orphans = contacts.filter(function (c) { return !state.deptById[c.deptId]; });
      if (orphans.length) groups.push({ dept: { id: 0, name: "기타" }, members: sortMembers(orphans) });
      return groups;
    },

    /** 조직도: parentId 기반 재귀 트리(국→과→팀, 실/관→팀 등 임의 깊이) */
    groupedByOrg: function () {
      var depts = state.departments; // sortOrder(직제) 정렬됨
      function buildNode(dept) {
        var members = Data.membersOfDept(dept.id);
        var children = depts
          .filter(function (d) { return d.parentId === dept.id; })
          .map(buildNode)
          .filter(function (n) { return n.count > 0; });
        var count = members.length + children.reduce(function (a, n) { return a + n.count; }, 0);
        return { dept: dept, members: members, children: children, count: count };
      }
      // 부모가 사라진 부서(고아)도 루트로 끌어올려 조직도 누락 방지
      var roots = depts
        .filter(function (d) { return !d.parentId || !state.deptById[d.parentId]; })
        .map(buildNode)
        .filter(function (n) { return n.count > 0; });
      var orphan = state.contacts.filter(function (c) { return !state.deptById[c.deptId]; });
      if (orphan.length) {
        roots.push({ dept: { id: 0, name: "기타" }, members: orphan, children: [], count: orphan.length });
      }
      return roots;
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
