// Haftalık özet: geçen 7 günde tamamlananlar, gecikenler, bu haftanın işleri (pazartesi bildirimi buraya açılır)
import { h, clear, icon, spinner } from './ui.js';
import { t, getLang } from './i18n.js';
import { store, on } from './store.js';
import { supabase } from './supabase.js';
import { todayIso, addDays, startOfWeek, fmtLong, fmtDate, fmtTime, istanbulToDate } from './dates.js';
import { priorityBadge } from './tasks.js';

export async function render(root, ctx) {
  if (!store.ready) {
    root.append(spinner());
    await new Promise((resolve) => { const off = on('data', () => { off(); resolve(); }); });
    clear(root);
  }
  const page = h('section', { class: 'page' });
  root.append(page);
  let onlyMine = !ctx.isAdmin;
  let occ = [];

  const projectName = (id) => store.projects.find((p) => p.id === id)?.name || '';
  const mine = (x) => !onlyMine || x.assignee_id === ctx.profile.id;

  function list(items, emptyText, dateOf) {
    if (!items.length) return h('p', { class: 'muted small pad0' }, emptyText);
    return h('ul', { class: 'today-list' }, items.map((x) => h('li', { class: 'today-row wk-row' },
      h('div', { class: 'today-main' },
        x.id ? h('a', { class: 'row-link', href: `#/gorev/${x.id}` }, x.title) : h('span', { class: 'row-link' }, x.title),
        h('div', { class: 'muted small' }, projectName(x.project_id))),
      h('div', { class: 'today-side' }, x.priority ? priorityBadge(x.priority) : null, h('span', { class: 'muted small' }, dateOf(x))))));
  }

  async function loadOcc() {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data } = await supabase.from('task_occurrences').select('task_id,occurrence_date,completed_by,completed_at').gte('completed_at', since).order('completed_at', { ascending: false });
    occ = data || [];
    draw();
  }

  function draw() {
    const lang = getLang();
    const today = todayIso(); const now = new Date();
    const since = now.getTime() - 7 * 86400000;
    const monday = startOfWeek(today); const sunday = addDays(monday, 6);
    const tasks = [...store.tasks.values()].filter((x) => x.status !== 'cancelled');
    const doneTasks = tasks.filter((x) => x.status === 'done' && x.completed_at && new Date(x.completed_at).getTime() >= since && mine(x))
      .map((x) => ({ ...x, _at: x.completed_at }));
    const doneOcc = occ.filter((o) => !onlyMine || o.completed_by === ctx.profile.id).map((o) => {
      const tk = store.tasks.get(o.task_id);
      return tk ? { ...tk, _at: o.completed_at, _occ: o.occurrence_date } : null;
    }).filter(Boolean);
    const done = [...doneTasks, ...doneOcc].sort((a, b) => (a._at < b._at ? 1 : -1));
    const open = tasks.filter((x) => x.status !== 'done' && mine(x));
    const overdue = open.filter((x) => x.due_date && istanbulToDate(x.due_date, x.due_time) < now).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    const week = open.filter((x) => x.due_date && x.due_date >= today && x.due_date <= sunday && !overdue.includes(x))
      .sort((a, b) => (`${a.due_date}${a.due_time}` < `${b.due_date}${b.due_time}` ? -1 : 1));

    clear(page).append(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', { class: 'h1' }, t('wk.title')),
          h('p', { class: 'muted count' }, `${fmtLong(monday, lang, { day: 'numeric', month: 'long' })} – ${fmtLong(sunday, lang, { day: 'numeric', month: 'long', year: 'numeric' })}`)),
        ctx.isAdmin ? h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: onlyMine, onchange: (e) => { onlyMine = e.target.checked; draw(); } }), t('wk.only_mine')) : null),
      h('div', { class: 'stats stats-3' },
        h('div', { class: 'stat tone-green' }, h('span', { class: 'stat-label' }, icon('check', 'icon-sm'), ' ', t('wk.done')), h('span', { class: 'stat-value' }, String(done.length))),
        h('div', { class: `stat ${overdue.length ? 'tone-red' : ''}` }, h('span', { class: 'stat-label' }, icon('alert', 'icon-sm'), ' ', t('wk.overdue')), h('span', { class: 'stat-value' }, String(overdue.length))),
        h('div', { class: 'stat tone-amber' }, h('span', { class: 'stat-label' }, icon('calendar', 'icon-sm'), ' ', t('wk.this_week')), h('span', { class: 'stat-value' }, String(week.length)))),
      h('div', { class: 'today-grid' },
        h('section', { class: 'today-sec' }, h('h2', { class: 'h3' }, t('wk.done'), h('span', { class: 'quick-n' }, String(done.length))),
          list(done, t('wk.none_done'), (x) => `${fmtDate(x._at.slice(0, 10))}${x._occ ? ` · ${t('wk.occurrence')}` : ''}`)),
        h('section', { class: 'today-sec sec-red' }, h('h2', { class: 'h3' }, t('wk.overdue'), h('span', { class: 'quick-n' }, String(overdue.length))),
          list(overdue, t('today.none_overdue'), (x) => fmtDate(x.due_date))),
        h('section', { class: 'today-sec' }, h('h2', { class: 'h3' }, t('wk.this_week'), h('span', { class: 'quick-n' }, String(week.length))),
          list(week, t('wk.none_week'), (x) => `${fmtDate(x.due_date)} ${fmtTime(x.due_time)}`))),
      h('p', { class: 'muted small mt' }, t('wk.help')));
  }

  draw();
  loadOcc();
  return on('data', draw);
}
