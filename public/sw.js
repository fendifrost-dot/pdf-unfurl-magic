/*
 * PDF Relief shell worker.
 * Caches the app shell, icons, fonts and the hashed build assets so an installed
 * PWA still opens with no network. PDF bytes are never stored — user files are
 * held in the tab, and any same-origin .pdf request is passed straight through.
 */
const CACHE = "pdf-relief-shell-v2";

/** Offline fallback for a navigation this worker has never seen before. */
const SHELL = "/";

/** Fetched at install time. Everything else fills in as it is used. */
const PRECACHE = [
  SHELL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/pdf.worker.min.mjs",
  "/pdf.worker.boot.mjs",
];

/**
 * Hashed build output. The filename changes whenever the bytes change, so a
 * cache hit is always current and cache-first is safe. There is no build-time
 * precache manifest (that needs a Vite plugin), so each asset is stored the
 * first time it is requested rather than at install.
 */
function isHashedAsset(pathname) {
  return pathname.startsWith("/assets/") || pathname.startsWith("/fonts/");
}

function isShellAsset(pathname) {
  return PRECACHE.includes(pathname) || pathname.startsWith("/icons/");
}

async function putInCache(key, response) {
  if (!response || !response.ok || response.type === "opaque") return;
  const cache = await caches.open(CACHE);
  await cache.put(key, response);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // One missing file must not fail the whole install, so add them singly.
      await Promise.all(
        PRECACHE.map((path) =>
          cache.add(new Request(path, { cache: "reload" })).catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // User PDFs are never stored, online or off.
  if (url.pathname.endsWith(".pdf")) return;

  if (request.mode === "navigate") {
    // Network first so server-rendered pages stay fresh. Every page that loads
    // online is kept, which is what gives the offline fallback something to
    // return — before this the fallback could never hit.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!url.search) void putInCache(url.pathname, response.clone());
          return response;
        })
        .catch(async () => {
          const exact = await caches.match(url.pathname);
          if (exact) return exact;
          const shell = await caches.match(SHELL);
          if (shell) return shell;
          return Response.error();
        }),
    );
    return;
  }

  if (isShellAsset(url.pathname) || isHashedAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          void putInCache(request, response.clone());
          return response;
        });
      }),
    );
  }
});
