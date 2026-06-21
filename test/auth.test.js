"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const { loadApp } = require("./helper");

test("PIN: PBKDF2 신규 생성·검증", async () => {
  const L = loadApp().win.Lock;
  const rec = await L.hashPin("1234");
  assert.equal(rec.kdf, "pbkdf2");
  assert.ok(rec.iter >= 100000);
  assert.equal(await L.verifyPin("1234", rec), true);
  assert.equal(await L.verifyPin("0000", rec), false);
  assert.equal(L.isLegacyPin(rec), false);
});

test("PIN: 레거시 SHA-256 레코드 검증 호환", async () => {
  const L = loadApp().win.Lock;
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pin = enc.encode("4321");
  const data = new Uint8Array(salt.length + pin.length);
  data.set(salt, 0); data.set(pin, salt.length);
  const dg = await crypto.subtle.digest("SHA-256", data);
  const b64url = (buf) => {
    const b = new Uint8Array(buf); let s = "";
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const legacy = { salt: b64url(salt), hash: b64url(dg) }; // kdf 없음 = 레거시
  assert.equal(L.isLegacyPin(legacy), true);
  assert.equal(await L.verifyPin("4321", legacy), true);
  assert.equal(await L.verifyPin("9999", legacy), false);
});
