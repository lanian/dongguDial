"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { loadApp } = require("./helper");

// 조직 순서 ≠ 가나다 순서가 되도록 구성(자치행정과 sort2 < 안전총괄과 sort4)
const BASE = {
  departments: [
    { id: 1, name: "행정복지국", sortOrder: 1 },
    { id: 2, name: "자치행정과", parentId: 1, sortOrder: 2 },
    { id: 3, name: "총무팀", parentId: 2, sortOrder: 3 },
    { id: 4, name: "안전총괄과", parentId: 1, sortOrder: 4 },
  ],
  contacts: [
    { id: 101, name: "홍길동", deptId: 3, position: "팀장", phone: "010-1111-2222", tel: "062-100-0000" },
    { id: 102, name: "김영희", deptId: 2, position: "과장", phone: "010-3333-4444" },
    { id: 103, name: "이순신", deptId: 4, position: "과장", tel: "062-200-0000" },
    { id: 104, name: "박개똥", deptId: 999, tel: "062-100-0000" }, // 고아 부서 + 101과 동일 행정번호
  ],
};

async function loaded() { const a = loadApp(BASE); await a.win.Data.load(); return a.win; }

test("검색: 이름/부서 연산자/제외", async () => {
  const D = (await loaded()).Data;
  assert.equal(D.search("홍길동").length, 1);
  assert.ok(D.search("부서:총무").some((c) => c.name === "홍길동"));
  assert.equal(D.search("과장 -이순신").filter((c) => c.name === "이순신").length, 0);
  assert.ok(D.search("과장").length >= 2);
});

test("검색: 메모(개인)도 일반·필드 검색 포함", async () => {
  const W = await loaded();
  W.Storage.saveContact(101, { memo: "골프모임 회장" }); // 편집으로 메모 저장
  W.Data.rebuild();
  assert.ok(W.Data.search("골프").some((c) => c.id === 101), "일반 검색에 메모 반영");
  assert.ok(W.Data.search("메모:골프").some((c) => c.id === 101), "메모: 필드 검색");
  assert.ok(W.Data.search("비고:회장").some((c) => c.id === 101), "비고: 별칭");
  assert.equal(W.Data.search("골프").filter((c) => c.id !== 101).length, 0, "메모 없는 사람은 미포함");
});

test("조직 경로/깊이", async () => {
  const D = (await loaded()).Data;
  assert.deepEqual(D.deptPath(3).map((p) => p.name), ["행정복지국", "자치행정과", "총무팀"]);
  assert.equal(D.depthOf(3), 2);
});

test("부서 변경이 rebuild 후 반영(회귀 방지)", async () => {
  const win = await loaded();
  const D = win.Data, S = win.Storage;
  assert.ok(D.membersOfDept(3).some((c) => c.id === 101));
  S.saveContact(101, { deptId: 4 });
  D.rebuild();
  assert.ok(!D.membersOfDept(3).some((c) => c.id === 101), "총무팀에서 빠져야");
  assert.ok(D.membersOfDept(4).some((c) => c.id === 101), "안전총괄과로 이동");
  assert.equal(D.getById(101).dept, "안전총괄과");
});

test("데이터 점검: 중복 전화/고아 부서", async () => {
  const D = (await loaded()).Data;
  const r = D.validateContacts();
  assert.ok(r.dupPhones.some((d) => d.people.length >= 2), "062-100-0000 중복");
  assert.ok(r.orphans.some((c) => c.name === "박개똥"), "고아 부서 인원");
});

test("데이터 점검: 휴대폰형식·생일형식·연락두절·이름+전화중복·무명", async () => {
  const BASE2 = {
    departments: [{ id: 1, name: "총무과" }],
    contacts: [
      { id: "a", name: "홍길동", deptId: 1, phone: "010-1111-2222", birth: "1990-01-01" }, // 정상
      { id: "b", name: "홍길동", deptId: 1, phone: "010-1111-2222" },                     // a와 이름+전화 동일 → dupContacts
      { id: "c", name: "김철수", deptId: 1, phone: "012-3456-7" },                        // 휴대폰 형식 이상(01x·10~11자리 아님)
      { id: "d", name: "", deptId: 1, phone: "010-9999-8888" },                          // 무명
      { id: "e", name: "이영희", deptId: 1, birth: "1990/02/02" },                        // 생일형식 이상 + 연락두절
    ],
  };
  const a = loadApp(BASE2); await a.win.Data.load();
  const r = a.win.Data.validateContacts();
  assert.ok(r.dupContacts.some((g) => g.length === 2), "이름+전화 동일 그룹");
  assert.ok(r.badMobile.some((c) => c.id === "c"), "휴대폰 형식 이상");
  assert.ok(r.noName.some((c) => c.id === "d"), "무명");
  assert.ok(r.badBirth.some((c) => c.id === "e"), "생일 형식 이상");
  assert.ok(r.noContact.some((c) => c.id === "e"), "연락 수단 없음");
});

test("조직도 평탄화 = 직제순(가나다와 다름)", async () => {
  const D = (await loaded()).Data;
  const order = [];
  (function flat(nodes) {
    nodes.forEach((n) => { (n.members || []).forEach((m) => order.push(m.name)); if (n.children) flat(n.children); });
  })(D.groupedByOrg());
  // 직제순이면 자치행정과(김영희)가 안전총괄과(이순신)보다 먼저
  assert.ok(order.indexOf("김영희") < order.indexOf("이순신"));
});

test("근무 배치(파견): 소속≠근무지면 두 섹션에 등장", async () => {
  const W = await loaded();                 // BASE: 101 홍길동 deptId 3(총무팀)
  W.Storage.saveContact(101, { workDeptId: 4 }); // 근무 배치: 안전총괄과(4)
  W.Data.rebuild();
  const groups = W.Data.groupedByDept();
  const dept = (id) => (groups.find((g) => g.dept.id === id) || { members: [] }).members;
  const home = dept(3).find((m) => m.id === 101);   // 소속 섹션
  const work = dept(4).find((m) => m.id === 101);   // 근무지 섹션
  assert.ok(home && !home._asWork, "소속(3) 섹션에 원본");
  assert.equal(home.workDept, "안전총괄과", "근무지 이름 해결");
  assert.ok(work && work._asWork, "근무지(4) 섹션에 파견 사본(_asWork)");
  assert.equal(work.dept, "총무팀", "파견 사본의 dept 는 소속명");
  assert.equal(home.id, work.id, "같은 id(동일 인물)");
});
