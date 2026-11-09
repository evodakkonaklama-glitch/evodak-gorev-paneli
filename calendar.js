// Takvim: gün / hafta / ay. Görevi başka güne sürükleyince bitiş tarihi değişir.
import { h, clear, icon, spinner, toast } from './ui.js';
import { t, getLang } from './i18n.js';
import { store, on, updateTask } from './store.js';
import { todayIso, addDays, startOfWeek, startOfMonth, addMonths, fmtLong, weekdayNames, fmtTime, dueInfo, istanbulToDate } from './dates.js';
import { canEdit, priorityBadge } from './tasks.js';

const STATE_KEY = 'evodak.calendar';
const state = (() => {
  try { return { view: 'month', anchor: todayIso(), project: '', ...JSON.parse(localStorage.getItem(STATE_KEY) || '{}') }; } catch { return { view: 'month', anchor: todayIso(), project: '' }; }
})();
const save = () => { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* yok say */ } };

export async function render(root, ctx) {
  if (!store.ready) {
    root.append(spinner());
    await new Promise((resolve) => { const off = on('data', () => { off(); resolve(); }); });
    clear(root);
  }
  const page = h('section', { class: 'page' });
  root.append(page);
  const mobile = () => window.matchMedia('(max-width: 700px)').matches;

  function tasksByDay() {
    const map = new Map();
    for (const tk of store.tasks.values()) {
      if (!tk.due_date || tk.status === 'cancelled') continue;
      if (state.project && tk.project_id !== state.project) continue;
      if (!map.has(tk.due_date)) map.set(tk.due_date, []);
      map.get(tk.due_date).push(tk);
    }
    map.forEach((list) => list.sort((a, b) => String(a.due_time).localeCompare(String(b.due_time))));
    return map;
  }

  function chip(tk) {
    const now = new Date();
    const overdue = tk.status !== 'done' && istanbulToDate(tk.due_date, tk.due_time) < now;
    const editable = canEdit(ctx, tk);
    const el = h('a', {
      class: `cal-chip prio-bg-${tk.priority} ${tk.status === 'done' ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''}`,
      href: `#/gorev/${tk.id}`, draggable: editable ? 'true' : 'false', title: tk.title,
    }, h('span', { class: 'cal-time' }, fmtTime(tk.due_time)), h('span', { class: 'cal-title' }, tk.title));
    if (editable) {
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', tk.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    }
    return el;
  }

  function dropTarget(el, iso) {
    el.dataset.date = iso;
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drop'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => {
      e.preventDefault(); el.classList.remove('drop');
      const id = e.dataTransfer.getData('text/plain');
      const tk = store.tasks.get(id);
      if (!tk || tk.due_date === iso || !canEdit(ctx, tk)) return;
      updateTask(id, { due_date: iso });
      toast(t('cal.moved', { title: tk.title, date: fmtLong(iso, getLang(), { day: 'numeric', month: 'long' }) }), { type: 'ok' });
    });
  }

  function header() {
    const lang = getLang();
    const title = state.view === 'month' ? fmtLong(state.anchor, lang, { month: 'long', year: 'numeric' })
      : state.view === 'week' ? `${fmtLong(startOfWeek(state.anchor), lang, { day: 'numeric', month: 'short' })} – ${fmtLong(addDays(startOfWeek(state.anchor), 6), lang, { day: 'numeric', month: 'short', year: 'numeric' })}`
        : fmtLong(state.anchor, lang);
    const step = (dir) => {
      state.anchor = state.view === 'month' ? addMonths(startOfMonth(state.anchor), dir) : addDays(state.anchor, dir * (state.view === 'week' ? 7 : 1));
      save(); draw();
    };
    const proj = h('select', { class: 'input', 'aria-label': t('tasks.col_project') }, h('option', { value: '' }, t('tasks.all_projects')),
      store.projects.map((p) => h('option', { value: p.id, selected: state.project === p.id }, p.name)));
    proj.addEventListener('change', () => { state.project = proj.value; save(); draw(); });
    return h('div', { class: 'cal-head' },
      h('div', { class: 'cal-nav' },
        h('button', { class: 'btn', type: 'button', 'aria-label': t('cal.prev'), onclick: () => step(-1) }, icon('chevronLeft')),
        h('button', { class: 'btn', type: 'button', onclick: () => { state.anchor = todayIso(); save(); draw(); } }, t('cal.today')),
        h('button', { class: 'btn', type: 'button', 'aria-label': t('cal.next'), onclick: () => step(1) }, icon('chevron')),
        h('h1', { class: 'h2 cal-title-h' }, title)),
      h('div', { class: 'cal-tools' },
        proj,
        h('div', { class: 'seg', role: 'group', 'aria-label': t('tasks.view') },
          ...['day', 'week', 'month'].map((v) => h('button', { type: 'button', class: `seg-btn ${state.view === v ? 'active' : ''}`, 'aria-pressed': String(state.view === v),
            onclick: () => { state.view = v; save(); draw(); } }, t(`cal.${v}`))))));
  }

  function monthView(byDay) {
    const lang = getLang();
    const today = todayIso();
    const first = startOfMonth(state.anchor);
    const start = startOfWeek(first);
    const month = first.slice(0, 7);
    const grid = h('div', { class: 'cal-month', role: 'grid' },
      ...weekdayNames(lang, 'short').map((n) => h('div', { class: 'cal-wd', role: 'columnheader' }, n)));
    const limit = mobile() ? 0 : 3;
    for (let i = 0; i < 42; i++) {
      const iso = addDays(start, i);
      const list = byDay.get(iso) || [];
      const open = list.filter((x) => x.status !== 'done');
      const cell = h('div', { class: `cal-cell ${iso.slice(0, 7) !== month ? 'other' : ''} ${iso === today ? 'today' : ''}`, role: 'gridcell' },
        h('button', { type: 'button', class: 'cal-day', 'aria-label': `${fmtLong(iso, lang)}: ${list.length} ${t('cal.tasks')}`,
          onclick: () => { state.view = 'day'; state.anchor = iso; save(); draw(); } }, String(Number(iso.slice(8)))),
        limit ? list.slice(0, limit).map(chip) : null,
        limit && list.length > limit ? h('button', { type: 'button', class: 'cal-more', onclick: () => { state.view = 'day'; state.anchor = iso; save(); draw(); } }, t('cal.more', { n: list.length - limit })) : null,
        !limit && list.length ? h('span', { class: `cal-dot ${open.some((x) => istanbulToDate(x.due_date, x.due_time) < new Date()) ? 'red' : ''}` }, String(list.length)) : null);
      dropTarget(cell, iso);
      grid.append(cell);
    }
    return grid;
  }

  function weekView(byDay) {
    const lang = getLang(); const today = todayIso();
    const start = startOfWeek(state.anchor);
    const wrap = h('div', { class: 'cal-week' });
    for (let i = 0; i < 7; i++) {
      const iso = addDays(start, i);
      const list = byDay.get(iso) || [];
      const col = h('div', { class: `cal-wcol ${iso === today ? 'today' : ''}` },
        h('button', { type: 'button', class: 'cal-whead', onclick: () => { state.view = 'day'; state.anchor = iso; save(); draw(); } },
          fmtLong(iso, lang, { weekday: 'short', day: 'numeric', month: 'short' }), h('span', { class: 'quick-n' }, String(list.length))),
        h('div', { class: 'cal-wlist' }, list.map(chip)));
      dropTarget(col, iso);
      wrap.append(col);
    }
    return wrap;
  }

  function dayView(byDay) {
    const list = byDay.get(state.anchor) || [];
    const starting = [...store.tasks.values()].filter((x) => x.start_date === state.anchor && x.due_date !== state.anchor && (!state.project || x.project_id === state.project));
    const item = (tk) => {
      const info = dueInfo(tk);
      return h('li', { class: 'today-row' },
        h('span', { class: 'cal-time big' }, fmtTime(tk.due_time)),
        h('div', { class: 'today-main' }, h('a', { class: 'row-link', href: `#/gorev/${tk.id}` }, tk.title),
          h('div', { class: 'muted small' }, store.projects.find((p) => p.id === tk.project_id)?.name || '')),
        h('div', { class: 'today-side' }, priorityBadge(tk.priority),
          info ? h('span', { class: `due-tag due-${info.tone}` }, info.text) : tk.status === 'done' ? h('span', { class: 'chip' }, icon('check')) : null));
    };
    const box = h('div', { class: 'cal-day-view' });
    dropTarget(box, state.anchor);
    box.append(
      h('h2', { class: 'h3' }, t('cal.due_on_day'), h('span', { class: 'quick-n' }, String(list.length))),
      list.length ? h('ul', { class: 'today-list' }, list.map(item)) : h('p', { class: 'muted' }, t('cal.empty_day')),
      starting.length ? [h('h2', { class: 'h3 mt' }, t('cal.starting_on_day')), h('ul', { class: 'today-list' }, starting.map(item))] : null);
    return box;
  }

  function draw() {
    const byDay = tasksByDay();
    clear(page).append(header(),
      state.view === 'month' ? monthView(byDay) : state.view === 'week' ? weekView(byDay) : dayView(byDay),
      h('p', { class: 'muted small mt' }, mobile() ? t('cal.hint_mobile') : t('cal.hint')));
  }

  draw();
  const off = on('data', draw);
  const onResize = () => draw();
  const mq = window.matchMedia('(max-width: 700px)');
  mq.addEventListener('change', onResize);
  return () => { off(); mq.removeEventListener('change', onResize); };
}
