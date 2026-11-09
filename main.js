// Uygulama girişi: oturum, yönlendirme (#/...), üst bar, bildirim kurulumu
import { supabase, configProblem, loadMyProfile, friendlyError } from './supabase.js';
import { t, getLang, setLang, onLangChange } from './i18n.js';
import { h, clear, icon, spinner, errorState, toast } from './ui.js';
import { renderLogin, renderNewPassword, renderConfigMissing } from './login.js';
import * as tasksView from './tasks.js';
import * as importView from './import.js';
import * as settingsView from './settings.js';
import { registerServiceWorker, syncSubscription } from './push.js';
import { bellButton, maybeShowPushPrompt, stopInboxChannel } from './notify-ui.js';

const main = document.getElementById('main');
const topbar = document.getElementById('topbar');

export const app = { session: null, profile: null, isAdmin: false, openTaskId: null };

const ROUTES = {
  '/gorevler': { view: tasksView, nav: 'nav.tasks', icon: 'list' },
  '/ice-aktar': { view: importView, nav: 'nav.import', icon: 'upload', admin: true },
  '/ayarlar': { view: settingsView, nav: 'nav.settings', icon: 'settings' },
};
const DEFAULT_ROUTE = '/gorevler';

let cleanup = null;
let started = false;
let bell = null;

// '#/gorev/<id>' -> görevler sayfası, ilgili görev açık
function parseRoute() {
  const p = location.hash.replace(/^#/, '').split('?')[0];
  const m = p.match(/^\/gorev\/([0-9a-f-]{36})$/i);
  if (m) return { path: '/gorevler', taskId: m[1] };
  return { path: ROUTES[p] ? p : DEFAULT_ROUTE, taskId: null };
}

export function navigate(path) {
  if (location.hash === `#${path}`) route(); else location.hash = `#${path}`;
}

async function route() {
  if (!app.profile) return;
  const { path, taskId } = parseRoute();
  const def = ROUTES[path];
  if (def.admin && !app.isAdmin) { navigate(DEFAULT_ROUTE); return; }
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  app.openTaskId = taskId;
  renderTopbar(path);
  clear(main);
  try {
    cleanup = await def.view.render(main, app);
  } catch (err) {
    console.error(err);
    clear(main).append(errorState(friendlyError(err), route));
  }
  document.title = `${t(def.nav)} · ${t('app.name')}`;
}

function renderTopbar(activePath) {
  topbar.hidden = false;
  const links = Object.entries(ROUTES)
    .filter(([, r]) => !r.admin || app.isAdmin)
    .map(([path, r]) => h('a', {
      href: `#${path}`, class: `nav-link ${path === activePath ? 'active' : ''}`,
      'aria-current': path === activePath ? 'page' : null,
    }, icon(r.icon), h('span', { class: 'nav-text' }, t(r.nav))));

  const langBtn = h('button', {
    class: 'icon-btn lang-btn', type: 'button', 'aria-label': `${t('nav.language')}: ${getLang() === 'tr' ? 'English' : 'Türkçe'}`,
    onclick: () => switchLang(getLang() === 'tr' ? 'en' : 'tr'),
  }, getLang() === 'tr' ? 'EN' : 'TR');

  const logoutBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('nav.logout'), title: t('nav.logout'), onclick: logout }, icon('logout'));

  if (!bell) bell = bellButton(app, navigate);

  clear(topbar).append(
    h('a', { class: 'brand', href: `#${DEFAULT_ROUTE}` }, h('span', { class: 'logo-mark' }, 'E'), h('span', { class: 'brand-text' }, t('app.name'))),
    h('nav', { class: 'nav', 'aria-label': t('app.name') }, links),
    h('div', { class: 'topbar-right' },
      h('span', { class: 'user-name' }, app.profile.full_name), bell.el, langBtn, logoutBtn));
}

export async function switchLang(lang) {
  setLang(lang);
  if (app.profile && app.profile.language !== lang) {
    app.profile.language = lang;
    const { error } = await supabase.from('profiles').update({ language: lang }).eq('id', app.profile.id);
    if (error) toast(friendlyError(error), { type: 'error' });
  }
}

export async function logout() {
  await supabase.auth.signOut();
}

async function startApp(session) {
  app.session = session;
  clear(main).append(spinner());
  let profile;
  try {
    profile = await loadMyProfile(session.user.id);
  } catch (err) {
    clear(main).append(errorState(friendlyError(err), () => startApp(session)));
    return;
  }
  if (!profile || !profile.active) {
    started = false;
    await supabase.auth.signOut();
    showLogin({ text: t('auth.no_profile'), type: 'error' });
    return;
  }
  app.profile = profile;
  app.isAdmin = ['owner', 'admin'].includes(profile.role);
  if (profile.language && profile.language !== getLang()) setLang(profile.language);
  supabase.rpc('touch_activity').then(({ error }) => { if (error) console.warn('touch_activity', error.message); });
  // Oturum belirteçleri adres çubuğunda kaldıysa temizle
  if (/access_token|type=|error/.test(location.hash) || location.search.includes('code=')) {
    history.replaceState(null, '', `${location.pathname}#${DEFAULT_ROUTE}`);
  }
  await route();
  syncSubscription();
  setTimeout(maybeShowPushPrompt, 600);
}

function showLogin(message) {
  app.session = null; app.profile = null; app.isAdmin = false;
  if (bell) { bell.destroy(); bell = null; }
  stopInboxChannel();
  topbar.hidden = true;
  clear(topbar);
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  renderLogin(main, { message });
  document.title = t('app.name');
}

function hashErrorMessage() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const code = params.get('error_code');
  if (!code) return null;
  history.replaceState(null, '', location.pathname);
  return { text: code === 'otp_expired' ? t('auth.link_expired') : (params.get('error_description') || code), type: 'error' };
}

// Service worker'dan gelen mesajlar: bildirime dokunuldu / bildirim düğmesiyle görev değişti
function listenServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', (e) => {
    const msg = e.data || {};
    if (msg.type === 'open' && msg.url) {
      const hash = msg.url.includes('#') ? msg.url.slice(msg.url.indexOf('#')) : `#${DEFAULT_ROUTE}`;
      if (location.hash === hash) route(); else location.hash = hash;
    } else if (msg.type === 'refresh' && app.profile) {
      route();
    }
  });
}

async function boot() {
  const problem = configProblem();
  if (problem) { renderConfigMissing(main, problem); return; }

  registerServiceWorker();
  listenServiceWorker();

  const recovering = /type=recovery/.test(location.hash);
  const linkError = hashErrorMessage();
  // Bildirimden açıldıysa girişten sonra o göreve dön
  const initialHash = /^#\/gorev\//.test(location.hash) ? location.hash : null;

  supabase.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') {
        renderNewPassword(main, () => { started = true; startApp(session); });
      } else if (event === 'SIGNED_OUT') {
        started = false; showLogin();
      } else if (event === 'SIGNED_IN' && session && !started && !recovering) {
        started = true;
        if (initialHash && location.hash !== initialHash) history.replaceState(null, '', `${location.pathname}${initialHash}`);
        startApp(session);
      }
    }, 0);
  });

  const { data: { session } } = await supabase.auth.getSession();
  if (recovering && session) {
    renderNewPassword(main, () => { started = true; startApp(session); });
  } else if (session) {
    if (!started) { started = true; startApp(session); }
  } else {
    showLogin(linkError);
  }

  window.addEventListener('hashchange', () => { if (app.profile) route(); });
  onLangChange(() => {
    if (app.profile) { if (bell) { bell.destroy(); bell = null; } route(); } else if (!app.session) showLogin();
  });
  window.addEventListener('offline', () => toast(t('app.offline'), { type: 'error' }));
}

boot();
