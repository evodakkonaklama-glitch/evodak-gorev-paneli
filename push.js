// Bildirim aboneliği: izin, service worker, cihaz kaydı, test bildirimi
import { supabase } from './supabase.js';
import { CONFIG } from './config.js';

let swReg = null;

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * Bu cihazın bildirim durumu:
 * 'ios-install' – iPhone'da önce Ana Ekrana eklenmeli
 * 'unsupported' – tarayıcı desteklemiyor
 * 'no-key'      – config.js'te VAPID anahtarı yok
 * 'denied'      – kullanıcı izni reddetmiş
 * 'default'     – henüz sorulmamış
 * 'granted'     – izin var (abonelik ayrıca kontrol edilir)
 */
export function pushState() {
  if (isIOS() && !isStandalone()) return 'ios-install';
  if (!supported()) return 'unsupported';
  if (!CONFIG.VAPID_PUBLIC_KEY) return 'no-key';
  return Notification.permission;
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    swReg = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    swReg.update().catch(() => {});
    return swReg;
  } catch (err) {
    console.warn('Service worker kaydedilemedi', err);
    return null;
  }
}

async function getReg() {
  if (swReg) return swReg;
  return (await registerServiceWorker()) || navigator.serviceWorker.ready;
}

function urlB64ToUint8Array(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function sameKey(sub) {
  const k = sub?.options?.applicationServerKey;
  if (!k) return true;
  const a = new Uint8Array(k); const b = urlB64ToUint8Array(CONFIG.VAPID_PUBLIC_KEY);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function deviceName() {
  const ua = navigator.userAgent;
  const os = /iphone/i.test(ua) ? 'iPhone' : /ipad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
    : /android/i.test(ua) ? 'Android' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'Mac' : /linux/i.test(ua) ? 'Linux' : 'Cihaz';
  const br = /edg\//i.test(ua) ? 'Edge' : /opr\//i.test(ua) ? 'Opera' : /firefox/i.test(ua) ? 'Firefox'
    : /crios|chrome/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : '';
  return isStandalone() ? `${os} (uygulama)` : [os, br].filter(Boolean).join(' · ');
}

async function saveSubscription(sub) {
  const j = sub.toJSON();
  const { error } = await supabase.rpc('register_push', {
    p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth,
    p_device: deviceName(), p_ua: navigator.userAgent.slice(0, 300),
  });
  if (error) throw error;
}

// Kullanıcı düğmeye bastığında çağrılır (iOS izni yalnızca dokunuşla sorar)
export async function enablePush() {
  const state = pushState();
  if (state === 'ios-install' || state === 'unsupported' || state === 'no-key') return { ok: false, reason: state };
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { ok: false, reason: permission };
  const reg = await getReg();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub)) { await sub.unsubscribe(); sub = null; }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(CONFIG.VAPID_PUBLIC_KEY) });
  }
  await saveSubscription(sub);
  return { ok: true, endpoint: sub.endpoint };
}

// Uygulama her açıldığında: izin varsa aboneliği tazele (sessiz)
export async function syncSubscription() {
  try {
    if (pushState() !== 'granted') return null;
    const reg = await getReg();
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub)) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(CONFIG.VAPID_PUBLIC_KEY) });
    await saveSubscription(sub);
    return sub.endpoint;
  } catch (err) {
    console.warn('Bildirim aboneliği tazelenemedi', err);
    return null;
  }
}

export async function currentEndpoint() {
  try {
    if (!supported()) return null;
    const reg = await navigator.serviceWorker.getRegistration('./');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub ? sub.endpoint : null;
  } catch { return null; }
}

export async function disablePushHere() {
  const reg = await navigator.serviceWorker.getRegistration('./');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
}

export async function sendTestNotification() {
  const { data, error } = await supabase.functions.invoke('send-reminders', { body: { mode: 'test' } });
  if (error) throw error;
  return data;
}
