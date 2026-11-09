// Ayarlar > Kişiler (owner/admin): kişi ekleme (geçici şifre), rol, yalnızca kendi görevleri,
// şifre belirleme, pasif/aktif yapma. Hesap işlemleri sunucudaki manage-users fonksiyonuyla yapılır.
import { h, icon, toast, clear, confirmDialog } from './ui.js';
import { t, getLang } from './i18n.js';
import { label } from './excel-format.js';
import { supabase } from './supabase.js';
import { reloadAll } from './store.js';

export async function callFn(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return data || {};
  try { const j = await error.context.json(); if (j) return j; } catch { /* gövde yok */ }
  return { ok: false, error: navigator.onLine ? 'server_error' : 'offline' };
}

const ROLES = ['owner', 'admin', 'member', 'viewer'];

export function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz';
  const r = crypto.getRandomValues(new Uint32Array(8));
  const word = [...r.slice(0, 5)].map((x) => abc[x % abc.length]).join('');
  const num = String(r[5] % 9000 + 1000);
  return `${word[0].toUpperCase()}${word.slice(1)}-${num}`;
}

function errText(code) {
  const k = `people.err_${code}`;
  const v = t(k);
  return v === k ? t('people.err_server_error') : v;
}

// Kişiye iletilecek giriş bilgisi
function credentialsDialog(name, email, password) {
  const text = `${t('people.cred_intro', { name })}\n${t('people.cred_site')}: ${location.origin}${location.pathname}\n${t('settings.email')}: ${email}\n${t('people.temp_password')}: ${password}\n${t('people.cred_change')}`;
  const copy = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
    try { await navigator.clipboard.writeText(text); toast(t('people.copied'), { type: 'ok' }); } catch { toast(t('people.copy_failed'), { type: 'error' }); }
  } }, icon('copy'), t('people.copy'));
  const dlg = h('dialog', { class: 'dialog dialog-wide' },
    h('h2', { class: 'h2' }, t('people.cred_title')),
    h('p', { class: 'muted small' }, t('people.cred_help')),
    h('pre', { class: 'cred-box' }, text),
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('common.close')), copy));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

function personDialog(ctx, onDone) {
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const name = h('input', { class: 'input', id: 'pp-name', required: true, autocomplete: 'off' });
  const email = h('input', { class: 'input', id: 'pp-email', type: 'email', required: true, autocomplete: 'off' });
  const role = h('select', { class: 'input', id: 'pp-role' },
    ROLES.filter((r) => r !== 'owner' || ctx.profile.role === 'owner')
      .map((r) => h('option', { value: r, selected: r === 'member' }, label('role', r, getLang()))));
  const lang = h('select', { class: 'input', id: 'pp-lang' }, h('option', { value: 'tr' }, 'Türkçe'), h('option', { value: 'en' }, 'English'));
  const own = h('input', { type: 'checkbox', id: 'pp-own' });
  const pw = h('input', { class: 'input mono', id: 'pp-pw', value: tempPassword(), minlength: 8, autocomplete: 'off' });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, t('people.add'));
  const form = h('form', { class: 'form', novalidate: true },
    h('h2', { class: 'h2' }, t('people.add_title')),
    h('div', { class: 'field' }, h('label', { for: 'pp-name' }, t('people.name')), name),
    h('div', { class: 'field' }, h('label', { for: 'pp-email' }, t('settings.email')), email),
    h('div', { class: 'grid-2' },
      h('div', { class: 'field' }, h('label', { for: 'pp-role' }, t('settings.role')), role),
      h('div', { class: 'field' }, h('label', { for: 'pp-lang' }, t('settings.language')), lang)),
    h('label', { class: 'check' }, own, t('people.only_own')),
    h('p', { class: 'muted small' }, t('people.roles_help')),
    h('div', { class: 'field' }, h('label', { for: 'pp-pw' }, t('people.temp_password')),
      h('div', { class: 'row-gap' }, pw, h('button', { class: 'btn', type: 'button', title: t('people.generate'), onclick: () => { pw.value = tempPassword(); } }, icon('refresh')))),
    msg,
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('common.cancel')), btn));
  const dlg = h('dialog', { class: 'dialog dialog-wide' }, form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const setMsg = (x) => { msg.textContent = x; msg.className = 'form-msg form-msg-error'; };
    if (!name.value.trim()) return setMsg(t('people.err_name_required'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) return setMsg(t('people.err_email_invalid'));
    if (pw.value.length < 8) return setMsg(t('people.err_password_short'));
    btn.disabled = true; msg.textContent = '';
    const r = await callFn('manage-users', {
      action: 'create', full_name: name.value.trim(), email: email.value.trim(), password: pw.value,
      role: role.value, language: lang.value, only_own_tasks: own.checked,
    });
    btn.disabled = false;
    if (!r.ok) return setMsg(errText(r.error));
    dlg.close();
    toast(t('people.added', { name: name.value.trim() }), { type: 'ok' });
    credentialsDialog(name.value.trim(), email.value.trim().toLowerCase(), pw.value);
    onDone();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  name.focus();
}

function passwordDialog(p, onDone) {
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const pw = h('input', { class: 'input mono', id: 'sp-pw', value: tempPassword(), minlength: 8, autocomplete: 'off' });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, t('people.set_password'));
  const form = h('form', { class: 'form', novalidate: true },
    h('h2', { class: 'h2' }, p.user_id ? t('people.reset_title', { name: p.full_name }) : t('people.open_account_title', { name: p.full_name })),
    h('p', { class: 'muted small' }, p.user_id ? t('people.reset_help') : t('people.open_account_help')),
    h('div', { class: 'field' }, h('label', { for: 'sp-pw' }, t('people.temp_password')),
      h('div', { class: 'row-gap' }, pw, h('button', { class: 'btn', type: 'button', title: t('people.generate'), onclick: () => { pw.value = tempPassword(); } }, icon('refresh')))),
    msg,
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('common.cancel')), btn));
  const dlg = h('dialog', { class: 'dialog' }, form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pw.value.length < 8) { msg.textContent = t('people.err_password_short'); msg.className = 'form-msg form-msg-error'; return; }
    btn.disabled = true;
    const r = await callFn('manage-users', { action: 'set_password', profile_id: p.id, password: pw.value });
    btn.disabled = false;
    if (!r.ok) { msg.textContent = errText(r.error); msg.className = 'form-msg form-msg-error'; return; }
    dlg.close();
    credentialsDialog(p.full_name, p.email, pw.value);
    onDone();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

export function peopleCard(ctx) {
  const me = ctx.profile;
  const list = h('div', { class: 'people-list' });
  const card = h('div', { class: 'card', id: 'people' },
    h('div', { class: 'card-head' },
      h('h2', { class: 'h2' }, t('people.title')),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => personDialog(ctx, load) }, icon('plus'), t('people.add'))),
    h('p', { class: 'muted small' }, t('people.help')),
    list);

  const canTouch = (p) => p.role !== 'owner' || me.role === 'owner';

  async function update(p, patch, el) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', p.id);
    if (error) {
      toast(/owner/i.test(error.message) ? t('people.err_last_owner') : t('people.err_server_error'), { type: 'error' });
      load(); return;
    }
    Object.assign(p, patch);
    toast(t('people.saved'), { type: 'ok' });
    reloadAll();
    if (el) el.blur();
  }

  function row(p) {
    const self = p.id === me.id;
    const editable = canTouch(p);
    const status = !p.user_id ? ['muted', t('people.no_account')] : p.active ? ['ok', t('people.active')] : ['off', t('people.inactive')];
    const role = h('select', { class: 'input input-sm', 'aria-label': `${t('settings.role')}: ${p.full_name}`, disabled: !editable || self },
      ROLES.filter((r) => r !== 'owner' || me.role === 'owner').concat(p.role === 'owner' && me.role !== 'owner' ? ['owner'] : [])
        .map((r) => h('option', { value: r, selected: r === p.role }, label('role', r, getLang()))));
    role.addEventListener('change', () => update(p, { role: role.value }, role));
    const own = h('input', { type: 'checkbox', checked: p.only_own_tasks, disabled: !editable || ['owner', 'admin'].includes(p.role) });
    own.addEventListener('change', () => update(p, { only_own_tasks: own.checked }));
    const actions = h('div', { class: 'people-actions' },
      editable && p.email && !self ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => passwordDialog(p, load) },
        icon('key'), p.user_id ? t('people.reset_btn') : t('people.open_account_btn')) : null,
      editable && !self && p.user_id ? h('button', { class: `btn btn-sm ${p.active ? 'btn-danger-outline' : ''}`, type: 'button', onclick: async () => {
        if (p.active && !(await confirmDialog(t('people.deactivate_confirm', { name: p.full_name }), { confirmLabel: t('people.deactivate'), danger: true }))) return;
        const r = await callFn('manage-users', { action: 'set_active', profile_id: p.id, active: !p.active });
        if (!r.ok) { toast(errText(r.error), { type: 'error' }); return; }
        toast(p.active ? t('people.deactivated', { name: p.full_name }) : t('people.activated', { name: p.full_name }), { type: 'ok' });
        load(); reloadAll();
      } }, p.active ? t('people.deactivate') : t('people.activate')) : null);
    return h('div', { class: `person-row ${p.active ? '' : 'is-inactive'}` },
      h('div', { class: 'person-main' },
        h('div', { class: 'person-name' }, p.full_name, self ? h('span', { class: 'chip' }, t('people.you')) : null),
        h('div', { class: 'muted small' }, p.email || t('people.no_email')),
        h('span', { class: `pill pill-${status[0]}` }, status[1])),
      h('div', { class: 'person-fields' },
        h('label', { class: 'small' }, h('span', { class: 'muted' }, t('settings.role')), role),
        h('label', { class: 'check small' }, own, t('people.only_own_short'))),
      actions);
  }

  async function load() {
    clear(list).append(h('p', { class: 'muted' }, t('app.loading')));
    const { data, error } = await supabase.from('profiles')
      .select('id,user_id,full_name,email,role,active,only_own_tasks').order('full_name');
    if (error) { clear(list).append(h('p', { class: 'form-msg form-msg-error' }, t('people.err_server_error'))); return; }
    const order = { owner: 0, admin: 1, member: 2, viewer: 3 };
    data.sort((a, b) => (b.active - a.active) || (order[a.role] - order[b.role]) || a.full_name.localeCompare(b.full_name, 'tr'));
    clear(list).append(...data.map(row));
  }
  load();
  return card;
}
