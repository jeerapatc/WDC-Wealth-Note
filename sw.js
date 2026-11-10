// Service worker: เปิดแอปได้แม้ไม่มีเน็ต (ลองโหลดใหม่ก่อน ถ้าไม่ได้ใช้ของที่เก็บไว้)
const CACHE = 'wealth-note-v5';
const ASSETS = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'assets/logo_teal.png', 'assets/icon-180.png', 'assets/icon-192.png', 'assets/icon-512.png',
  'fonts/noto-sans-thai-thai-400-normal.woff2', 'fonts/noto-sans-thai-thai-600-normal.woff2',
  'fonts/noto-sans-thai-latin-400-normal.woff2', 'fonts/noto-sans-thai-latin-600-normal.woff2'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('index.html')))
  );
});
