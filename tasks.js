// Görevler – 1. aşama: arama ve filtreli basit liste (telefonda kart). Düzenleme 3. aşamada.
import { h, clear, icon, spinner, toast } from './ui.js';
import { t, getLang } from './i18n.js';
import { supabase, fetchAll, friendlyError } from './supabase.js';
import { label, searchFold } from './excel-format.js';
import { fmtDate, fmtTime, fmtDateTime, dueInfo } from './dates.js';

const STATUS_ICON = { todo: 'circle', in_progress: 'play', waiting: 'pause', blocked: 'block', done: 'check', cancelled: 'x' };
const PRIORITY_ICON = { urgent: 'alert', high: 'arrowUp', medium: 'minus', low: 'arrowDown' };

// Filtreler sayfa değişse de korunur
const state = { q: '', project: '', status: '' };

export function statusBadge(code) {
  return h('span', { class: `badge status-${code}` }, icon(STATUS_ICON[code] || 'circle'), label('status', code, getLang()));
}

export function priorityBadge(code) {
  return h('span', { class: `prio prio-${code}` }, icon(PRIORITY_ICON[code] || 'minus'), label('priority', code, getLang()));
}

function progressBar(value) {
  return h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': value, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `${value}%` },
    h('div', { class: 'progress-track' }, h('div', { class: 'progress-fill', style: `width:${value}%` })),
    h('span', { class: 'progress-text' }, `${value}%`));
}

function dueCell(task) {
  if (!task.due_date) return h('span', { class: 'muted' }, '—');
  const info = dueInfo(task);
  return h('div', { class: 'due' },
    h('span', {}, fmtDate(task.due_date), ' ', h('span', { class: 'muted' }, fmtTime(task.due_time))),
    task.recurrence !== 'once' ? h('span', { class: 'chip chip-repeat', title: label('recurrence', task.recurrence, getLang()) }, icon('repeat'), label('recurrence', task.recurrence, getLang())) : null,
    info ? h('span', { class: `due-tag due-${info.tone}` }, info.tone === 'overdue' ? icon('alert') : icon('clock'), info.text) : null);
}

export async function render(root, ctx) {
  root.append(spinner());

  const [projects, profiles, tasks] = await Promise.all([
    fetchAll(() => supabase.from('projects').select('id,name,type,sort_order').order('sort_order')),
    fetchAll(() => supabase.from('profiles').select('id,full_name').order('full_name')),
    fetchAll(() => supabase.from('tasks')
      .select('id,no,project_id,section,category,title,description,tags,status,priority,progress,assignee_id,start_date,due_date,due_time,estimate_minutes,recurrence,recurrence_day,reminder,reference_links,updated_at,updated_by')
      .is('deleted_at', null).order('no')),
  ]);

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const personById = new Map(profiles.map((p) => [p.id, p.full_name]));
  for (const tk of tasks) {
    tk._project = projectById.get(tk.project_id)?.name || '';
    tk._search = searchFold([tk.no, tk.title, tk.description, tk._project, tk.section, tk.category, (tk.tags || []).join(' ')].join(' '));
  }

  clear(root);
  const page = h('section', { class: 'page' });
  root.append(page);

  if (!tasks.length) {
    page.append(h('div', { class: 'state' },
      icon('list', 'icon-lg'),
      h('h1', { class: 'h2' }, t('tasks.empty_title')),
      h('p', { class: 'muted' }, ctx.isAdmin ? t('tasks.empty_admin') : t('tasks.empty_member')),
      ctx.isAdmin ? h('a', { class: 'btn btn-primary', href: '#/ice-aktar' }, icon('upload'), t('tasks.upload_excel')) : null));
    return null;
  }

  const search = h('input', { class: 'input', type: 'search', placeholder: t('tasks.search'), 'aria-label': t('tasks.search'), value: state.q });
  const projectSel = h('select', { class: 'input', 'aria-label': t('tasks.col_project') },
    h('option', { value: '' }, t('tasks.all_projects')),
    projects.map((p) => h('option', { value: p.id, selected: state.project === p.id }, p.name)));
  const statusSel = h('select', { class: 'input', 'aria-label': t('tasks.col_status') },
    h('option', { value: '' }, t('tasks.all_statuses')),
    Object.keys(STATUS_ICON).map((s) => h('option', { value: s, selected: state.status === s }, label('status', s, getLang()))));
  const count = h('p', { class: 'muted count', 'aria-live': 'polite' });
  const listBox = h('div', { class: 'list-box' });

  page.append(
    h('div', { class: 'page-head' }, h('h1', { class: 'h1' }, t('tasks.title')), count),
    h('div', { class: 'toolbar' },
      h('div', { class: 'search-wrap' }, icon('search'), search), projectSel, statusSel),
    listBox);

  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.q = search.value; draw(); }, 120); });
  projectSel.addEventListener('change', () => { state.project = projectSel.value; draw(); });
  statusSel.addEventListener('change', () => { state.status = statusSel.value; draw(); });

  const openRows = new Set();

  function draw() {
    const q = searchFold(state.q);
    const rows = tasks.filter((tk) => (!q || tk._search.includes(q))
      && (!state.project || tk.project_id === state.project)
      && (!state.status || tk.status === state.status));
    count.textContent = rows.length === tasks.length ? t('tasks.count', { n: tasks.length }) : t('tasks.count_of', { n: rows.length, total: tasks.length });

    clear(listBox);
    if (!rows.length) {
      listBox.append(h('div', { class: 'state' }, h('p', {}, t('tasks.no_results')),
        h('button', { class: 'btn', type: 'button', onclick: () => {
          state.q = ''; state.project = ''; state.status = ''; search.value = ''; projectSel.value = ''; statusSel.value = ''; draw();
        } }, t('tasks.clear_filters'))));
      return;
    }

    const tbody = h('tbody');
    for (const tk of rows) {
      const isOpen = openRows.has(tk.id);
      const toggle = h('button', { class: 'row-toggle', type: 'button', 'aria-expanded': String(isOpen), onclick: () => {
        if (openRows.has(tk.id)) openRows.delete(tk.id); else openRows.add(tk.id);
        draw();
      } }, icon('chevron', isOpen ? 'rot90' : ''), h('span', {}, tk.title));
      const info = dueInfo(tk);
      tbody.append(h('tr', { class: `task-row ${info?.tone === 'overdue' ? 'is-overdue' : ''} ${tk.status === 'done' ? 'is-done' : ''}`, dataset: { task: tk.id } },
        h('td', { class: 'c-no', 'data-label': t('tasks.col_no') }, tk.no),
        h('td', { class: 'c-title', 'data-label': t('tasks.col_title') }, toggle,
          h('div', { class: 'sub muted' }, [tk.section, tk.category].filter(Boolean).join(' · '))),
        h('td', { class: 'c-project', 'data-label': t('tasks.col_project') }, tk._project),
        h('td', { class: 'c-status', 'data-label': t('tasks.col_status') }, statusBadge(tk.status)),
        h('td', { class: 'c-prio', 'data-label': t('tasks.col_priority') }, priorityBadge(tk.priority)),
        h('td', { class: 'c-due', 'data-label': t('tasks.col_due') }, dueCell(tk)),
        h('td', { class: 'c-progress', 'data-label': t('tasks.col_progress') }, progressBar(tk.progress))));
      if (isOpen) {
        const cell = h('td', { colspan: 7 });
        tbody.append(h('tr', { class: 'detail-row' }, cell));
        fillDetail(cell, tk, personById, ctx, async () => {
          const { data } = await supabase.from('tasks').select('status,progress,updated_at,updated_by').eq('id', tk.id).maybeSingle();
          if (data) Object.assign(tk, data);
          draw();
        });
      }
    }
    listBox.append(h('div', { class: 'table-wrap' }, h('table', { class: 'task-table' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col', class: 'c-no' }, t('tasks.col_no')),
        h('th', { scope: 'col' }, t('tasks.col_title')),
        h('th', { scope: 'col' }, t('tasks.col_project')),
        h('th', { scope: 'col' }, t('tasks.col_status')),
        h('th', { scope: 'col' }, t('tasks.col_priority')),
        h('th', { scope: 'col' }, t('tasks.col_due')),
        h('th', { scope: 'col' }, t('tasks.col_progress')))),
      tbody)));
  }

  if (ctx.openTaskId && tasks.some((tk) => tk.id === ctx.openTaskId)) {
    state.q = ''; state.project = ''; state.status = '';
    search.value = ''; projectSel.value = ''; statusSel.value = '';
    openRows.add(ctx.openTaskId);
  }
  draw();
  if (ctx.openTaskId) {
    const row = listBox.querySelector(`[data-task="${ctx.openTaskId}"]`);
    if (row) { row.scrollIntoView({ block: 'center' }); row.querySelector('.row-toggle')?.focus({ preventScroll: true }); }
  }
  return () => clearTimeout(timer);
}

async function fillDetail(cell, tk, personById, ctx, onChange) {
  const lang = getLang();
  const meta = [
    [t('tasks.assignee'), tk.assignee_id ? personById.get(tk.assignee_id) : t('tasks.unassigned')],
    [t('tasks.start'), fmtDate(tk.start_date) || '—'],
    [t('tasks.estimate'), tk.estimate_minutes ? t('tasks.minutes', { n: tk.estimate_minutes }) : '—'],
    [t('tasks.recurrence'), label('recurrence', tk.recurrence, lang)
      + (tk.recurrence_day ? ` (${label('weekday', tk.recurrence_day, lang) || tk.recurrence_day})` : '')],
    [t('tasks.reminder'), label('reminder', tk.reminder, lang)],
    [t('tasks.tags'), (tk.tags || []).join(', ') || '—'],
  ];
  const list = h('ol', { class: 'checklist' }, h('li', { class: 'muted' }, t('app.loading')));
  cell.append(h('div', { class: 'detail' },
    h('dl', { class: 'meta' }, meta.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    tk.description ? h('div', {}, h('h3', { class: 'h3' }, t('tasks.description')), h('p', { class: 'pre' }, tk.description)) : null,
    h('div', {}, h('h3', { class: 'h3' }, t('tasks.checklist')), list),
    tk.reference_links?.length ? h('div', {}, h('h3', { class: 'h3' }, t('tasks.references')),
      h('ul', { class: 'refs' }, tk.reference_links.map((r) => h('li', {}, /^https?:\/\//i.test(r)
        ? h('a', { href: r, target: '_blank', rel: 'noopener noreferrer' }, icon('link'), r)
        : h('span', {}, icon('file'), r))))) : null,
    taskActions(tk, ctx, onChange),
    h('p', { class: 'muted small' }, t('tasks.last_change', { who: personById.get(tk.updated_by) || '—', when: fmtDateTime(tk.updated_at) }),
      ' · ', t('tasks.detail_soon'))));

  const { data, error } = await supabase.from('checklist_items').select('text,note,done').eq('task_id', tk.id).order('sort_order');
  clear(list);
  if (error) { list.append(h('li', { class: 'form-msg-error' }, friendlyError(error))); return; }
  if (!data.length) { list.replaceWith(h('p', { class: 'muted' }, '—')); return; }
  data.forEach((it) => list.append(h('li', { class: it.done ? 'done' : '' },
    icon(it.done ? 'check' : 'circle'), h('span', {}, it.text, it.note ? h('span', { class: 'muted' }, ` – ${it.note}`) : null))));
}

// Bildirimdeki düğmelerin aynısı (iPhone bildirimde düğme göstermeyebilir)
function taskActions(tk, ctx, onChange) {
  if (tk.status === 'done' || tk.status === 'cancelled') return null;
  const canEdit = ctx.isAdmin || (ctx.profile.role === 'member' && tk.assignee_id === ctx.profile.id);
  const box = h('div', { class: 'row-wrap' });
  if (canEdit) {
    box.append(h('button', { class: 'btn btn-success', type: 'button', onclick: async (e) => {
      e.target.disabled = true;
      const { data: items } = await supabase.from('checklist_items').select('id').eq('task_id', tk.id).eq('done', false);
      let error;
      if (items && items.length) ({ error } = await supabase.from('checklist_items').update({ done: true }).eq('task_id', tk.id).eq('done', false));
      if (!error) ({ error } = await supabase.from('tasks').update({ status: 'done' }).eq('id', tk.id).neq('status', 'done'));
      if (error) { toast(friendlyError(error), { type: 'error' }); e.target.disabled = false; return; }
      toast(t('tasks.marked_done'), { type: 'ok' });
      onChange();
    } }, icon('check'), t('tasks.mark_done')));
  }
  box.append(h('button', { class: 'btn', type: 'button', onclick: async (e) => {
    e.target.disabled = true;
    const { error } = await supabase.from('notification_snoozes').insert({
      task_id: tk.id, profile_id: ctx.profile.id, until: new Date(Date.now() + 10 * 60000).toISOString(),
    });
    if (error) { toast(friendlyError(error), { type: 'error' }); e.target.disabled = false; return; }
    toast(t('tasks.snoozed'), { type: 'ok' });
  } }, icon('clock'), t('tasks.snooze')));
  return box;
}
