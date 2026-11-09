// Ortak arayüz yardımcıları: öğe oluşturma, simgeler, bildirim balonu, onay penceresi
import { t } from './i18n.js';

// h('div', { class: 'x', onclick: fn }, 'metin', çocukÖğe, [liste])
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
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
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// Öğeyi boşaltır. Dönen öğenin append'i boş (null/undefined/false) değerleri atlar,
// böylece ekranda yanlışlıkla "null" yazısı çıkmaz.
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  if (!el.__safeAppend) {
    el.append = (...c) => { appendChildren(el, c); };
    el.__safeAppend = true;
  }
  return el;
}

// Sabit, güvenli SVG simgeler (kullanıcı verisi içermez)
const ICONS = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  save: '<path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h8M8 21v-7h8v7"/>',
  chevronUp: '<path d="M6 15l6-6 6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 20a6 6 0 0 0-3-5.2"/>',
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
  plus: '<path d="M12 5v14M5 12h14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  folder: '<path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  chart: '<path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  download: '<path d="M12 4v12m-5-5l5 5 5-5M4 20h16"/>',
  columns: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="7" rx="1"/>',
  filter: '<path d="M4 5h16l-6 8v5l-4 2v-7z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  history: '<path d="M4 12a8 8 0 102.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6M12 8v4l3 2"/>',
  cloudOff: '<path d="M3 3l18 18"/><path d="M7 18h10a4 4 0 001.6-7.7A6 6 0 008 8.1M5.5 10.6A4 4 0 007 18"/>',
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
