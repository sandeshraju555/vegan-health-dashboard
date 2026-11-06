// Service worker: caches the page shell and the knowledge file so the
// dashboard still opens and reads offline. Registration (in app.js) is
// wrapped so a browser that blocks or lacks service workers just skips it
// quietly — nothing here assumes it ran.
"use strict";

var CACHE_NAME = "vhd-cache-v17";
var SHELL_URLS = [
  "./",
  "./index.html",
  "./app.js",
  "./integrity.js",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "../knowledge/knowledge.sample.json",
  "https://cdnjs.cloudflare.com/ajax/libs/fuse.js/7.0.0/fuse.min.js"
];
// The real, approved knowledge.json doesn't exist yet in this sample build;
// caching it is best-effort (see fetch handler below), not part of install.

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.all(
        SHELL_URLS.map(function (url) {
          return cache.add(url).catch(function () { /* one missing asset shouldn't fail install */ });
        })
      );
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  var url = event.request.url;

  // knowledge.json (the real, approved file, once it exists) and
  // knowledge.sample.json: try the network first so a refresh always
  // picks up new content when online, falling back to the cache offline.
  if (url.indexOf("/knowledge/") !== -1 && url.indexOf(".json") !== -1) {
    event.respondWith(
      fetch(event.request).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return res;
      }).catch(function () { return caches.match(event.request); })
    );
    return;
  }

  // Everything else (the app shell, Fuse.js): cache first, network fallback.
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return res;
      });
    })
  );
});
