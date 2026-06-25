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

  // 부서 조상 체인(말단→최상위) 노드 배열. 모든 경로/깊이 계산의 단일 출처(순환 방어 guard 64).
  function walkUp(deptId) {
    var out = [], d = state.deptById[deptId], guard = 0;
    while (d && guard++ < 64) { out.push(d); d = d.parentId ? state.deptById[d.parentId] : null; }
    return out;
  }
  // 부서 경로 이름들(말단→최상위). 상위 부서(국/과)로도 검색되게 인덱스에 포함.
  function deptPathNames(deptId) {
    return walkUp(deptId).map(function (d) { return d.name; }).filter(Boolean);
  }

  function buildSearchIndex(c) {
    // 재직상태도 일반어 검색 대상(예: '파견', '-교육'). 기본값 '미설정'은 잡음이라 제외.
    var st = (c.status && c.status !== "미설정") ? c.status : null;
    // 부서는 말단뿐 아니라 상위 경로(국▸과▸팀) 전체를 포함 → 상위 부서명으로도 검색·필터 가능.
    var pathNames = deptPathNames(c.deptId); // [말단, 상위, …, 최상위]
    var deptAll = pathNames.join(" ") || c.dept || "";
    // 행 표시용: 상위 1단계 + 말단(예: '총무과 › 인사팀'). 그룹 헤더 없는 가나다순·검색에서 맥락 제공.
    c._deptShort = pathNames.length >= 2 ? (pathNames[1] + " › " + pathNames[0]) : (pathNames[0] || c.dept || "");
    var parts = [c.name, deptAll, c.team, c.position, c.grade, c.work, st, c.memo].filter(Boolean);
    c._haystack = parts.join(" ").toLowerCase();
    c._choName = chosung(c.name || "");
    c._phoneDigits = normalizeDigits(c.phone) + " " + normalizeDigits(c.tel);
    // 필드 필터(부서:·직책: 등)용 필드별 소문자 인덱스
    c._fields = {
      name: (c.name || "").toLowerCase(),
      dept: deptAll.toLowerCase(),
      team: (c.team || "").toLowerCase(),
      position: (c.position || "").toLowerCase(),
      grade: (c.grade || "").toLowerCase(),
      work: (c.work || "").toLowerCase(),
      status: (c.status || "").toLowerCase(),
      birth: (c.birth || "").toLowerCase(),
      memo: (c.memo || "").toLowerCase(),
      phone: c._phoneDigits,
    };
  }

  // ---------- 검색 쿼리 파서 (연산자) ----------
  // 지원: 공백=AND, -단어=제외, 필드:값(부서:·직책: 등), "구"=따옴표, |=OR.
  // 의미: OR로 나뉜 그룹들 중 하나라도 만족(some) + 각 그룹 안의 절은 모두 만족(every).
  // NOTE: 검색 필드 동의어(별칭→필드). CSV 가져오기 동의어는 js/contacts-io.js 의 FIELD_ALIASES
  //       (필드→별칭 배열, 역방향·필드셋 다름). 동의어 수정 시 두 곳을 함께 살펴볼 것.
  var FIELD_ALIASES = {
    "이름": "name", "성명": "name", "name": "name",
    "부서": "dept", "소속": "dept", "dept": "dept",
    "팀": "team", "team": "team",
    "직책": "position", "직위": "position", "position": "position",
    "직급": "grade", "급수": "grade", "grade": "grade",
    "업무": "work", "담당": "work", "담당업무": "work", "work": "work",
    "전화": "phone", "번호": "phone", "연락처": "phone", "휴대폰": "phone",
    "휴대전화": "phone", "내선": "phone", "행정번호": "phone", "phone": "phone", "tel": "phone",
    "상태": "status", "재직상태": "status", "status": "status",
    "생일": "birth", "생년": "birth", "생년월일": "birth", "birth": "birth",
    "메모": "memo", "비고": "memo", "노트": "memo", "memo": "memo",
  };

  // 따옴표 안의 공백은 한 토큰으로 보존하고, | 는 독립 토큰으로 분리.
  function tokenizeQuery(q) {
    var out = [], i = 0, n = q.length, buf = "", inQuote = false;
    function flush() { if (buf) { out.push(buf); buf = ""; } }
    while (i < n) {
      var ch = q.charAt(i);
      if (inQuote) {
        if (ch === '"') inQuote = false; else buf += ch;
      } else if (ch === '"') { inQuote = true; }
      else if (ch === " " || ch === "\t") { flush(); }
      else if (ch === "|") { flush(); out.push("|"); }
      else { buf += ch; }
      i++;
    }
    flush();
    return out;
  }

  // 토큰 1개 → {neg, field, value}. 매칭에 무의미한 토큰은 null.
  function parseClause(tok) {
    var neg = false;
    if (tok.charAt(0) === "-" && tok.length > 1) { neg = true; tok = tok.slice(1); }
    var field = null, value = tok, colon = tok.indexOf(":");
    if (colon > 0) {
      var f = FIELD_ALIASES[tok.slice(0, colon).toLowerCase()];
      if (f) { field = f; value = tok.slice(colon + 1); }
    }
    value = value.toLowerCase().trim();
    if (!value) return null;
    return { neg: neg, field: field, value: value };
  }

  // 쿼리 → [[clause…AND] …OR] 또는 null(빈 쿼리)
  function parseQuery(query) {
    var q = (query || "").trim();
    if (!q) return null;
    var groups = [[]];
    tokenizeQuery(q).forEach(function (t) {
      if (t === "|") { groups.push([]); return; }
      var cl = parseClause(t);
      if (cl) groups[groups.length - 1].push(cl);
    });
    groups = groups.filter(function (g) { return g.length; });
    return groups.length ? groups : null;
  }

  function matchClause(c, cl) {
    var hit;
    if (cl.field === "phone") {
      var d = normalizeDigits(cl.value);
      hit = d ? c._fields.phone.indexOf(d) !== -1 : false;
    } else if (cl.field) {
      hit = (c._fields[cl.field] || "").indexOf(cl.value) !== -1;
      if (!hit && cl.field === "name") hit = c._choName.indexOf(cl.value) !== -1;
    } else {
      hit = c._haystack.indexOf(cl.value) !== -1 || c._choName.indexOf(cl.value) !== -1;
      if (!hit) { var pd = normalizeDigits(cl.value); if (pd) hit = c._phoneDigits.indexOf(pd) !== -1; }
    }
    return cl.neg ? !hit : hit;
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
      // 번들(초기) 명부가 실제로 존재하고 표시되는지. 없으면 모든 데이터가 사용자
      // 데이터이므로 '추가/수정됨' 구분 표시가 무의미 → UI에서 숨기는 데 사용.
      state.hasBase = !hideBase &&
        (((state.base || []).length > 0) || ((state.baseDepartments || []).length > 0));

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

    /** 오버레이 적용된 유효 연락처 전체(사본) — 내보내기 등 */
    getAllContacts: function () {
      return state.contacts.slice();
    },

    /** 데이터 품질 점검(읽기 전용): 중복 전화·부서 미배정·생일형식 오류·빈 부서명 */
    validateContacts: function () {
      var byPhone = {}, byName = {}, byNamePhone = {};
      var dupPhones = [], orphans = [], badBirth = [];
      var noName = [], noContact = [], badMobile = [], dupNames = [], dupContacts = [];
      state.contacts.forEach(function (c) {
        var nm = (c.name || "").trim();
        if (!nm) noName.push(c);
        else (byName[nm] = byName[nm] || []).push(c);
        var dPhone = normalizeDigits(c.phone), dTel = normalizeDigits(c.tel);
        [c.phone, c.tel].forEach(function (p) {
          var d = normalizeDigits(p);
          if (d.length < 7) return; // 내선 등 짧은 번호는 중복 판정 제외
          (byPhone[d] = byPhone[d] || {})[c.id] = c;
        });
        if (!dPhone && !dTel) noContact.push(c); // 연락 수단 전무(짧은 내선도 없음)
        if (dPhone.length >= 7 && !/^01\d{8,9}$/.test(dPhone)) badMobile.push(c); // 휴대폰 형식 이상(01x·10~11자리 아님)
        if (!state.deptById[c.deptId]) orphans.push(c);
        if (c.birth && !/^\d{4}-\d{2}-\d{2}$/.test(c.birth)) badBirth.push(c);
        if (nm && dPhone.length >= 7) (byNamePhone[nm + "|" + dPhone] = byNamePhone[nm + "|" + dPhone] || []).push(c);
      });
      Object.keys(byPhone).forEach(function (d) {
        var m = byPhone[d], ids = Object.keys(m);
        if (ids.length > 1) dupPhones.push({ phone: d, people: ids.map(function (id) { return m[id]; }) });
      });
      Object.keys(byName).forEach(function (nm) {
        if (byName[nm].length > 1) dupNames.push({ name: nm, people: byName[nm] });
      });
      Object.keys(byNamePhone).forEach(function (k) {
        if (byNamePhone[k].length > 1) dupContacts.push(byNamePhone[k]); // 이름+전화 동일 = 중복 의심
      });
      var emptyDepts = (state.departments || []).filter(function (d) { return !(d.name || "").trim(); });
      return {
        total: state.contacts.length,
        dupPhones: dupPhones, orphans: orphans, badBirth: badBirth, emptyDepts: emptyDepts,
        noName: noName, noContact: noContact, badMobile: badMobile, dupNames: dupNames, dupContacts: dupContacts,
      };
    },

    getDepartments: function () {
      return state.departmentsTree || state.departments;
    },

    /** 번들 명부가 존재/표시되는지. false면 모든 항목이 사용자 데이터(추가/수정 구분 무의미) */
    hasBaseData: function () { return !!state.hasBase; },

    getDeptById: function (id) {
      return state.deptById[id]; // 객체 키는 문자열 강제 → 숫자/문자 id 모두 조회
    },

    /** parentId 체인으로 계산한 표시용 깊이(0=최상위). level 비정규화 의존 제거 */
    depthOf: function (id) {
      return Math.max(0, walkUp(id).length - 1);
    },

    /** 부서 조직 경로(최상위→해당 부서) [{id,name}...] */
    deptPath: function (id) {
      return walkUp(id).map(function (d) { return { id: d.id, name: d.name }; }).reverse();
    },

    /** 부서 id 의 모든 하위(자손) id 집합 {id:true} — 순환 부모 선택 방지·하위 일괄 펼침 등 */
    descendantIds: function (id) {
      var set = {};
      if (id == null) return set;
      var byParent = {};
      state.departments.forEach(function (d) { (byParent[d.parentId || 0] = byParent[d.parentId || 0] || []).push(d.id); });
      (function rec(pid) { (byParent[pid] || []).forEach(function (cid) { if (!set[cid]) { set[cid] = true; rec(cid); } }); })(id);
      return set;
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
      // seen: 데이터 오류(A↔B 상호 부모, 자기참조 등)로 인한 무한재귀·스택오버플로 방어.
      // depthOf/deptPath 는 guard 가 있는데 트리 빌드만 없어 한쪽만 죽던 비대칭을 해소한다.
      function buildNode(dept, seen) {
        seen = seen || {};
        seen[dept.id] = true;
        var members = Data.membersOfDept(dept.id);
        var children = depts
          .filter(function (d) { return d.parentId === dept.id && d.id !== dept.id && !seen[d.id]; })
          .map(function (d) { return buildNode(d, Object.assign({}, seen)); })
          .filter(function (n) { return n.count > 0; });
        var count = members.length + children.reduce(function (a, n) { return a + n.count; }, 0);
        return { dept: dept, members: members, children: children, count: count };
      }
      // 부모가 사라진 부서(고아)도 루트로 끌어올려 조직도 누락 방지
      var roots = depts
        .filter(function (d) { return !d.parentId || !state.deptById[d.parentId]; })
        // 래퍼로 감싸 호출 — .map(buildNode) 는 콜백에 (dept, index)를 넘겨
        // 두 번째 인자 seen 에 배열 인덱스(숫자)가 들어가 크래시(루트 2개 이상일 때)
        .map(function (d) { return buildNode(d); })
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

    /** 문자열의 초성열(한글→초성, 그 외 글자 그대로). 입력 1글자당 출력 1글자라
     *  인덱스가 원문과 1:1 정렬됨 → 초성 검색 결과의 강조 위치 매핑에 사용. */
    chosung: function (s) {
      return chosung(s || "");
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

    /** 통합 검색(연산자 지원): 공백=AND · -제외 · 필드:값 · "구" · |=OR.
     *  기본 토큰은 이름/부서/팀/직책/업무 + 초성 + 전화번호에서 부분일치. */
    search: function (query) {
      var groups = parseQuery(query);
      if (!groups) return [];
      return state.contacts.filter(function (c) {
        return groups.some(function (g) {
          return g.every(function (cl) { return matchClause(c, cl); });
        });
      });
    },

    /** 결과 하이라이트용 긍정 검색어 목록(제외·전화 토큰 제외, 중복 제거) */
    highlightTerms: function (query) {
      var groups = parseQuery(query);
      if (!groups) return [];
      var terms = [], seen = {};
      groups.forEach(function (g) {
        g.forEach(function (cl) {
          if (cl.neg || cl.field === "phone" || !cl.value || seen[cl.value]) return;
          seen[cl.value] = true; terms.push(cl.value);
        });
      });
      return terms;
    },
  };

  global.Data = Data;
})(window);
