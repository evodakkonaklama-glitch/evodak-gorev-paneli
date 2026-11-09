// Bildirim arayüzü: ilk giriş ekranı, iPhone kurulum rehberi, Ayarlar > Bildirimler, zil (bildirim merkezi)
import { h, clear, icon, toast } from './ui.js';
import { t } from './i18n.js';
import { supabase, friendlyError } from './supabase.js';
import { pushState, enablePush, disablePushHere, currentEndpoint, sendTestNotification, isIOS } from './push.js';
import { fmtDateTime } from './dates.js';

const DISMISS_KEY = 'evodak.pushPromptDismissed';

// ---------------------------------------------------------------- iPhone rehberi
function shareIcon() {
  const s = document.createElement('span');
  s.className = 'ios-icon'; s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#0a84ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/></svg>';
  return s;
}
function addIcon() {
  const s = document.createElement('span');
  s.className = 'ios-icon'; s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#1a2433" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>';
  return s;
}

export function iosGuide() {
  const step = (n, title, visual) => h('li', { class: 'ios-step' },
    h('span', { class: 'ios-num' }, String(n)),
    h('div', {}, h('p', { class: 'ios-step-title' }, title), visual));
  return h('div', { class: 'ios-guide' },
    h('p', {}, t('push.ios_intro')),
    h('ol', { class: 'ios-steps' },
      step(1, t('push.ios_step1'), h('div', { class: 'ios-visual ios-bar' }, h('span', { class: 'ios-url' }, 'evodakkonaklama-glitch.github.io'), shareIcon())),
      step(2, t('push.ios_step2'), h('div', { class: 'ios-visual ios-menu' },
        h('div', { class: 'ios-menu-row muted' }, t('push.ios_menu_copy')),
        h('div', { class: 'ios-menu-row ios-menu-hl' }, h('span', {}, t('push.ios_menu_add')), addIcon()),
        h('div', { class: 'ios-menu-row muted' }, t('push.ios_menu_bookmark')))),
      step(3, t('push.ios_step3'), h('div', { class: 'ios-visual ios-add' },
        h('span', { class: 'muted' }, t('common.cancel')), h('strong', {}, t('push.ios_add_title')), h('span', { class: 'ios-blue' }, t('push.ios_add_btn')))),
      step(4, t('push.ios_step4'), h('div', { class: 'ios-visual ios-home' }, h('span', { class: 'logo-mark' }, 'E'), h('span', { class: 'small' }, 'Evodak')))),
    h('p', { class: 'muted small' }, t('push.ios_note')));
}

// ---------------------------------------------------------------- ilk giriş ekranı
export function maybeShowPushPrompt() {
  const state = pushState();
  if (state !== 'default' && state !== 'ios-install') return;
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (Date.now() - at < 7 * 86400000) return;
  } catch { /* yok say */ }

  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const dlg = h('dialog', { class: 'dialog dialog-wide' });
  const later = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* yok say */ } dlg.close(); };
  const body = state === 'ios-install'
    ? [iosGuide(), h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-primary', type: 'button', onclick: later }, t('push.ok_later')))]
    : [h('p', {}, t('push.prompt_body')), msg,
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn', type: 'button', onclick: later }, t('push.later')),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
          e.target.disabled = true;
          try {
            const r = await enablePush();
            if (r.ok) { toast(t('push.enabled'), { type: 'ok' }); dlg.close(); }
            else { msg.textContent = t(`push.reason.${r.reason}`); msg.className = 'form-msg form-msg-error'; e.target.disabled = false; }
          } catch (err) { msg.textContent = friendlyError(err); msg.className = 'form-msg form-msg-error'; e.target.disabled = false; }
        } }, icon('bell'), t('push.enable')))];
  dlg.append(h('div', { class: 'dialog-head' }, icon('bell', 'icon-lg tone-amber-text'), h('h2', { class: 'h2' }, t('push.prompt_title'))), ...body);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ---------------------------------------------------------------- Ayarlar > Bildirimler
export function notificationsCard(ctx) {
  const card = h('div', { class: 'card' });
  const p = ctx.profile;

  async function save(patch) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id);
    if (error) { toast(friendlyError(error), { type: 'error' }); return; }
    Object.assign(p, patch);
    toast(t('settings.saved'), { type: 'ok', timeout: 1500 });
  }

  async function draw() {
    const state = pushState();
    const here = await currentEndpoint();
    const { data: devices } = await supabase.from('push_subscriptions')
      .select('id,endpoint,device_name,created_at,last_success_at').eq('profile_id', p.id).order('created_at');
    const hereActive = here && (devices || []).some((d) => d.endpoint === here);

    const statusText = state === 'granted' && hereActive ? t('push.status_on')
      : state === 'denied' ? t('push.status_denied')
        : state === 'ios-install' ? t('push.status_ios')
          : state === 'unsupported' ? t('push.status_unsupported')
            : state === 'no-key' ? t('push.status_nokey') : t('push.status_off');
    const tone = state === 'granted' && hereActive ? 'ok' : state === 'default' ? 'warn' : 'error';

    const testOut = h('div', { class: 'test-out', 'aria-live': 'polite' });
    const actions = h('div', { class: 'row-wrap' });
    if (state === 'default' || (state === 'granted' && !hereActive)) {
      actions.append(h('button', { class: 'btn btn-primary', type: 'button', onclick: async (e) => {
        e.target.disabled = true;
        try {
          const r = await enablePush();
          if (r.ok) toast(t('push.enabled'), { type: 'ok' }); else toast(t(`push.reason.${r.reason}`), { type: 'error' });
        } catch (err) { toast(friendlyError(err), { type: 'error' }); }
        draw();
      } }, icon('bell'), t('push.enable_here')));
    }
    if (hereActive) {
      actions.append(h('button', { class: 'btn', type: 'button', onclick: async () => { await disablePushHere(); draw(); } }, t('push.disable_here')));
    }
    actions.append(h('button', { class: 'btn', type: 'button', onclick: async (e) => {
      e.target.disabled = true; clear(testOut).append(h('p', { class: 'muted' }, t('push.test_sending')));
      try {
        const r = await sendTestNotification();
        clear(testOut);
        const list = h('ul', { class: 'test-list' });
        (r.devices || []).forEach((d) => list.append(h('li', { class: d.ok ? 'ok' : 'bad' }, icon(d.ok ? 'check' : 'x'),
          `${d.device || '?'}: ${d.ok ? t('push.test_ok') : `${t('push.test_fail')} (${d.status}${d.error ? ` ${d.error.slice(0, 80)}` : ''})`}`)));
        if (!(r.devices || []).length) list.append(h('li', { class: 'bad' }, icon('x'), t('push.test_no_devices')));
        testOut.append(list);
      } catch (err) { clear(testOut).append(h('p', { class: 'form-msg-error' }, friendlyError(err))); }
      e.target.disabled = false;
    } }, t('push.test')));

    const devList = h('ul', { class: 'device-list' });
    (devices || []).forEach((d) => devList.append(h('li', {},
      h('div', {}, h('strong', {}, d.device_name || '—'), d.endpoint === here ? h('span', { class: 'chip' }, t('push.this_device')) : null,
        h('div', { class: 'muted small' }, d.last_success_at ? t('push.last_ok', { when: fmtDateTime(d.last_success_at) }) : t('push.added', { when: fmtDateTime(d.created_at) }))),
      h('button', { class: 'btn btn-link', type: 'button', onclick: async () => {
        await supabase.from('push_subscriptions').delete().eq('id', d.id); draw();
      } }, t('push.remove')))));
    if (!(devices || []).length) devList.append(h('li', { class: 'muted' }, t('push.no_devices')));

    const timeInput = (id, val, field) => {
      const el = h('input', { type: 'time', id, class: 'input input-time', value: (val || '').slice(0, 5) });
      el.addEventListener('change', () => save({ [field]: el.value || null }));
      return el;
    };

    clear(card).append(...[
      h('h2', { class: 'h2' }, t('push.title')),
      h('div', { class: `notice notice-${tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'error'}` },
        icon(tone === 'ok' ? 'check' : 'alert'), h('p', {}, statusText)),
      state === 'ios-install' ? h('details', { class: 'details' }, h('summary', {}, t('push.ios_how')), h('div', { class: 'pad' }, iosGuide())) : null,
      state === 'denied' ? h('p', { class: 'muted small' }, isIOS() ? t('push.denied_help_ios') : t('push.denied_help')) : null,
      actions, testOut,
      h('h3', { class: 'h3 mt' }, t('push.devices')), devList,
      h('h3', { class: 'h3 mt' }, t('push.prefs')),
      h('div', { class: 'grid-3' },
        h('div', { class: 'field' }, h('label', { for: 'n-sum' }, t('push.summary_time')), timeInput('n-sum', p.daily_summary_time, 'daily_summary_time')),
        h('div', { class: 'field' }, h('label', { for: 'n-qs' }, t('push.quiet_start')), timeInput('n-qs', p.quiet_hours_start, 'quiet_hours_start')),
        h('div', { class: 'field' }, h('label', { for: 'n-qe' }, t('push.quiet_end')), timeInput('n-qe', p.quiet_hours_end, 'quiet_hours_end'))),
      h('p', { class: 'muted small' }, t('push.quiet_note')),
    ].filter(Boolean));
  }

  card.append(h('p', { class: 'muted' }, t('app.loading')));
  draw();
  return card;
}

// ---------------------------------------------------------------- zil / bildirim merkezi
let channel = null;

export function bellButton(ctx, navigate) {
  const badge = h('span', { class: 'bell-badge', hidden: true });
  const btn = h('button', { class: 'icon-btn bell', type: 'button', 'aria-label': t('inbox.title'), 'aria-haspopup': 'dialog' }, icon('bell'), badge);
  const panel = h('div', { class: 'inbox-panel', hidden: true, role: 'dialog', 'aria-label': t('inbox.title') });

  async function refreshCount() {
    const { count } = await supabase.from('inbox').select('id', { count: 'exact', head: true })
      .eq('profile_id', ctx.profile.id).is('read_at', null);
    badge.hidden = !count;
    badge.textContent = count > 99 ? '99+' : String(count || '');
    btn.setAttribute('aria-label', count ? `${t('inbox.title')} (${count})` : t('inbox.title'));
  }

  async function openPanel() {
    panel.hidden = false;
    clear(panel).append(h('p', { class: 'muted pad' }, t('app.loading')));
    const { data, error } = await supabase.from('inbox').select('id,task_id,title,body,read_at,created_at,kind')
      .eq('profile_id', ctx.profile.id).order('created_at', { ascending: false }).limit(30);
    clear(panel);
    panel.append(h('div', { class: 'inbox-head' }, h('strong', {}, t('inbox.title')),
      h('button', { class: 'btn btn-link', type: 'button', onclick: async () => {
        await supabase.from('inbox').update({ read_at: new Date().toISOString() }).eq('profile_id', ctx.profile.id).is('read_at', null);
        refreshCount(); openPanel();
      } }, t('inbox.mark_all'))));
    if (error) { panel.append(h('p', { class: 'pad form-msg-error' }, friendlyError(error))); return; }
    if (!data.length) { panel.append(h('p', { class: 'pad muted' }, t('inbox.empty'))); return; }
    const list = h('ul', { class: 'inbox-list' });
    data.forEach((n) => list.append(h('li', { class: n.read_at ? '' : 'unread' },
      h('button', { type: 'button', onclick: async () => {
        if (!n.read_at) await supabase.from('inbox').update({ read_at: new Date().toISOString() }).eq('id', n.id);
        panel.hidden = true; refreshCount();
        if (n.task_id) navigate(`/gorev/${n.task_id}`);
        else navigate(n.kind === 'weekly_summary' ? '/haftalik' : n.kind === 'daily_summary' || n.kind === 'inactivity' ? '/bugun' : '/ayarlar');
      } }, h('span', { class: 'inbox-title' }, n.title), h('span', { class: 'muted small' }, n.body || ''),
        h('span', { class: 'muted small' }, fmtDateTime(n.created_at))))));
    panel.append(list);
  }

  btn.addEventListener('click', (e) => { e.stopPropagation(); if (panel.hidden) openPanel(); else panel.hidden = true; });
  document.addEventListener('click', (e) => { if (!panel.hidden && !panel.contains(e.target)) panel.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') panel.hidden = true; });

  refreshCount();
  if (!channel) {
    channel = supabase.channel(`inbox-${ctx.profile.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inbox', filter: `profile_id=eq.${ctx.profile.id}` }, (payload) => {
        document.dispatchEvent(new CustomEvent('evodak:inbox', { detail: payload.new }));
      })
      .subscribe();
  }
  const onNew = (e) => { refreshCount(); if (document.visibilityState === 'visible') toast(e.detail.title, { timeout: 5000 }); };
  document.addEventListener('evodak:inbox', onNew);

  return { el: h('div', { class: 'bell-wrap' }, btn, panel), destroy: () => document.removeEventListener('evodak:inbox', onNew) };
}

export function stopInboxChannel() {
  if (channel) { supabase.removeChannel(channel); channel = null; }
}
