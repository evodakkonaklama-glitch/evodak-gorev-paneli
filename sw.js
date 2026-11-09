// Evodak Görev Paneli – Service Worker
// Görevi: uygulama kapalıyken gelen bildirimi göstermek, bildirim düğmelerini
// (Tamamlandı / 10 dk ertele) oturum gerektirmeden çalıştırmak ve bildirime
// dokununca paneli ilgili görevde açmak. (Çevrimdışı önbellek 6. aşamada eklenecek.)
const SW_VERSION = '2.0.1';
// Herkese açık panel anahtarı (config.js ile aynı; gizli değildir).
// Supabase işlev kapısı, bildirim düğmesi çağrısında bunu ister.
const PUBLIC_API_KEY = 'sb_publishable_eRXjy8MMFBk_k_AL1H4koQ_jHdJX9NU';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
  // Açık panel varsa yenilensin
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
