// Ayarlar – 1. aşama: profil, dil, şifre değiştirme, Excel içe aktarma bağlantısı, çıkış
import { h, icon, toast } from './ui.js';
import { t, getLang } from './i18n.js';
import { label } from './excel-format.js';
import { supabase, friendlyError } from './supabase.js';
import { switchLang, logout } from './main.js';

function passwordCard() {
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const p1 = h('input', { id: 'pw1', class: 'input', type: 'password', autocomplete: 'new-password', minlength: 8 });
  const p2 = h('input', { id: 'pw2', class: 'input', type: 'password', autocomplete: 'new-password', minlength: 8 });
  const btn = h('button', { class: 'btn', type: 'submit' }, t('login.new_password_save'));
  const form = h('form', { class: 'form', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'pw1' }, t('login.new_password')), p1),
    h('div', { class: 'field' }, h('label', { for: 'pw2' }, t('login.new_password2')), p2),
    msg, h('div', {}, btn));
  const setMsg = (text) => { msg.textContent = text; msg.className = `form-msg ${text ? 'form-msg-error' : ''}`; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (p1.value.length < 8) { setMsg(t('login.password_short')); return; }
    if (p1.value !== p2.value) { setMsg(t('login.password_mismatch')); return; }
    btn.disabled = true; setMsg('');
    const { error } = await supabase.auth.updateUser({ password: p1.value });
    btn.disabled = false;
    if (error) { setMsg(friendlyError(error)); return; }
    p1.value = ''; p2.value = '';
    toast(t('login.password_saved'), { type: 'ok' });
  });
  return h('div', { class: 'card' },
    h('h2', { class: 'h2' }, t('settings.password')),
    h('p', { class: 'muted small' }, t('settings.password_help')),
    form);
}

export async function render(root, ctx) {
  const p = ctx.profile;
  const langSel = h('select', { id: 'set-lang', class: 'input' },
    h('option', { value: 'tr', selected: getLang() === 'tr' }, 'Türkçe'),
    h('option', { value: 'en', selected: getLang() === 'en' }, 'English'));
  langSel.addEventListener('change', () => switchLang(langSel.value));

  root.append(h('section', { class: 'page page-narrow' },
    h('h1', { class: 'h1' }, t('settings.title')),
    h('div', { class: 'card' },
      h('h2', { class: 'h2' }, t('settings.profile')),
      h('dl', { class: 'meta' },
        h('dt', {}, t('settings.name')), h('dd', {}, p.full_name),
        h('dt', {}, t('settings.email')), h('dd', {}, p.email || '—'),
        h('dt', {}, t('settings.role')), h('dd', {}, label('role', p.role, getLang()))),
      h('div', { class: 'field', style: 'margin-top:14px' }, h('label', { for: 'set-lang' }, t('settings.language')), langSel)),
    passwordCard(),
    ctx.isAdmin ? h('div', { class: 'card' },
      h('h2', { class: 'h2' }, t('settings.data')),
      h('a', { class: 'btn', href: '#/ice-aktar' }, icon('upload'), t('settings.import_excel'))) : null,
    h('p', { class: 'muted small' }, t('settings.more_soon')),
    h('button', { class: 'btn btn-danger-outline', type: 'button', onclick: logout }, icon('logout'), t('settings.logout'))));
  return null;
}
