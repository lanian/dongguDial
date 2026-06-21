"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { loadApp } = require("./helper");

test("오버레이: base 편집은 edits, 추가는 custom", () => {
  const S = loadApp().win.Storage;
  S.saveContact(101, { name: "수정됨" });
  assert.equal(S.getEdits()["101"].name, "수정됨");
  const id = S.addContact({ name: "새사람" });
  assert.ok(S.isCustom(id));
  assert.equal(S.getCustom().length, 1);
});

test("백업 export 포맷 + replace 복구", () => {
  const S = loadApp().win.Storage;
  S.addContact({ name: "A" });
  const bk = S.exportData();
  assert.equal(bk.app, "dongguDial");
  assert.equal(bk.type, "backup");
  assert.equal(bk.version, 4);
  const S2 = loadApp().win.Storage;
  S2.importData(bk, "replace");
  assert.equal(S2.getCustom().length, 1);
});

test("importData: 잘못된 파일 거부, 구버전(v2) 통과", () => {
  const S = loadApp().win.Storage;
  assert.throws(() => S.importData({ app: "x" }, "merge"));
  S.importData({ app: "dongguDial", type: "backup", version: 2, custom: [{ id: "u1", name: "B" }] }, "replace");
  assert.equal(S.getCustom().length, 1);
});

test("글자크기: 기본값/검증/폴백", () => {
  const S = loadApp().win.Storage;
  assert.equal(S.getFontScale(), "1");
  S.setFontScale("1.15");
  assert.equal(S.getFontScale(), "1.15");
  S.setFontScale("9"); // 허용 외 값 → 기본
  assert.equal(S.getFontScale(), "1");
});

test("PIN 실패 카운터 저장/초기화", () => {
  const S = loadApp().win.Storage;
  assert.deepEqual(S.getLockFails(), { count: 0, lockedUntil: 0 });
  S.setLockFails({ count: 3, lockedUntil: 123 });
  assert.equal(S.getLockFails().count, 3);
});
