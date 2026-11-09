// Bugün: özet kutuları, gecikenler, bugünün işleri, bugün tekrarlananlar, yaklaşan 3 gün
import { h, clear, icon, spinner, toast } from './ui.js';
import { t, getLang } from './i18n.js';
import { store, on, setStatus } from './store.js';
import { todayIso, addDays, fmtLong, fmtDate, fmtTime, dueInfo, istanbulToDate } from './dates.js';
import { priorityBadge, canEdit } from './tasks.js';

function stat(labelText, value, tone = '', iconName) {
  return h('div', { class: `stat ${tone}` },
    h('span', { class: 'stat-label' }, iconName ? icon(iconName, 'icon-sm') : null, ' ', labelText),
    h('span', { class: 'stat-value' }, String(value)));
}

export async function render(root, ctx) {
  if (!store.ready) {
    root.append(spinner());
    await new Promise((resolve) => { const off = on('data', () => { off(); resolve(); }); });
    clear(root);
  }
  const page = h('section', { class: 'page' });
  root.append(page);

  function row(tk) {
    const info = dueInfo(tk);
    const project = store.projects.find((p) => p.id === tk.project_id)?.name || '';
    const editable = canEdit(ctx, tk) && !['done', 'cancelled'].includes(tk.status);
    return h('li', { class: `today-row ${info?.tone === 'overdue' ? 'is-overdue' : ''}` },
      editable
        ? h('button', { class: 'done-btn', type: 'button', 'aria-label': `${t('tasks.mark_done')}: ${tk.title}`, title: t('tasks.mark_done'),
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            const r = await setStatus(tk.id, 'done');
            if (r !== 'recurring') toast(t('tasks.marked_done'), { type: 'ok' });
          } }, icon('check'))
        : h('span', { class: 'done-btn done-btn-off', 'aria-hidden': 'true' }, icon(tk.status === 'done' ? 'check' : 'circle')),
      h('div', { class: 'today-main' },
        h('a', { class: 'row-link', href: `#/gorev/${tk.id}` }, tk.title),
        h('div', { class: 'muted small' }, project,
          tk.recurrence !== 'once' ? h('span', { class: 'chip chip-repeat' }, icon('repeat')) : null)),
      h('div', { class: 'today-side' },
        priorityBadge(tk.priority),
        info ? h('span', { class: `due-tag due-${info.tone}` }, info.tone === 'overdue' ? icon('alert') : icon('clock'), info.text)
          : h('span', { class: 'muted small' }, `${fmtDate(tk.due_date)} ${fmtTime(tk.due_time)}`)));
  }

  function section(title, items, tone, emptyText) {
    return h('section', { class: `today-sec ${tone || ''}` },
      h('h2', { class: 'h3' }, title, h('span', { class: 'quick-n' }, String(items.length))),
      items.length ? h('ul', { class: 'today-list' }, items.map(row)) : h('p', { class: 'muted small pad0' }, emptyText));
  }

  function draw() {
    const lang = getLang();
    const today = todayIso(); const now = new Date();
    const in3 = addDays(today, 3);
    const all = [...store.tasks.values()].filter((x) => x.status !== 'cancelled');
    const open = all.filter((x) => x.status !== 'done');
    const overdue = open.filter((x) => x.due_date && istanbulToDate(x.due_date, x.due_time) < now)
      .sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    const isToday = (x) => x.due_date === today || x.start_date === today;
    const todayRec = open.filter((x) => x.recurrence !== 'once' && x.due_date === today && !overdue.includes(x));
    const todayList = open.filter((x) => isToday(x) && !overdue.includes(x) && !todayRec.includes(x))
      .sort((a, b) => String(a.due_time).localeCompare(String(b.due_time)));
    const soon = open.filter((x) => x.due_date && x.due_date > today && x.due_date <= in3)
      .sort((a, b) => (`${a.due_date}${a.due_time}` < `${b.due_date}${b.due_time}` ? -1 : 1));
    const avg = all.length ? Math.round(all.reduce((s, x) => s + (x.progress || 0), 0) / all.length) : 0;

    clear(page).append(
      h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'h1' }, t('today.title')), h('p', { class: 'muted count' }, fmtLong(today, lang)))),
      h('div', { class: 'stats stats-5' },
        stat(t('today.total'), all.length, '', 'list'),
        stat(t('today.done'), all.filter((x) => x.status === 'done').length, 'tone-green', 'check'),
        stat(t('today.in_progress'), all.filter((x) => x.status === 'in_progress').length, 'tone-amber', 'play'),
        stat(t('today.overdue'), overdue.length, overdue.length ? 'tone-red' : '', 'alert'),
        stat(t('today.avg'), `%${avg}`, '', 'chart')),
      h('div', { class: 'today-grid' },
        section(t('today.sec_overdue'), overdue, 'sec-red', t('today.none_overdue')),
        section(t('today.sec_today'), todayList, '', t('today.none_today')),
        section(t('today.sec_recurring'), todayRec, '', t('today.none_recurring')),
        section(t('today.sec_soon'), soon, '', t('today.none_soon'))));
  }

  draw();
  const off = on('data', draw);
  return off;
}

