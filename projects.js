// Projeler: Listeler sırasıyla kartlar; tür, görev sayısı, ilerleme, geciken sayısı
import { h, clear, icon, spinner } from './ui.js';
import { t, getLang } from './i18n.js';
import { label } from './excel-format.js';
import { store, on } from './store.js';
import { istanbulToDate } from './dates.js';
import { setTaskFilter } from './tasks.js';
import { newProjectDialog, editProjectDialog } from './templates.js';

export async function render(root, ctx) {
  if (!store.ready) {
    root.append(spinner());
    await new Promise((resolve) => { const off = on('data', () => { off(); resolve(); }); });
    clear(root);
  }
  const page = h('section', { class: 'page' });
  root.append(page);
  let showArchived = false;

  function draw() {
    const lang = getLang();
    const now = new Date();
    const tasks = [...store.tasks.values()].filter((x) => x.status !== 'cancelled');
    const archivedCount = store.projects.filter((p) => p.archived).length;
    const projects = store.projects.filter((p) => showArchived || !p.archived);
    const cards = projects.map((p) => {
      const list = tasks.filter((x) => x.project_id === p.id);
      const done = list.filter((x) => x.status === 'done').length;
      const overdue = list.filter((x) => x.status !== 'done' && x.due_date && istanbulToDate(x.due_date, x.due_time) < now).length;
      const progress = list.length ? Math.round(list.reduce((s, x) => s + (x.progress || 0), 0) / list.length) : 0;
      const open = () => { setTaskFilter({ project: p.id }); location.hash = '#/gorevler'; };
      return h('article', { class: `proj-card ${p.archived ? 'is-archived' : ''}` },
        h('div', { class: 'proj-top' }, h('span', { class: `proj-type type-${p.type}` }, label('project_type', p.type, lang)),
          p.archived ? h('span', { class: 'chip' }, t('np.archived_chip')) : null,
          overdue ? h('span', { class: 'due-tag due-overdue' }, icon('alert'), t('proj.overdue', { n: overdue })) : null,
          ctx.isAdmin ? h('button', { class: 'icon-btn icon-btn-sm proj-edit', type: 'button', title: t('np.edit_title'), 'aria-label': `${t('np.edit_title')}: ${p.name}`,
            onclick: () => editProjectDialog(p) }, icon('edit')) : null),
        h('h2', { class: 'proj-name' }, h('button', { type: 'button', class: 'proj-link', onclick: open }, p.name)),
        h('div', { class: 'progress' }, h('div', { class: 'progress-track' }, h('div', { class: 'progress-fill', style: `width:${progress}%` })), h('span', { class: 'progress-text' }, `${progress}%`)),
        h('p', { class: 'muted small' }, t('proj.counts', { n: list.length, done })));
    });
    clear(page).append(
      h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'h1' }, t('proj.title')), h('p', { class: 'muted count' }, t('proj.count', { n: projects.length }))),
        h('div', { class: 'row-gap' },
          archivedCount ? h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: showArchived, onchange: (e) => { showArchived = e.target.checked; draw(); } }), t('np.show_archived', { n: archivedCount })) : null,
          ctx.isAdmin ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newProjectDialog() }, icon('plus'), t('np.title')) : null)),
      projects.length ? h('div', { class: 'proj-grid' }, cards) : h('div', { class: 'state' }, h('p', {}, t('proj.empty'))));
  }
  draw();
  return on('data', draw);
}
