// アプリ本体をiPadに保存して、ネットがなくても開けるようにする。
// ※ 患者データはここではなく IndexedDB に入っている。
//
// ★ アプリを修正したら、必ず VERSION を変える（例 '1.0' → '1.1'）。
//   VERSION が変わると、iPadが新しい版に気づいて「新しい版があります」と表示する。
const VERSION = '1.0';
const CACHE = 'karte-' + VERSION;
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'body.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];

// 新しい版のファイルをまとめて取得（ブラウザのキャッシュは使わず必ず最新を取る）
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((u) => new Request(u, { cache: 'reload' })))));
  // ここでは切り替えない。画面の「今すぐ更新」を押したときに切り替える
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data === 'version' && e.source) e.source.postMessage({ type: 'version', version: VERSION });
});

// 保存しておいた版で表示する（ネットがなくても開ける・版が混ざらない）
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE)
      .then((c) => c.match(e.request, { ignoreSearch: true }))
      .then((hit) => hit || fetch(e.request))
  );
});
