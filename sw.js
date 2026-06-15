/**
 * Service Worker — 오프라인 캐싱.
 * 앱 셸은 캐시 우선, 연락처 데이터는 네트워크 우선(오프라인 시 캐시 폴백).
 */
var CACHE = "donggu-dial-v23";

var APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/storage.js",
  "./js/photos.js",
  "./js/data.js",
  "./js/import.js",
  "./js/ui.js",
  "./js/app.js",
  "./data/contacts.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(APP_SHELL);
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
