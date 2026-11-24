// Özet (#/ozet): Excel'deki "Özet Panel" sayfasının panel hali.
// Üstte 6 kutu; direktörlük / proje / kişi bazında durum tablosu; öncelik dağılımı; iş yükü (saat).
import { h, clear, icon, spinner } from './ui.js';
import { t, getLang } from './i18n.js';
import { summarize, label } from './excel-format.js';
import { store, on } from './store.js';
import { setTaskFilter } from './tasks.js';
import { todayIso } from './dates.js';

const TAB_KEY = 'evodak.summaryTab';

const num = (v, d = 0) => Number(v || 0).toLocaleString(getLang() === 'en' ? 'en-GB' : 'tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => `%${num(v, 1)}`;

export async function render(root) {
  if (!store.ready) {
    root.append(spinner());
    await new Promise((resolve) => { const off = on('data', () => { off(); resolve(); }); });
    clear(root);
  }
  const page = h('section', { class: 'page' });
  root.append(page);
  let tab = (() => { try { return localStorage.getItem(TAB_KEY) || 'directorate'; } catch { return 'directorate'; } })();

  function goTasks(patch) {
    setTaskFilter(patch);
    location.hash = '#/gorevler';
  }

  function draw() {
    const tasks = [...store.tasks.values()];
    const today = todayIso();
    const projects = new Map(store.projects.map((p) => [p.id, p]));
    const people = new Map(store.profiles.map((p) => [p.id, p.full_name]));
    const conf = {
      directorate: { key: (tk) => tk.directorate || '—', order: store.lookups.filter((l) => l.kind === 'directorate').map((l) => l.value),
        filter: (name) => ({ directorate: name === '—' ? '-' : name }), head: t('field.directorate') },
      project: { key: (tk) => projects.get(tk.project_id)?.name || '—', order: store.projects.map((p) => p.name),
        filter: (name) => ({ project: store.projects.find((p) => p.name === name)?.id || '' }), head: t('tasks.col_project') },
      person: { key: (tk) => people.get(tk.assignee_id) || t('tasks.unassigned'), order: [t('tasks.unassigned')],
        filter: (name) => ({ assignee: store.profiles.find((p) => p.full_name === name)?.id || '-' }), head: t('tasks.assignee') },
    }[tab];
    const s = summarize(tasks, { today, key: conf.key, order: conf.order });
    const T = s.totals;

    const box = (txt, value, tone = '', onclick = null) => h(onclick ? 'button' : 'div',
      { class: `stat ${tone} ${onclick ? 'stat-btn' : ''}`, type: onclick ? 'button' : null, onclick },
      h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, txt));

    const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': t('summary.group_by') },
      [['directorate', t('field.directorate')], ['project', t('tasks.col_project')], ['person', t('tasks.assignee')]].map(([k, txt]) =>
        h('button', { type: 'button', role: 'tab', class: `seg-btn ${tab === k ? 'active' : ''}`, 'aria-selected': String(tab === k),
          onclick: () => { tab = k; try { localStorage.setItem(TAB_KEY, k); } catch { /* yok say */ } draw(); } }, txt)));

    const rowLink = (name) => h('button', { type: 'button', class: 'link-btn', onclick: () => goTasks(conf.filter(name)) }, name);

    const statusTable = h('div', { class: 'table-wrap table-scroll' }, h('table', { class: 'simple-table sum-table' },
      h('thead', {}, h('tr', {}, [conf.head, t('summary.total'), label('status', 'todo', getLang()), label('status', 'in_progress', getLang()),
        label('status', 'waiting', getLang()), label('status', 'done', getLang()), label('status', 'cancelled', getLang()),
        t('summary.overdue'), t('summary.soon'), t('summary.avg_progress'), t('summary.done_pct')].map((x, i) => h('th', { scope: 'col', class: i ? 'num' : '' }, x)))),
      h('tbody', {}, s.groups.map((g) => h('tr', {},
        h('th', { scope: 'row' }, rowLink(g.name)),
        ...[g.total, g.todo, g.in_progress, g.waiting, g.done, g.cancelled].map((v) => h('td', { class: 'num' }, num(v))),
        h('td', { class: `num ${g.overdue ? 'tone-red-text' : ''}` }, num(g.overdue)),
        h('td', { class: `num ${g.soon ? 'tone-amber-text' : ''}` }, num(g.soon)),
        h('td', { class: 'num' }, pct(g.avgProgress)), h('td', { class: 'num' }, pct(g.donePct))))),
      h('tfoot', {}, h('tr', {},
        h('th', { scope: 'row' }, t('summary.total_row')),
        ...[T.total, T.todo, T.in_progress, T.waiting, T.done, T.cancelled, T.overdue, T.soon].map((v) => h('td', { class: 'num' }, num(v))),
        h('td', { class: 'num' }, pct(T.avgProgress)), h('td', { class: 'num' }, pct(T.donePct))))));

    const prioTable = h('div', { class: 'table-wrap table-scroll' }, h('table', { class: 'simple-table' },
      h('thead', {}, h('tr', {}, [t('tasks.col_priority'), t('summary.open'), t('summary.overdue')].map((x, i) => h('th', { scope: 'col', class: i ? 'num' : '' }, x)))),
      h('tbody', {}, s.priorities.map((p) => h('tr', {},
        h('th', { scope: 'row' }, h('button', { type: 'button', class: 'link-btn', onclick: () => goTasks({ priority: p.code }) }, label('priority', p.code, getLang()))),
        h('td', { class: 'num' }, num(p.open)), h('td', { class: `num ${p.overdue ? 'tone-red-text' : ''}` }, num(p.overdue)))))));

    const loadTable = h('div', { class: 'table-wrap table-scroll' }, h('table', { class: 'simple-table sum-table' },
      h('thead', {}, h('tr', {}, [conf.head, t('summary.tasks'), t('summary.once_h'), t('summary.rec_h'), t('summary.total_h'), t('summary.rec_week_h')]
        .map((x, i) => h('th', { scope: 'col', class: i ? 'num' : '' }, x)))),
      h('tbody', {}, s.groups.map((g) => h('tr', {},
        h('th', { scope: 'row' }, rowLink(g.name)),
        h('td', { class: 'num' }, num(g.total)), h('td', { class: 'num' }, num(g.once_h, 1)), h('td', { class: 'num' }, num(g.rec_h, 1)),
        h('td', { class: 'num strong' }, num(g.total_h, 1)), h('td', { class: 'num' }, num(g.rec_week_h, 1))))),
      h('tfoot', {}, h('tr', {},
        h('th', { scope: 'row' }, t('summary.total_row')),
        h('td', { class: 'num' }, num(T.total)), h('td', { class: 'num' }, num(T.once_h, 1)), h('td', { class: 'num' }, num(T.rec_h, 1)),
        h('td', { class: 'num strong' }, num(T.total_h, 1)), h('td', { class: 'num' }, num(T.rec_week_h, 1))))));

    clear(page).append(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', { class: 'h1' }, t('summary.title')), h('p', { class: 'muted' }, t('summary.sub', { n: num(tasks.length) }))),
        h('div', { class: 'row-gap' },
          h('a', { class: 'btn', href: '#/projeler' }, icon('folder'), t('nav.projects')),
          h('a', { class: 'btn', href: '#/haftalik' }, icon('chart'), t('wk.title')))),
      h('div', { class: 'stats stats-6' },
        box(t('summary.total_tasks'), num(T.total), '', () => goTasks({})),
        box(label('status', 'in_progress', getLang()), num(T.in_progress), 'tone-amber', () => goTasks({ status: 'in_progress' })),
        box(label('status', 'done', getLang()), num(T.done), 'tone-green', () => goTasks({ status: 'done' })),
        box(t('summary.overdue'), num(T.overdue), T.overdue ? 'tone-red' : '', () => goTasks({ due: 'overdue' })),
        box(t('summary.soon'), num(T.soon), T.soon ? 'tone-amber' : '', () => goTasks({ due: 'soon' })),
        box(t('summary.done_pct'), pct(T.donePct), 'tone-green')),
      tabs,
      h('h2', { class: 'h2' }, t('summary.status_by', { by: conf.head })),
      statusTable,
      h('div', { class: 'sum-grid' },
        h('div', {}, h('h2', { class: 'h2' }, t('summary.priority_dist')), prioTable),
        h('div', {}, h('h2', { class: 'h2' }, t('summary.load_by', { by: conf.head })),
          h('p', { class: 'muted small' }, t('summary.load_help')), loadTable)));
  }

  draw();
  let timer;
  const off = on('data', () => { clearTimeout(timer); timer = setTimeout(draw, 400); });
  return () => { clearTimeout(timer); off(); };
}
