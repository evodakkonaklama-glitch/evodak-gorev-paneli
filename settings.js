// Ayarlar: profil (dil, tema), bildirimler, şifre; owner/admin için kişiler, şablonlar, veri ve yedekler, dosya alanı
import { h, icon, toast } from './ui.js';
import { t, getLang } from './i18n.js';
import { label } from './excel-format.js';
import { supabase, friendlyError } from './supabase.js';
import { switchLang, logout, switchTheme, getTheme } from './main.js';
import { peopleCard } from './people.js';
import { templatesCard } from './templates.js';
import { dataCard } from './backups.js';
import { notificationsCard } from './notify-ui.js';
import { storageCard } from './files.js';

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

const SW_VERSION_LABEL = '6.0';

function aboutCard() {
  const btn = h('button', { class: 'btn btn-sm', type: 'button' }, icon('refresh'), t('about.check'));
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const reg = await navigator.serviceWorker?.getRegistration('./');
      await reg?.update();
      toast(reg?.installing || reg?.waiting ? t('app.update_ready') : t('about.latest'), { type: 'ok' });
    } catch { toast(t('about.latest'), { type: 'ok' }); }
    btn.disabled = false;
  });
  return h('div', { class: 'card' },
    h('h2', { class: 'h2' }, t('about.title')),
    h('p', { class: 'muted small' }, t('about.version', { v: SW_VERSION_LABEL })),
    h('p', { class: 'muted small' }, t('about.install')),
    btn);
}

export async function render(root, ctx) {
  const p = ctx.profile;
  const langSel = h('select', { id: 'set-lang', class: 'input' },
    h('option', { value: 'tr', selected: getLang() === 'tr' }, 'Türkçe'),
    h('option', { value: 'en', selected: getLang() === 'en' }, 'English'));
  langSel.addEventListener('change', () => switchLang(langSel.value));
  const themeSel = h('select', { id: 'set-theme', class: 'input' },
    ...['system', 'light', 'dark'].map((x) => h('option', { value: x, selected: getTheme() === x }, t(`theme.${x}`))));
  themeSel.addEventListener('change', () => switchTheme(themeSel.value));

  const jump = (id) => h('button', { class: 'chip chip-btn', type: 'button', onclick: () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, t(`settings.jump_${id}`));

  root.append(h('section', { class: 'page page-narrow' },
    h('h1', { class: 'h1' }, t('settings.title')),
    ctx.isAdmin ? h('nav', { class: 'jump', 'aria-label': t('settings.title') }, jump('profil'), jump('bildirim'), jump('people'), jump('sablonlar'), jump('veri')) : null,
    h('div', { class: 'card', id: 'profil' },
      h('h2', { class: 'h2' }, t('settings.profile')),
      h('dl', { class: 'meta' },
        h('dt', {}, t('settings.name')), h('dd', {}, p.full_name),
        h('dt', {}, t('settings.email')), h('dd', {}, p.email || '—'),
        h('dt', {}, t('settings.role')), h('dd', {}, label('role', p.role, getLang()))),
      h('div', { class: 'grid-2 mt' },
        h('div', { class: 'field' }, h('label', { for: 'set-lang' }, t('settings.language')), langSel),
        h('div', { class: 'field' }, h('label', { for: 'set-theme' }, t('theme.label')), themeSel))),
    h('div', { id: 'bildirim' }, notificationsCard(ctx)),
    passwordCard(),
    ctx.isAdmin ? peopleCard(ctx) : null,
    ctx.isAdmin ? templatesCard() : null,
    ctx.isAdmin ? dataCard(ctx) : null,
    ctx.isAdmin ? storageCard() : null,
    aboutCard(),
    h('button', { class: 'btn btn-danger-outline', type: 'button', onclick: logout }, icon('logout'), t('settings.logout'))));
  return null;
}
