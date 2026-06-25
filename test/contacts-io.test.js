"use strict";
// contacts-io.js 가져오기 매핑 순수 함수 단위 테스트(ContactsIO._test).
// init(ctx)/DOM 없이 모듈 스코프 함수만 검증. Data 는 최소 스텁(digits/getAllContacts) 주입.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");

function loadCIO(existing) {
  const win = {
    Data: {
      digits: function (s) { return (s || "").replace(/\D/g, ""); },
      getAllContacts: function () { return existing || []; },
    },
  };
  new Function("window", fs.readFileSync(path.join(ROOT, "js/contacts-io.js"), "utf8"))(win);
  return win.ContactsIO._test;
}

test("buildFieldMap: 한글/영문 별칭 → 필드 매핑", () => {
  const T = loadCIO();
  const m = T.buildFieldMap(["성명", "직위", "휴대폰", "행정번호", "재직상태", "기타열"]);
  assert.equal(m.name, "성명");
  assert.equal(m.position, "직위");
  assert.equal(m.phone, "휴대폰");
  assert.equal(m.tel, "행정번호");
  assert.equal(m.status, "재직상태");
  assert.equal(m.work, undefined); // 매칭 열 없음
});

test("normStatus: 동의어 정규화 + 미설정 폴백", () => {
  const T = loadCIO();
  assert.equal(T.normStatus("재직중"), "재직");
  assert.equal(T.normStatus("휴직"), "휴직");
  assert.equal(T.normStatus("이상한값"), "미설정");
  assert.equal(T.normStatus(""), "미설정");
});

test("analyzeRows: 위계열 leafOf(말단 우선) + 이름열 없으면 throw", () => {
  const T = loadCIO();
  const rows = [{ "상위부서": "행정국", "과": "총무과", "팀": "인사팀", "이름": "홍길동" }];
  const A = T.analyzeRows(rows);
  assert.equal(A.v(rows[0], "name"), "홍길동");
  assert.equal(A.leafOf(rows[0]), "인사팀"); // 가장 말단 우선
  assert.throws(() => T.analyzeRows([{ "부서": "총무과" }])); // 이름 열 없음 → throw
});

test("matchExisting: 이름+전화 우선, 없으면 이름+부서", () => {
  const T = loadCIO();
  const a = { id: "1", name: "홍길동" }, b = { id: "2", name: "김철수" };
  const idx = { byNamePhone: { "홍길동|01011112222": a }, byNameDept: { "김철수|총무과": b } };
  assert.equal(T.matchExisting(idx, "홍길동", "01011112222", "총무과"), a); // 전화 우선
  assert.equal(T.matchExisting(idx, "김철수", "0102", "총무과"), b);        // 짧은 전화 → 부서 매칭
  assert.equal(T.matchExisting(idx, "없는사람", "0103", "없는과"), null);
});

test("classifyImport: 이름+전화 일치=갱신 / 신규=추가 / 무명=건너뜀", () => {
  const existing = [{ id: "x", name: "홍길동", phone: "010-1111-2222", dept: "총무과" }];
  const T = loadCIO(existing);
  const rows = [
    { "이름": "홍길동", "휴대폰": "010-1111-2222" }, // 기존 일치 → update
    { "이름": "신입", "휴대폰": "010-3333-4444" },    // 신규 → new
    { "이름": "", "휴대폰": "010-5555-6666" },         // 무명 → skip
  ];
  const r = T.classifyImport(rows);
  assert.equal(r.updates, 1);
  assert.equal(r.news, 1);
  assert.equal(r.skipped, 1);
});
