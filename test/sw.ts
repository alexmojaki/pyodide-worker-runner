import {serviceWorkerFetchListener} from "sync-message";

const fetchListener = serviceWorkerFetchListener();
declare var self: ServiceWorkerGlobalScope;

addEventListener("fetch", function (e: FetchEvent) {
  if (fetchListener(e)) {
    return;
  }
  e.respondWith(fetch(e.request));
});

addEventListener("install", function (e: FetchEvent) {
  e.waitUntil(self.skipWaiting());
});

addEventListener("activate", function (e: FetchEvent) {
  e.waitUntil(self.clients.claim());
});
