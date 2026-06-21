"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { loadApp } = require("./helper");

test("parseCSV: 헤더+행, 쉼표/따옴표 이스케이프, BOM, CRLF", () => {
  const I = loadApp().win.Importer;
  const csv = "﻿이름,부서,담당업무\r\n홍길동,총무팀,\"총무, 인사\"\r\n\"김\"\"영\"\"희\",행정과,행정\r\n";
  const rows = I.parseCSV(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["이름"], "홍길동");      // BOM 제거됨
  assert.equal(rows[0]["담당업무"], "총무, 인사"); // 따옴표 안 쉼표 보존
  assert.equal(rows[1]["이름"], '김"영"희');      // 이스케이프된 따옴표
});

test("parseCSV: 빈 행 제거", () => {
  const I = loadApp().win.Importer;
  const rows = I.parseCSV("이름\r\n\r\nA\r\n");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["이름"], "A");
});
