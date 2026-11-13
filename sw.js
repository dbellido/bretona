// BRETONA service worker: la app abre sin conexión. Los datos los sincroniza Firestore.
const VERSION = "bretona-v11";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./core.js", "./gastos.js", "./viajes.js", "./calendario.js", "./citas.js", "./cupones.js", "./feed.js", "./tareas.js", "./pisos.js", "./menu.js", "./viajes-correo.js", "./leche.js", "./firebase-config.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cacheable = sameOrigin || url.hostname === "www.gstatic.com" || url.hostname.endsWith("fonts.googleapis.com") || url.hostname.endsWith("fonts.gstatic.com");
  if (!cacheable) return; // Firestore, Auth y Gemini van siempre por red.

  // Red primero para la app (así ves las actualizaciones), caché si no hay conexión.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: sameOrigin }).then((r) => r || caches.match("./index.html")))
  );
});
