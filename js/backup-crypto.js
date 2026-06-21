/**
 * 백업 파일 암·복호화 (WebCrypto: PBKDF2-SHA256 → AES-256-GCM).
 * 모든 처리는 기기 로컬. app.js 에서 분리한 자기완결 모듈(외부 상태 의존 없음).
 */
(function (global) {
  "use strict";

  var KDF_ITER = 150000;

  function b64enc(buf) { var b = new Uint8Array(buf), s = ""; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function b64dec(b64) { var s = atob(b64), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

  function deriveKey(pass, salt, iter) {
    return crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]).then(function (km) {
      return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" },
        km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }

  /** 객체 → 암호화 봉투(envelope). 반환: Promise<{app,type:"backup-enc",...}> */
  function encrypt(obj, pass) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var pt = new TextEncoder().encode(JSON.stringify(obj));
    return deriveKey(pass, salt, KDF_ITER).then(function (key) {
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, pt);
    }).then(function (ct) {
      return { app: "dongguDial", type: "backup-enc", v: 1, kdf: "PBKDF2-SHA256",
        iter: KDF_ITER, salt: b64enc(salt), iv: b64enc(iv), ct: b64enc(ct) };
    });
  }

  /** 봉투 + 암호 → 원본 객체. 반환: Promise<obj> (실패 시 reject) */
  function decrypt(env, pass) {
    return deriveKey(pass, b64dec(env.salt), env.iter || KDF_ITER).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: b64dec(env.iv) }, key, b64dec(env.ct));
    }).then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); });
  }

  global.BackupCrypto = { encrypt: encrypt, decrypt: decrypt, KDF_ITER: KDF_ITER };
})(typeof window !== "undefined" ? window : globalThis);
