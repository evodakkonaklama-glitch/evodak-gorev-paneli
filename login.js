// Giriş, şifremi unuttum, yeni şifre ve "yapılandırma eksik" ekranları
import { h, clear, icon, toast } from './ui.js';
import { t } from './i18n.js';
import { supabase, friendlyError } from './supabase.js';

function shell(...content) {
  return h('div', { class: 'auth-wrap' },
    h('div', { class: 'auth-card' },
      h('div', { class: 'auth-brand' }, h('div', { class: 'logo-mark' }, 'E'), h('span', {}, t('app.name'))),
      ...content));
}

function field(id, labelText, attrs) {
  return h('div', { class: 'field' }, h('label', { for: id }, labelText), h('input', { id, class: 'input', ...attrs }));
}

function messageBox() { return h('p', { class: 'form-msg', role: 'alert', 'aria-live': 'assertive' }); }

function setMsg(el, text, type = 'error') { el.textContent = text || ''; el.className = `form-msg ${text ? `form-msg-${type}` : ''}`; }

export function renderConfigMissing(root, problem) {
  clear(root).append(shell(
    h('div', { class: 'notice notice-warn' }, icon('alert'), h('div', {},
      h('h1', { class: 'h2' }, t('config.title')),
      h('p', {}, problem === 'invalid' ? t('config.invalid') : t('config.body'))))));
}

function googleLogo() {
  const span = document.createElement('span');
  span.className = 'g-logo'; span.setAttribute('aria-hidden', 'true');
  span.innerHTML = '<svg viewBox="0 0 48 48" width="18" height="18"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.5z"/></svg>';
  return span;
}

export function renderLogin(root, { message } = {}) {
  const msg = messageBox();
  const pw = h('input', { id: 'password', class: 'input', type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('login.submit'));
  const form = h('form', { class: 'form', novalidate: true },
    field('email', t('login.email'), { type: 'email', autocomplete: 'username', required: true, inputmode: 'email' }),
    h('div', { class: 'field' }, h('label', { for: 'password' }, t('login.password')), pw,
      h('label', { class: 'check' }, h('input', { type: 'checkbox', onchange: (e) => { pw.type = e.target.checked ? 'text' : 'password'; } }), t('login.show_password'))),
    msg, btn,
    h('button', { class: 'btn btn-link', type: 'button', onclick: () => renderForgot(root) }, t('login.forgot')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.querySelector('#email').value.trim();
    const password = pw.value;
    if (!email) { setMsg(msg, t('auth.email_required')); return; }
    btn.disabled = true; btn.textContent = t('login.submitting'); setMsg(msg, '');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // Başarılı girişte main.js oturum değişikliğini yakalar
    } catch (err) {
      setMsg(msg, friendlyError(err));
      btn.disabled = false; btn.textContent = t('login.submit');
    }
  });

  // Google ile giriş: yalnızca panelde kaydı olan e-posta adresleri girebilir (profil e-postayla eşleşir)
  const google = h('button', { class: 'btn btn-block btn-google', type: 'button', onclick: async () => {
    google.disabled = true; setMsg(msg, '');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}${location.pathname}`, queryParams: { prompt: 'select_account' } },
    });
    if (error) { google.disabled = false; setMsg(msg, /provider is not enabled|Unsupported provider/i.test(error.message) ? t('login.google_off') : friendlyError(error)); }
  } }, googleLogo(), t('login.google'));

  clear(root).append(shell(h('h1', { class: 'h1' }, t('login.title')), h('p', { class: 'muted' }, t('login.subtitle')), form,
    h('div', { class: 'or-line' }, h('span', {}, t('login.or'))), google));
  if (message) setMsg(msg, message.text, message.type);
  form.querySelector('#email').focus();
}

function renderForgot(root) {
  const msg = messageBox();
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('login.reset_send'));
  const form = h('form', { class: 'form', novalidate: true },
    field('reset-email', t('login.email'), { type: 'email', autocomplete: 'username', required: true, inputmode: 'email' }),
    msg, btn,
    h('button', { class: 'btn btn-link', type: 'button', onclick: () => renderLogin(root) }, t('login.back')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.querySelector('#reset-email').value.trim();
    if (!email) { setMsg(msg, t('auth.email_required')); return; }
    btn.disabled = true;
    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    btn.disabled = false;
    if (error) setMsg(msg, friendlyError(error)); else setMsg(msg, t('login.reset_sent'), 'ok');
  });
  clear(root).append(shell(h('h1', { class: 'h1' }, t('login.reset_title')), h('p', { class: 'muted' }, t('login.reset_help')), form));
  form.querySelector('#reset-email').focus();
}

export function renderNewPassword(root, onDone) {
  const msg = messageBox();
  const btn = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, t('login.new_password_save'));
  const form = h('form', { class: 'form', novalidate: true },
    field('np1', t('login.new_password'), { type: 'password', autocomplete: 'new-password', minlength: 8, required: true }),
    field('np2', t('login.new_password2'), { type: 'password', autocomplete: 'new-password', minlength: 8, required: true }),
    msg, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const a = form.querySelector('#np1').value; const b = form.querySelector('#np2').value;
    if (a.length < 8) { setMsg(msg, t('login.password_short')); return; }
    if (a !== b) { setMsg(msg, t('login.password_mismatch')); return; }
    btn.disabled = true;
    const { error } = await supabase.auth.updateUser({ password: a });
    btn.disabled = false;
    if (error) { setMsg(msg, friendlyError(error)); return; }
    toast(t('login.password_saved'), { type: 'ok' });
    onDone();
  });
  clear(root).append(shell(h('h1', { class: 'h1' }, t('login.new_password_title')), form));
  form.querySelector('#np1').focus();
}
