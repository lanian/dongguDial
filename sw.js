/**
 * Service Worker — 오프라인 캐싱.
 * 앱 셸은 캐시 우선, 연락처 데이터는 네트워크 우선(오프라인 시 캐시 폴백).
 */
// 버전 단일 출처: js/version.js 의 APP_VERSION 을 캐시명에 사용.
// SW_REV 는 버전과 함께 올린다 — 이 본문 바이트가 매 릴리스마다 바뀌어야
// (importScripts 된 version.js 가 HTTP 캐시돼도) 브라우저가 SW 갱신을 확실히 감지한다.
// (특히 일부 브라우저는 import 자원 변경만으로 업데이트를 안 잡을 수 있음)
var SW_REV = "213";
importScripts("./js/version.js");
var CACHE = "donggu-dial-v" + (self.APP_VERSION || SW_REV);

var APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/version.js",
  "./js/storage.js",
  "./js/auth.js",
  "./js/backup-crypto.js",
  "./js/photos.js",
  "./js/data.js",
  "./js/import.js",
  "./js/contacts-io.js",
  "./js/data-check.js",
  "./js/backup-io.js",
  "./js/ui.js",
  "./js/app.js",
  "./data/contacts.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // {cache:"reload"}로 HTTP 캐시를 우회해 항상 '최신' 자산을 받아 캐싱한다.
      // (addAll은 HTTP 캐시의 옛 파일을 담을 수 있어, 버전만 오르고 코드는 옛것이 되는
      //  업데이트 누락의 원인이 됨)
      return Promise.all(APP_SHELL.map(function (url) {
        return fetch(new Request(url, { cache: "reload" }))
          .then(function (res) { if (res && (res.ok || res.type === "opaque")) return cache.put(url, res); })
          .catch(function () {});
      }));
    }).then(function () {
      return self.skipWaiting(); // 새 워커가 대기하지 않고 곧바로 활성화되도록
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          if (k !== CACHE) return caches.delete(k);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 연락처 데이터: 네트워크 우선 → 캐시 폴백
  if (url.pathname.endsWith("/data/contacts.json")) {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) {
            c.put(req, copy);
          });
          return res;
        })
        .catch(function () {
          return caches.match(req);
        })
    );
    return;
  }

  // 그 외(앱 셸): 캐시 우선 → 네트워크 폴백
  event.respondWith(
    caches.match(req).then(function (cached) {
      return (
        cached ||
        fetch(req).then(function (res) {
          return res;
        }).catch(function () {
          // HTML 내비게이션 요청은 index.html 로 폴백
          if (req.mode === "navigate") {
            return caches.match("./index.html");
          }
        })
      );
    })
  );
});
