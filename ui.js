// Ortak arayüz yardımcıları: öğe oluşturma, simgeler, bildirim balonu, onay penceresi
import { t } from './i18n.js';

// h('div', { class: 'x', onclick: fn }, 'metin', çocukÖğe, [liste])
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // yalnızca sabit SVG simgeler için kullanılır
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

// Sabit, güvenli SVG simgeler (kullanıcı verisi içermez)
const ICONS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  play: '<circle cx="12" cy="12" r="8"/><path d="M10.5 9v6l4.5-3z" fill="currentColor"/>',
  pause: '<circle cx="12" cy="12" r="8"/><path d="M10 9v6M14 9v6"/>',
  block: '<circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  flag: '<path d="M6 21V4m0 0h10l-2 4 2 4H6"/>',
  arrowUp: '<path d="M12 19V5m-6 6l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14m-6-6l6 6 6-6"/>',
  minus: '<path d="M6 12h12"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4m0 3v.01"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  upload: '<path d="M12 16V4m-5 5l5-5 5 5M4 20h16"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10l1.4 1.4M5.6 18.4L7 17m10-10l1.4-1.4"/>',
  repeat: '<path d="M4 11V9a3 3 0 013-3h12m-3-3l3 3-3 3M20 13v2a3 3 0 01-3 3H5m3 3l-3-3 3-3"/>',
  bell: '<path d="M6 16V11a6 6 0 1112 0v5l2 2H4z"/><path d="M10 20a2 2 0 004 0"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `icon ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

export function toast(message, { type = 'info', timeout = 4000, action } = {}) {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
    h('span', { class: 'toast-text' }, message));
  if (action) {
    el.append(h('button', { class: 'btn btn-link', type: 'button', onclick: () => { action.run(); el.remove(); } }, action.label));
  }
  el.append(h('button', { class: 'toast-close', type: 'button', 'aria-label': t('common.close'), onclick: () => el.remove() }, icon('x')));
  box.append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}

export function confirmDialog(message, { confirmLabel = t('common.confirm'), danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog' },
      h('p', {}, message),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn', type: 'button', value: 'cancel', onclick: () => dlg.close('cancel') }, t('common.cancel')),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => dlg.close('ok') }, confirmLabel)));
    dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'ok'); dlg.remove(); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function spinner(text) {
  return h('div', { class: 'state', role: 'status', 'aria-live': 'polite' },
    h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('p', {}, text || t('app.loading')));
}

export function errorState(message, onRetry) {
  return h('div', { class: 'state state-error', role: 'alert' },
    icon('alert', 'icon-lg'),
    h('h2', {}, t('app.error_title')),
    h('p', {}, message),
    onRetry ? h('button', { class: 'btn btn-primary', type: 'button', onclick: onRetry }, t('app.retry')) : null);
}
