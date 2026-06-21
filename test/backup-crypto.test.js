"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { loadApp } = require("./helper");

test("백업 암호화: 왕복(encrypt→decrypt) 복원", async () => {
  const B = loadApp().win.BackupCrypto;
  const obj = { app: "dongguDial", custom: [{ id: "u1", name: "홍길동" }], n: 42 };
  const env = await B.encrypt(obj, "secret-pass");
  assert.equal(env.type, "backup-enc");
  assert.equal(env.kdf, "PBKDF2-SHA256");
  assert.ok(env.salt && env.iv && env.ct);
  const back = await B.decrypt(env, "secret-pass");
  assert.deepEqual(back, obj);
});

test("백업 암호화: 틀린 암호는 복호화 실패", async () => {
  const B = loadApp().win.BackupCrypto;
  const env = await B.encrypt({ a: 1 }, "right");
  await assert.rejects(() => B.decrypt(env, "wrong"));
});

test("백업 암호화: 매 호출 salt/iv 무작위(같은 입력도 다른 ct)", async () => {
  const B = loadApp().win.BackupCrypto;
  const e1 = await B.encrypt({ a: 1 }, "p");
  const e2 = await B.encrypt({ a: 1 }, "p");
  assert.notEqual(e1.ct, e2.ct);
  assert.notEqual(e1.salt, e2.salt);
});
