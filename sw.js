// 个人工作台 Service Worker
// 职责：离线缓存壳 + 接收 Web Push 并展示（iOS 忽略 actions，正文必须自解释）+ 点击打开。
const CACHE = 'pwt-v1';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/supabase.js',
  './js/api.js',
  './js/auth.js',
  './js/push.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((res) => {
          if (new URL(request.url).origin === location.origin && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached || Response.error());
    })
  );
});

self.addEventListener('push', (e) => {
  let payload = { title: '个人工作台', body: '你有新的提醒', url: '/' };
  try {
    if (e.data) payload = Object.assign(payload, e.data.json());
  } catch (_) {}
  // iOS PWA Web Push 忽略 notification actions 按钮，所以信息必须写进 body 本身。
  e.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag || 'pwt',
      badge: './icons/icon.svg',
      data: { url: payload.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
