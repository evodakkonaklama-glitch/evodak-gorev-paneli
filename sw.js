// Evodak Görev Paneli – Service Worker
// 1) Uygulama kapalıyken gelen bildirimi gösterir, bildirim düğmelerini oturumsuz çalıştırır,
//    bildirime dokununca paneli ilgili görevde açar.
// 2) Uygulama dosyalarını önbelleğe alır: internet yokken de panel açılır (veriler IndexedDB'den).
const SW_VERSION = '3.0.0';
const CACHE = `evodak-${SW_VERSION}`;
// Herkese açık panel anahtarı (config.js ile aynı; gizli değildir).
// Supabase işlev kapısı, bildirim düğmesi çağrısında bunu ister.
const PUBLIC_API_KEY = 'sb_publishable_eRXjy8MMFBk_k_AL1H4koQ_jHdJX9NU';
const SHELL = [
  './', './index.html', './styles.css', './config.js', './i18n.js', './main.js', './supabase.js', './ui.js', './dates.js',
  './excel-format.js', './login.js', './tasks.js', './task-detail.js', './import.js', './settings.js', './push.js',
  './notify-ui.js', './store.js', './idb.js', './manifest.webmanifest', './icon-192.png', './badge-96.png', './xlsx.full.min.js',
];
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('evodak-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // Önce ağ (her zaman en yeni sürüm), yoksa önbellek
    event.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(async () => (await caches.match(req, { ignoreSearch: true }))
      || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
  } else if (CDN.test(req.url)) {
    // Kütüphane ve yazı tipleri: önce önbellek
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
  // Supabase istekleri önbelleğe alınmaz
});

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: 'Evodak', body: event.data ? event.data.text() : '' }; }
  const options = {
    body: d.body || '',
    tag: d.tag || undefined,
    renotify: Boolean(d.tag),
    icon: 'icon-192.png',
    badge: 'badge-96.png',
    timestamp: Date.now(),
    data: { url: d.url || self.registration.scope, token: d.token, actionUrl: d.actionUrl, lang: d.lang || 'tr' },
    actions: Array.isArray(d.actions) ? d.actions.slice(0, 2) : [],
  };
  event.waitUntil(self.registration.showNotification(d.title || 'Evodak', options));
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const data = n.data || {};
  n.close();
  if ((event.action === 'done' || event.action === 'snooze') && data.token && data.actionUrl) {
    event.waitUntil(runAction(event.action, data, n.tag));
    return;
  }
  event.waitUntil(openPanel(data.url || self.registration.scope));
});

async function runAction(action, data, tag) {
  const tr = data.lang !== 'en';
  let result = {};
  try {
    const res = await fetch(data.actionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: PUBLIC_API_KEY },
      body: JSON.stringify({ token: data.token, action }),
    });
    result = await res.json().catch(() => ({}));
  } catch {
    result = { ok: false, error: 'network' };
  }
  let body;
  if (result.ok) {
    body = action === 'done'
      ? (tr ? 'Tamamlandı olarak işaretlendi ✓' : 'Marked as done ✓')
      : (tr ? '10 dakika sonra tekrar hatırlatılacak' : 'You will be reminded again in 10 minutes');
  } else if (result.error === 'used') {
    body = tr ? 'Bu bildirim için işlem zaten yapıldı' : 'This action was already used';
  } else {
    body = tr ? 'İşlem yapılamadı. Dokunup paneli açın.' : 'Could not complete. Tap to open the panel.';
  }
  await self.registration.showNotification(result.title || 'Evodak', {
    body, tag: tag || undefined, icon: 'icon-192.png', badge: 'badge-96.png', silent: true,
    data: { url: data.url, lang: data.lang },
  });
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  all.forEach((c) => c.postMessage({ type: 'refresh' }));
}

async function openPanel(url) {
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of all) {
    if (c.url.startsWith(self.registration.scope)) {
      c.postMessage({ type: 'open', url });
      return c.focus();
    }
  }
  return self.clients.openWindow(url);
}

self.addEventListener('message', (event) => {
  if (event.data === 'version') event.source?.postMessage({ type: 'version', version: SW_VERSION });
});
