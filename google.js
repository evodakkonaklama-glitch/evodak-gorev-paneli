// Ayarlar > Google Tasks: kişinin kendisine atanan açık görevleri Google Tasks'taki "Evodak Görevleri" listesine eşitlenir.
// Google'da tamamlanan görev panelde de tamamlanır. Eşitleme her 15 dakikada bir kendiliğinden yapılır.
import { h, icon, toast, clear, confirmDialog } from './ui.js';
import { t } from './i18n.js';
import { supabase } from './supabase.js';
import { fmtDateTime } from './dates.js';
import { callFn } from './people.js';
import { reloadAll } from './store.js';

function errText(code) {
  const c = String(code || '');
  if (c === 'not_configured') return t('gg.err_not_configured');
  if (c === 'reconnect') return t('gg.err_reconnect');
  if (c === 'scope_missing') return t('gg.err_scope');
  if (c === 'bad_state') return t('gg.err_state');
  if (c === 'access_denied') return t('gg.err_denied');
  return t('gg.err', { msg: c });
}

export function googleCard(ctx) {
  const body = h('div', { class: 'gg-body' });
  const card = h('div', { class: 'card', id: 'google' },
    h('h2', { class: 'h2' }, t('gg.title')),
    h('p', { class: 'muted small' }, t('gg.help')),
    body);

  async function connect(btn) {
    btn.disabled = true;
    const r = await callFn('google-tasks', { action: 'auth_url' });
    if (!r.ok) { btn.disabled = false; toast(errText(r.error), { type: 'error', timeout: 9000 }); return; }
    location.href = r.url;
  }

  async function draw() {
    clear(body).append(h('p', { class: 'muted small' }, t('app.loading')));
    const { data: c, error } = await supabase.from('google_connections').select('google_email,last_sync_at,last_error,synced_count').eq('profile_id', ctx.profile.id).maybeSingle();
    if (error) { clear(body).append(h('p', { class: 'muted small' }, t('gg.err_not_installed'))); return; }
    if (!c) {
      const btn = h('button', { class: 'btn btn-primary', type: 'button' }, icon('link'), t('gg.connect'));
      btn.addEventListener('click', () => connect(btn));
      clear(body).append(h('p', {}, t('gg.not_connected')), btn);
      return;
    }
    const syncBtn = h('button', { class: 'btn', type: 'button' }, icon('refresh'), t('gg.sync_now'));
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      const r = await callFn('google-tasks', { action: 'sync' });
      syncBtn.disabled = false;
      if (!r.ok) toast(errText(r.error), { type: 'error', timeout: 9000 });
      else { toast(t('gg.synced', { n: r.linked, done: r.completed_from_google }), { type: 'ok' }); if (r.completed_from_google) reloadAll(); }
      draw();
    });
    const disc = h('button', { class: 'btn btn-danger-outline', type: 'button' }, t('gg.disconnect'));
    disc.addEventListener('click', async () => {
      if (!(await confirmDialog(t('gg.disconnect_confirm'), { confirmLabel: t('gg.disconnect'), danger: true }))) return;
      const r = await callFn('google-tasks', { action: 'disconnect' });
      if (!r.ok) toast(errText(r.error), { type: 'error' }); else toast(t('gg.disconnected'), { type: 'ok' });
      draw();
    });
    clear(body).append(
      h('dl', { class: 'meta' },
        h('dt', {}, t('gg.account')), h('dd', {}, c.google_email || '—'),
        h('dt', {}, t('gg.last_sync')), h('dd', {}, c.last_sync_at ? fmtDateTime(c.last_sync_at) : '—'),
        h('dt', {}, t('gg.count')), h('dd', {}, String(c.synced_count ?? 0))),
      c.last_error ? h('p', { class: 'form-msg form-msg-error' }, errText(c.last_error)) : null,
      h('div', { class: 'row-gap mt' },
        c.last_error === 'reconnect' ? (() => { const b = h('button', { class: 'btn btn-primary', type: 'button' }, t('gg.reconnect')); b.addEventListener('click', () => connect(b)); return b; })() : syncBtn,
        disc));
  }

  // Google izin sayfasından dönüş (#/ayarlar?g_code=…&g_state=…)
  const q = new URLSearchParams((location.hash.split('?')[1]) || '');
  if (q.get('g_code') || q.get('g_error')) {
    history.replaceState(null, '', `${location.pathname}#/ayarlar`);
    if (q.get('g_error')) toast(errText(q.get('g_error')), { type: 'error', timeout: 9000 });
    else {
      clear(body).append(h('p', { class: 'muted' }, t('gg.finishing')));
      callFn('google-tasks', { action: 'exchange', code: q.get('g_code'), state: q.get('g_state') }).then((r) => {
        if (!r.ok) toast(errText(r.error), { type: 'error', timeout: 10000 });
        else toast(t('gg.connected', { n: r.linked ?? 0 }), { type: 'ok', timeout: 8000 });
        draw();
        setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
      });
      return card;
    }
  }
  draw();
  return card;
}
