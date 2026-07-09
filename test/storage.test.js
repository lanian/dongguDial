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

test("초기화 분리: resetAllEdits=편집만(즐겨찾기 유지), resetFavoritesRecent=즐겨찾기·최근·그룹", () => {
  const S = loadApp().win.Storage;
  S.toggleFavorite("c1");
  S.pushRecent("c2");
  S.addFavGroup("VIP");
  const id = S.addContact({ name: "커스텀" });
  assert.ok(S.getFavorites().indexOf("c1") >= 0);
  assert.ok(S.getRecentEntries().some((e) => e.id === "c2"));

  S.resetAllEdits(); // 편집·추가만 초기화 — 즐겨찾기·최근은 유지
  assert.equal(S.getCustom().length, 0, "custom 초기화");
  assert.ok(S.getFavorites().indexOf("c1") >= 0, "즐겨찾기 유지");
  assert.ok(S.getRecentEntries().some((e) => e.id === "c2"), "최근 유지");
  assert.equal(S.getFavGroups().length, 1, "즐겨찾기 그룹 유지");

  S.resetFavoritesRecent(); // 즐겨찾기·최근·그룹 초기화
  assert.equal(S.getFavorites().length, 0, "즐겨찾기 초기화");
  assert.equal(S.getRecentEntries().length, 0, "최근 초기화");
  assert.equal(S.getFavGroups().length, 0, "즐겨찾기 그룹 초기화");
});

test("백업 복구 시한: TTL 설정 → expiresAt 부여, 만료 백업은 복구 차단", () => {
  const S = loadApp().win.Storage;
  assert.equal(S.getBackupTtl(), 0); // 기본 무제한
  S.setBackupTtl(90);
  assert.equal(S.getBackupTtl(), 90);
  const bk = S.exportData();
  assert.ok(bk.expiresAt, "expiresAt 부여됨");
  assert.ok(Date.parse(bk.expiresAt) > Date.now(), "미래 시점");

  const expired = Object.assign({}, bk, { expiresAt: "2000-01-01T00:00:00.000Z" });
  assert.throws(() => S.importData(expired, "replace"), /EXPIRED/, "만료 백업 복구 차단");

  const noTtl = Object.assign({}, bk); delete noTtl.expiresAt;
  assert.doesNotThrow(() => S.importData(noTtl, "replace"), "시한 없는 백업 정상");
  assert.doesNotThrow(() => S.importData(bk, "replace"), "미래 시한 백업 정상");

  S.setBackupTtl(0);
  assert.ok(!S.exportData().expiresAt, "무제한이면 expiresAt 없음");
  S.setBackupTtl(9999); // 허용 외 값
  assert.equal(S.getBackupTtl(), 0, "잘못된 값은 무제한 폴백");
});
