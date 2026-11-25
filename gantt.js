// Gantt (zaman çizelgesi): görevler başlangıç → bitiş çubukları olarak, direktörlük veya projeye göre gruplu.
// Bilgisayarda çubuğu sürükleyerek iki tarihi birlikte kaydırır, sağ ucundan çekerek bitişi değiştirirsiniz.
import { h, icon, toast } from './ui.js';
import { t, getLang } from './i18n.js';
import { store, updateTask } from './store.js';
import { todayIso, addDays, startOfWeek, fmtLong, fmtDate, weekdayIndex, istanbulToDate } from './dates.js';
import { canEdit } from './tasks.js';

const DAY_MS = 86400000;
const OPEN = new Set();     // çok görevde açılan gruplar
const CLOSED = new Set();   // az görevde kapatılan gruplar
const dayNum = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY_MS);

export function ganttRange(state) {
  const zoom = state.gzoom === 'month' ? 'month' : 'week';
  const days = zoom === 'month' ? 120 : 42;
  const start = addDays(startOfWeek(state.anchor), -7);
  return { zoom, days, start, end: addDays(start, days - 1), px: zoom === 'month' ? 12 : 30, step: zoom === 'month' ? 28 : 14 };
}

export function ganttView(state, ctx, { save, draw }) {
  const lang = getLang();
  const R = ganttRange(state);
  const startN = dayNum(R.start);
  const today = todayIso();
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const now = new Date();

  const all = [...store.tasks.values()].filter((x) => x.status !== 'cancelled'
    && (!state.project || x.project_id === state.project)
    && (!state.gmine || x.assignee_id === ctx.profile.id || (x.co_assignee_ids || []).includes(ctx.profile.id)));
  const dated = all.filter((x) => x.start_date || x.due_date);
  const undated = all.length - dated.length;
  const span = (x) => {
    let a = x.start_date || x.due_date; let b = x.due_date || x.start_date;
    if (a > b) [a, b] = [b, a];
    return [a, b];
  };
  const visible = dated.filter((x) => { const [a, b] = span(x); return b >= R.start && a <= R.end; });
  // Gruplama: Direktörlük (varsayılan) veya Proje — Excel'deki "Gantt" ve "Proje Gantt" sayfaları
  const groupBy = state.ggroup === 'project' ? 'project' : 'directorate';
  const projName = new Map(store.projects.map((p) => [p.id, p.name]));
  const gKey = (x) => (groupBy === 'project' ? projName.get(x.project_id) || '—' : x.directorate || '—');
  const gOrder = groupBy === 'project' ? store.projects.map((p) => p.name) : store.lookups.filter((l) => l.kind === 'directorate').map((l) => l.value);
  const groups = new Map();
  for (const x of visible) { const k = gKey(x); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  const keys = [...groups.keys()].sort((a, b) => {
    const ia = gOrder.indexOf(a); const ib = gOrder.indexOf(b);
    return ((ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib)) || a.localeCompare(b, 'tr');
  });
  groups.forEach((list) => list.sort((x, y) => span(x)[0].localeCompare(span(y)[0]) || String(x.code).localeCompare(String(y.code), 'tr', { numeric: true })));
  // Çok görevde gruplar kapalı başlar; açılanlar oturum boyunca hatırlanır
  const many = visible.length > 150;
  const isOpen = (k) => (many ? OPEN.has(`${groupBy}:${k}`) : !CLOSED.has(`${groupBy}:${k}`));
  const toggle = (k) => {
    const id = `${groupBy}:${k}`;
    if (many) { if (OPEN.has(id)) OPEN.delete(id); else OPEN.add(id); } else if (CLOSED.has(id)) CLOSED.delete(id); else CLOSED.add(id);
    draw();
  };

  // Başlık: ay adları ve günler
  const width = R.days * R.px;
  const months = []; const days = [];
  for (let i = 0; i < R.days; i++) {
    const iso = addDays(R.start, i);
    const wk = weekdayIndex(iso) > 4;
    if (i === 0 || iso.slice(8) === '01') months.push(h('div', { class: 'gt-month', style: `left:${i * R.px}px` }, fmtLong(iso, lang, { month: 'long', year: 'numeric' })));
    days.push(h('div', { class: `gt-day ${wk ? 'wk' : ''} ${iso === today ? 'today' : ''}`, style: `left:${i * R.px}px;width:${R.px}px` },
      R.zoom === 'week' || weekdayIndex(iso) === 0 ? String(Number(iso.slice(8))) : ''));
  }
  const shade = [];
  for (let i = 0; i < R.days; i++) if (weekdayIndex(addDays(R.start, i)) > 4) shade.push(`linear-gradient(var(--surface-2),var(--surface-2)) ${i * R.px}px 0/${R.px}px 100% no-repeat`);
  const todayLeft = (dayNum(today) - startN) * R.px + R.px / 2;
  const showToday = today >= R.start && today <= R.end;

  const rows = [];
  const barGeom = (a, b) => {
    const left = Math.max(0, dayNum(a) - startN) * R.px;
    const right = Math.min(R.days, dayNum(b) - startN + 1) * R.px;
    return { left, width: Math.max(R.px, right - left) };
  };
  for (const k of keys) {
    const list = groups.get(k);
    const open = isOpen(k);
    const a0 = list.reduce((m, x) => (span(x)[0] < m ? span(x)[0] : m), '9999-12-31');
    const b0 = list.reduce((m, x) => (span(x)[1] > m ? span(x)[1] : m), '0000-01-01');
    const g = barGeom(a0, b0);
    const late = list.filter((x) => x.status !== 'done' && x.due_date && istanbulToDate(x.due_date, x.due_time) < now).length;
    const done = list.filter((x) => x.status === 'done').length;
    rows.push(h('div', { class: 'gt-row gt-group' },
      h('button', { type: 'button', class: 'gt-label gt-group-btn', 'aria-expanded': String(open), onclick: () => toggle(k) },
        icon(open ? 'chevronDown' : 'chevron', 'icon-sm'), h('span', { class: 'gt-group-name' }, k), h('span', { class: 'quick-n' }, String(list.length))),
      h('div', { class: 'gt-track', style: `width:${width}px` },
        h('div', { class: `gt-sum ${late ? 'is-overdue' : ''}`, style: `left:${g.left}px;width:${g.width}px`,
          title: `${k}\n${fmtDate(a0)} → ${fmtDate(b0)} · ${done}/${list.length}` },
        h('span', { class: 'gt-fill', style: `width:${list.length ? Math.round((done * 100) / list.length) : 0}%` })))));
    if (!open) continue;
    for (const x of list) {
      const [a, b] = span(x);
      const { left, width: w } = barGeom(a, b);
      const overdue = x.status !== 'done' && x.due_date && istanbulToDate(x.due_date, x.due_time) < now;
      const editable = canEdit(ctx, x) && !touch;
      const bar = h('a', {
        class: `gt-bar st-${x.status} ${overdue ? 'is-overdue' : ''} ${editable ? 'is-draggable' : ''}`,
        href: `#/gorev/${x.id}`, style: `left:${left}px;width:${w}px`,
        title: `${x.code || ''} ${x.title}\n${fmtDate(a)} → ${fmtDate(b)} · %${x.progress || 0}`,
      }, h('span', { class: 'gt-fill', style: `width:${x.progress || 0}%` }), h('span', { class: 'gt-text' }, x.title),
      editable ? h('span', { class: 'gt-handle', 'aria-hidden': 'true' }) : null);
      if (editable) attachDrag(bar, x, a, b);
      rows.push(h('div', { class: 'gt-row' },
        h('a', { class: 'gt-label gt-task', href: `#/gorev/${x.id}` }, h('span', { class: 'muted small' }, `${x.code || `#${x.no}`} `), x.title),
        h('div', { class: 'gt-track', style: `width:${width}px;background:${shade.join(',') || 'none'}` }, bar)));
    }
  }

  function attachDrag(bar, x, a, b) {
    let sx = 0; let mode = null; let moved = false; let delta = 0;
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      mode = e.target.classList.contains('gt-handle') ? 'resize' : 'move';
      sx = e.clientX; moved = false; delta = 0;
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    bar.addEventListener('pointermove', (e) => {
      if (!mode) return;
      const d = Math.round((e.clientX - sx) / R.px);
      if (Math.abs(e.clientX - sx) > 3) moved = true;
      if (d === delta) return;
      delta = d;
      const baseW = (dayNum(b) - dayNum(a) + 1) * R.px;
      if (mode === 'move') bar.style.transform = `translateX(${d * R.px}px)`;
      else bar.style.width = `${Math.max(R.px, baseW + d * R.px)}px`;
      bar.classList.add('dragging');
      bar.dataset.preview = mode === 'move' ? `${fmtDate(addDays(a, d))} → ${fmtDate(addDays(b, d))}` : `→ ${fmtDate(addDays(b, Math.max(d, dayNum(a) - dayNum(b))))}`;
    });
    const end = (e) => {
      if (!mode) return;
      const m = mode; mode = null;
      bar.classList.remove('dragging');
      if (!moved) return;   // tıklama: bağlantı görevi açar
      e.preventDefault();
      bar.addEventListener('click', (ev) => ev.preventDefault(), { once: true });
      if (!delta) { draw(); return; }
      let patch;
      if (m === 'move') {
        patch = { due_date: x.due_date ? addDays(x.due_date, delta) : null, start_date: x.start_date ? addDays(x.start_date, delta) : null };
        Object.keys(patch).forEach((k) => patch[k] === null && delete patch[k]);
      } else {
        const nd = addDays(b, Math.max(delta, dayNum(a) - dayNum(b)));
        patch = { due_date: nd };
      }
      updateTask(x.id, patch);
      toast(t('gt.moved', { title: x.title, when: `${fmtDate(patch.start_date || x.start_date || patch.due_date)} → ${fmtDate(patch.due_date || x.due_date)}` }), { type: 'ok' });
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', () => { mode = null; bar.classList.remove('dragging'); draw(); });
  }

  const mine = h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: Boolean(state.gmine), onchange: (e) => { state.gmine = e.target.checked; save(); draw(); } }), t('wk.only_mine'));
  const zoom = h('div', { class: 'seg seg-sm', role: 'group', 'aria-label': t('gt.zoom') },
    ...['week', 'month'].map((z) => h('button', { type: 'button', class: `seg-btn ${R.zoom === z ? 'active' : ''}`, 'aria-pressed': String(R.zoom === z),
      onclick: () => { state.gzoom = z; save(); draw(); } }, t(`gt.zoom_${z}`))));

  const scroller = h('div', { class: 'gt-scroll' },
    h('div', { class: 'gt-row gt-head' },
      h('div', { class: 'gt-label gt-corner' }, t('gt.tasks_n', { n: visible.length })),
      h('div', { class: 'gt-track gt-scale', style: `width:${width}px` }, h('div', { class: 'gt-months' }, months), h('div', { class: 'gt-days' }, days))),
    ...rows,
    showToday ? h('div', { class: 'gt-today', style: `left:calc(var(--gt-label) + ${todayLeft}px);height:calc(${rows.length} * var(--gt-row) + var(--gt-head))` }) : null);

  const grp = h('div', { class: 'seg seg-sm', role: 'group', 'aria-label': t('gt.group') },
    ...[['directorate', t('field.directorate')], ['project', t('tasks.col_project')]].map(([g, txt]) => h('button', { type: 'button',
      class: `seg-btn ${groupBy === g ? 'active' : ''}`, 'aria-pressed': String(groupBy === g),
      onclick: () => { state.ggroup = g; save(); draw(); } }, txt)));
  const allBtn = h('button', { class: 'btn btn-link btn-sm', type: 'button', onclick: () => {
    const anyClosed = keys.some((k) => !isOpen(k));
    keys.forEach((k) => {
      const id = `${groupBy}:${k}`;
      if (many) { if (anyClosed) OPEN.add(id); else OPEN.delete(id); } else if (anyClosed) CLOSED.delete(id); else CLOSED.add(id);
    });
    draw();
  } }, keys.some((k) => !isOpen(k)) ? t('gt.open_all') : t('gt.close_all'));

  const box = h('div', { class: 'gt-wrap' },
    h('div', { class: 'row-gap gt-tools' }, zoom, grp, mine, keys.length > 1 ? allBtn : null,
      h('span', { class: 'muted small' }, undated ? t('gt.undated', { n: undated }) : '')),
    visible.length ? scroller : h('div', { class: 'state' }, icon('calendar', 'icon-lg'), h('p', {}, t('gt.empty'))),
    h('p', { class: 'muted small mt' }, touch ? t('gt.hint_touch') : t('gt.hint')));
  // İlk açılışta bugüne kaydır
  requestAnimationFrame(() => { if (showToday) scroller.scrollLeft = Math.max(0, todayLeft - 200); });
  return box;
}
