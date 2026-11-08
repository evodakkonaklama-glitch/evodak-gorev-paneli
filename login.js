// Giriş, şifremi unuttum, yeni şifre ve "yapılandırma eksik" ekranları
import { h, clear, icon, toast } from '../ui.js';
import { t } from '../../i18n.js';
import { supabase, friendlyError } from '../supabase.js';

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

  clear(root).append(shell(h('h1', { class: 'h1' }, t('login.title')), h('p', { class: 'muted' }, t('login.subtitle')), form));
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
