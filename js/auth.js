/**
 * 접근 잠금용 인증 헬퍼.
 * - 지문/얼굴: WebAuthn(플랫폼 인증자). 서버가 없으므로 "이 기기에서 생체인증을 통과했다"는
 *   로컬 게이트로만 사용한다(금고 수준 보안이 아니라 화면 노출 방지용 보조 잠금).
 * - PIN 대체: SHA-256(salt+pin) 해시를 로컬에 저장해 비교.
 * 보안 컨텍스트(HTTPS)와 crypto.subtle 가 필요하다.
 */
(function (global) {
  "use strict";

  function toBytes(buf) {
    return buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  }
  function b64urlEncode(buf) {
    var bytes = toBytes(buf), s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(str) {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    while (str.length % 4) str += "=";
    var bin = atob(str), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function randBytes(n) {
    var a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return a;
  }

  function isSupported() {
    return !!(global.PublicKeyCredential &&
      navigator.credentials && navigator.credentials.create && navigator.credentials.get &&
      global.crypto && global.crypto.subtle);
  }

  // 이 기기에 사용자 인증(지문/얼굴/PIN) 가능한 플랫폼 인증자가 있는지
  function platformAvailable() {
    if (!isSupported() || !PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
      return Promise.resolve(false);
    }
    return PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      .catch(function () { return false; });
  }

  // 자격증명 등록 → 성공 시 credId(base64url) 반환
  function register() {
    if (!isSupported()) return Promise.reject(new Error("WebAuthn 미지원"));
    var opts = {
      publicKey: {
        challenge: randBytes(32),
        rp: { name: "행정전화부", id: location.hostname },
        user: { id: randBytes(16), name: "donggu-dial-user", displayName: "행정전화부 사용자" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          residentKey: "preferred",
        },
        timeout: 60000,
        attestation: "none",
      },
    };
    return navigator.credentials.create(opts).then(function (cred) {
      if (!cred) throw new Error("자격증명 생성 실패");
      return b64urlEncode(cred.rawId);
    });
  }

  // 등록된 자격증명으로 지문 확인 → 통과 시 resolve, 실패/취소 시 reject
  function verify(credId) {
    if (!isSupported()) return Promise.reject(new Error("WebAuthn 미지원"));
    var opts = {
      publicKey: {
        challenge: randBytes(32),
        rpId: location.hostname,
        allowCredentials: credId ? [{ type: "public-key", id: b64urlDecode(credId) }] : undefined,
        userVerification: "required",
        timeout: 60000,
      },
    };
    return navigator.credentials.get(opts).then(function (assertion) {
      if (!assertion) throw new Error("인증 실패");
      return true;
    });
  }

  // PIN 해시. saltB64 가 주어지면 검증용으로 같은 salt 재사용.
  function hashPin(pin, saltB64) {
    var salt = saltB64 ? b64urlDecode(saltB64) : randBytes(16);
    var pinBytes = new TextEncoder().encode(String(pin));
    var data = new Uint8Array(salt.length + pinBytes.length);
    data.set(salt, 0);
    data.set(pinBytes, salt.length);
    return crypto.subtle.digest("SHA-256", data).then(function (digest) {
      return { salt: b64urlEncode(salt), hash: b64urlEncode(digest) };
    });
  }

  global.Lock = {
    isSupported: isSupported,
    platformAvailable: platformAvailable,
    register: register,
    verify: verify,
    hashPin: hashPin,
  };
})(window);
