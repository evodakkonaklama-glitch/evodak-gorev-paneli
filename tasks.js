// Görevler: liste (telefonda kart) ve Kanban; filtre, arama, sıralama, gruplama, hızlı görünümler, toplu işlem.
// 3.000+ görevde akıcı olsun diye liste 100'erli parçalarla çizilir.
import { h, clear, icon, spinner, toast, confirmDialog } from './ui.js';
import { t, getLang } from './i18n.js';
import { label, searchFold, compareCode, dueState, DUE_STATE_LABELS, VALUE_LABELS } from './excel-format.js';
import { fmtDate, fmtTime, dueInfo, todayIso, istanbulToDate } from './dates.js';
import { store, on, setStatus, checklistCounts, reloadAll } from './store.js';
import { supabase, friendlyError } from './supabase.js';
import { openDetail, closeDetail, isDetailOpen, newTaskDialog } from './task-detail.js';
import { exportTasks } from './export.js';

export const STATUS_ORDER = ['todo', 'in_progress', 'waiting', 'done', 'cancelled'];
const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'];
const STATUS_ICON = { todo: 'circle', in_progress: 'play', waiting: 'pause', done: 'check', cancelled: 'x' };
const PRIORITY_ICON = { urgent: 'alert', high: 'arrowUp', medium: 'minus', low: 'arrowDown' };
const KANBAN_LIMIT = 60;
const PAGE = 100;
const STATE_KEY = 'evodak.taskView';
const FILTER_KEYS = ['directorate', 'project', 'section', 'category', 'status', 'priority', 'assignee', 'recurrence', 'due', 'tag', 'from', 'to'];

const DEFAULT_STATE = { view: 'list', quick: 'all', q: '', group: '', sort: 'code', dir: 1, filtersOpen: false,
  ...Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])) };
const state = (() => {
  try {
    const s = { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem(STATE_KEY) || '{}'), q: '' };
    if (s.sort === 'no') s.sort = 'code';
    if (s.status === 'blocked') s.status = '';
    return s;
  } catch { return { ...DEFAULT_STATE }; }
})();
function saveState() { try { const { q, ...rest } = state; localStorage.setItem(STATE_KEY, JSON.stringify(rest)); } catch { /* yok say */ } }

// ---------------------------------------------------------------- küçük parçalar
export function statusBadge(code) {
  return h('span', { class: `badge status-${code}` }, icon(STATUS_ICON[code] || 'circle'), label('status', code, getLang()));
}
export function priorityBadge(code) {
  return h('span', { class: `prio prio-${code}` }, icon(PRIORITY_ICON[code] || 'minus'), label('priority', code, getLang()));
}
export function codeTag(tk) {
  return h('span', { class: 'code-tag' }, tk.code || `#${tk.no}`);
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
    task.recurrence !== 'once' ? h('span', { class: 'chip chip-repeat' }, icon('repeat'), label('recurrence', task.recurrence, getLang())) : null,
    info ? h('span', { class: `due-tag due-${info.tone}` }, info.tone === 'overdue' ? icon('alert') : icon('clock'), info.text) : null);
}

export function canEdit(ctx, task) {
  return ctx.isAdmin || (ctx.profile.role === 'member' && task.assignee_id === ctx.profile.id);
}

// Gecikme yalnızca tek seferlik görevler için (tekrarlayan rutinler Bugün → tekrarlananlar'da)
function isOverdue(tk, now) {
  return tk.recurrence === 'once' && tk.due_date && !['done', 'cancelled'].includes(tk.status) && istanbulToDate(tk.due_date, tk.due_time) < now;
}

// ---------------------------------------------------------------- filtreleme
function quickMatch(tk, quick, ctx, today, now) {
  switch (quick) {
    case 'today': return tk.due_date === today;
    case 'overdue': return isOverdue(tk, now);
    case 'soon': return dueState(tk, today) === 'soon';
    case 'mine': return tk.assignee_id === ctx.profile.id;
    case 'unassigned': return !tk.assignee_id && !['done', 'cancelled'].includes(tk.status);
    case 'done': return tk.status === 'done';
    default: return true;
  }
}

function applyFilters(tasks, ctx) {
  const q = searchFold(state.q);
  const today = todayIso(); const now = new Date();
  return tasks.filter((tk) => quickMatch(tk, state.quick, ctx, today, now)
    && (!q || tk._search.includes(q))
    && (!state.directorate || (state.directorate === '-' ? !tk.directorate : tk.directorate === state.directorate))
    && (!state.project || tk.project_id === state.project)
    && (!state.section || tk.section === state.section)
    && (!state.category || tk.category === state.category)
    && (!state.status || tk.status === state.status)
    && (!state.priority || tk.priority === state.priority)
    && (!state.assignee || (state.assignee === '-' ? !tk.assignee_id : tk.assignee_id === state.assignee))
    && (!state.recurrence || tk.recurrence === state.recurrence)
    && (!state.due || (state.due === '-' ? !dueState(tk, today) : dueState(tk, today) === state.due))
    && (!state.tag || (tk.tags || []).includes(state.tag))
    && (!state.from || (tk.due_date && tk.due_date >= state.from))
    && (!state.to || (tk.due_date && tk.due_date <= state.to)));
}

function sortTasks(list, projectOrder) {
  const d = state.dir;
  const byCode = (a, b) => compareCode(a.code, b.code);
  const key = {
    title: (x) => x._titleKey,
    project: (x) => projectOrder.get(x.project_id) ?? 999,
    directorate: (x) => x._dirKey,
    status: (x) => STATUS_ORDER.indexOf(x.status),
    priority: (x) => PRIORITY_ORDER.indexOf(x.priority),
    due: (x) => (x.due_date ? `${x.due_date} ${x.due_time || ''}` : '9999'),
    progress: (x) => x.progress,
  }[state.sort];
  if (!key) return list.sort((a, b) => d * byCode(a, b));
  return list.sort((a, b) => {
    const ka = key(a); const kb = key(b);
    if (ka < kb) return -d; if (ka > kb) return d;
    return byCode(a, b);
  });
}

// Başka ekrandan (Projeler, Özet) filtreyle görev listesine gitmek için
export function setTaskFilter(patch) {
  FILTER_KEYS.forEach((k) => { state[k] = ''; });
  Object.assign(state, { quick: 'all', q: '' }, patch);
  saveState();
}

function activeFilterCount() {
  return FILTER_KEYS.filter((k) => state[k]).length;
}

// ---------------------------------------------------------------- ekran
export async function render(root, ctx) {
  if (!store.ready) {
    root.append(spinner());
    await new Promise((resolve) => { const off = on('data', () => { off(); resolve(); }); });
    clear(root);
  }

  const page = h('section', { class: 'page' });
  root.append(page);
  const projectById = () => new Map(store.projects.map((p) => [p.id, p]));
  const personById = () => new Map(store.profiles.map((p) => [p.id, p.full_name]));
  const selected = new Set();
  let limit = PAGE;
  const toggled = new Set();   // varsayılandan farklı açılan/kapanan gruplar

  // Arama metni ve sıralama anahtarı: yalnızca değişen görevlerde yeniden hesaplanır
  function decorate() {
    const projects = projectById();
    for (const tk of store.tasks.values()) {
      const sig = `${tk.version}|${tk.updated_at}|${tk.project_id}`;
      if (tk._sig === sig) continue;
      tk._sig = sig;
      tk._project = projects.get(tk.project_id)?.name || '';
      tk._titleKey = searchFold(tk.title);
      tk._dirKey = searchFold(tk.directorate || '');
      tk._search = searchFold([tk.code, tk.title, tk.description, tk._project, tk.directorate, tk.section, tk.category, (tk.tags || []).join(' ')].join(' '));
    }
  }

  if (!store.tasks.size) {
    page.append(h('div', { class: 'state' },
      icon('list', 'icon-lg'),
      h('h1', { class: 'h2' }, t('tasks.empty_title')),
      h('p', { class: 'muted' }, ctx.isAdmin ? t('tasks.empty_admin') : t('tasks.empty_member')),
      ctx.isAdmin ? h('a', { class: 'btn btn-primary', href: '#/ice-aktar' }, icon('upload'), t('tasks.upload_excel')) : null));
    const off = on('data', () => { if (store.tasks.size) location.reload(); });
    return off;
  }

  // ---- üst kısım
  const count = h('p', { class: 'muted count', 'aria-live': 'polite' });
  const quickBar = h('div', { class: 'quick', role: 'tablist', 'aria-label': t('tasks.quick_views') });
  const search = h('input', { class: 'input', type: 'search', placeholder: t('tasks.search'), 'aria-label': t('tasks.search'), value: state.q });
  const filterBtn = h('button', { class: 'btn', type: 'button', 'aria-expanded': String(state.filtersOpen) });
  const viewToggle = h('div', { class: 'seg', role: 'group', 'aria-label': t('tasks.view') });
  const filterPanel = h('div', { class: 'filters', hidden: !state.filtersOpen });
  const bulkBar = h('div', { class: 'bulk-bar', hidden: true });
  const content = h('div', { class: 'list-box' });

  const currentRows = () => sortTasks(applyFilters([...store.tasks.values()], ctx), new Map(store.projects.map((p, i) => [p.id, i])));

  page.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', { class: 'h1' }, t('tasks.title')), count),
      h('div', { class: 'row-gap' },
        h('button', { class: 'btn', type: 'button', title: t('export.tasks_help'), onclick: () => {
          const rows = currentRows();
          if (!rows.length) { toast(t('export.empty'), { type: 'error' }); return; }
          exportTasks(rows);
        } }, icon('download'), h('span', { class: 'hide-mobile' }, t('export.btn'))),
        ctx.isAdmin ? h('button', { class: 'btn btn-primary hide-mobile', type: 'button', onclick: () => newTaskDialog(ctx) }, icon('plus'), t('tasks.new')) : null)),
    quickBar,
    h('div', { class: 'toolbar toolbar-3' }, h('div', { class: 'search-wrap' }, icon('search'), search), filterBtn, viewToggle),
    filterPanel,
    bulkBar,
    content);

  // Satırın herhangi bir yerine tıklayınca görevi aç
  content.addEventListener('click', (e) => {
    const row = e.target.closest('.task-row');
    if (!row || e.target.closest('a, button, input, select, label')) return;
    location.hash = `#/gorev/${row.dataset.task}`;
  });

  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.q = search.value; limit = PAGE; draw(); }, 150); });
  filterBtn.addEventListener('click', () => {
    state.filtersOpen = !state.filtersOpen; filterPanel.hidden = !state.filtersOpen;
    filterBtn.setAttribute('aria-expanded', String(state.filtersOpen)); saveState();
  });

  function drawViewToggle() {
    clear(viewToggle).append(
      ...[['list', 'list', t('tasks.view_list')], ['kanban', 'columns', t('tasks.view_kanban')]].map(([v, ic, txt]) =>
        h('button', { type: 'button', class: `seg-btn ${state.view === v ? 'active' : ''}`, 'aria-pressed': String(state.view === v),
          onclick: () => { state.view = v; saveState(); drawViewToggle(); draw(); } }, icon(ic), h('span', { class: 'seg-text' }, txt))));
  }

  function select(key, labelText, options, { any = t('tasks.any') } = {}) {
    const id = `f-${key}`;
    const el = h('select', { id, class: 'input' }, any === null ? null : h('option', { value: '' }, any),
      options.map(([v, txt]) => h('option', { value: v, selected: state[key] === v }, txt)));
    el.addEventListener('change', () => { state[key] = el.value; limit = PAGE; saveState(); draw(); });
    return h('div', { class: 'field' }, h('label', { for: id }, labelText), el);
  }
  function dateInput(key, labelText) {
    const id = `f-${key}`;
    const el = h('input', { id, type: 'date', class: 'input', value: state[key] });
    el.addEventListener('change', () => { state[key] = el.value; limit = PAGE; saveState(); draw(); });
    return h('div', { class: 'field' }, h('label', { for: id }, labelText), el);
  }

  function drawFilters() {
    const lang = getLang();
    const all = [...store.tasks.values()];
    const uniq = (arr) => [...new Set(arr.filter(Boolean))];
    const lookups = (kind) => store.lookups.filter((l) => l.kind === kind).map((l) => l.value);
    const dirs = uniq([...lookups('directorate'), ...all.map((x) => x.directorate)]);
    // Alt birim ve fonksiyon listesi seçili direktörlüğe göre daralır
    const scoped = state.directorate ? all.filter((x) => x.directorate === state.directorate) : all;
    const sections = uniq([...(state.directorate ? [] : lookups('section')), ...scoped.map((x) => x.section)]);
    const categories = uniq(scoped.map((x) => x.category)).sort((a, b) => a.localeCompare(b, 'tr'));
    const tags = uniq(all.flatMap((x) => x.tags || [])).sort((a, b) => a.localeCompare(b, 'tr'));
    const dirSel = select('directorate', t('field.directorate'), [['-', t('tasks.none')], ...dirs.map((s) => [s, s])]);
    dirSel.querySelector('select').addEventListener('change', () => { state.section = ''; state.category = ''; saveState(); drawFilters(); });
    clear(filterPanel).append(
      h('div', { class: 'filter-grid' },
        dirSel,
        select('section', t('tasks.section'), sections.map((s) => [s, s])),
        select('project', t('tasks.col_project'), store.projects.filter((p) => !p.archived).map((p) => [p.id, p.name])),
        select('category', t('tasks.category'), categories.map((s) => [s, s])),
        select('status', t('tasks.col_status'), STATUS_ORDER.map((s) => [s, label('status', s, lang)])),
        select('priority', t('tasks.col_priority'), PRIORITY_ORDER.map((s) => [s, label('priority', s, lang)])),
        select('assignee', t('tasks.assignee'), [['-', t('tasks.unassigned')], ...store.profiles.filter((p) => p.active !== false).map((p) => [p.id, p.full_name])]),
        select('recurrence', t('field.recurrence'), Object.keys(VALUE_LABELS.recurrence).map((s) => [s, label('recurrence', s, lang)])),
        select('due', t('field.due_state'), [...Object.keys(DUE_STATE_LABELS).map((s) => [s, DUE_STATE_LABELS[s][lang === 'en' ? 1 : 0]]), ['-', t('tasks.no_due_state')]]),
        select('tag', t('tasks.tags'), tags.map((s) => [s, s])),
        dateInput('from', t('tasks.due_from')),
        dateInput('to', t('tasks.due_to')),
        select('group', t('tasks.group'), [['', t('tasks.group_none')], ['directorate', t('field.directorate')], ['project', t('tasks.col_project')], ['category', t('tasks.category')]], { any: null })),
      h('div', { class: 'row-wrap' }, h('button', { class: 'btn btn-link', type: 'button', onclick: () => {
        FILTER_KEYS.forEach((k) => { state[k] = ''; });
        limit = PAGE; saveState(); drawFilters(); draw();
      } }, t('tasks.clear_filters'))));
  }

  function drawQuick(all) {
    const today = todayIso(); const now = new Date();
    const items = [['all', t('tasks.q_all')], ['today', t('tasks.q_today')], ['overdue', t('tasks.q_overdue')], ['soon', t('tasks.q_soon')],
      ['mine', t('tasks.q_mine')], ['unassigned', t('tasks.q_unassigned')], ['done', t('tasks.q_done')]];
    clear(quickBar).append(...items.map(([k, txt]) => {
      const n = all.filter((tk) => quickMatch(tk, k, ctx, today, now)).length;
      return h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.quick === k), class: `quick-btn ${state.quick === k ? 'active' : ''} ${k === 'overdue' && n ? 'has-overdue' : ''}`,
        onclick: () => { state.quick = k; limit = PAGE; saveState(); draw(); } }, txt, h('span', { class: 'quick-n' }, String(n)));
    }));
  }

  let lastRows = [];
  function draw() {
    stopObservers();
    decorate();
    const all = [...store.tasks.values()];
    const projects = projectById();
    drawQuick(all);
    const n = activeFilterCount();
    clear(filterBtn).append(icon('filter'), h('span', {}, t('tasks.filters')), n ? h('span', { class: 'quick-n' }, String(n)) : null);
    const rows = currentRows();
    lastRows = rows;
    for (const id of [...selected]) if (!store.tasks.has(id)) selected.delete(id);
    count.textContent = rows.length === all.length ? t('tasks.count', { n: all.length }) : t('tasks.count_of', { n: rows.length, total: all.length });
    drawBulk();

    const scrollEl = content.querySelector('.table-wrap, .kanban');
    const scroll = scrollEl ? [scrollEl.scrollTop, scrollEl.scrollLeft] : null;
    const winY = window.scrollY;
    clear(content);
    if (!rows.length) {
      content.append(h('div', { class: 'state' }, h('p', {}, t('tasks.no_results')),
        h('button', { class: 'btn', type: 'button', onclick: () => {
          Object.assign(state, { q: '', quick: 'all' }); search.value = '';
          FILTER_KEYS.forEach((k) => { state[k] = ''; });
          saveState(); drawFilters(); draw();
        } }, t('tasks.clear_filters'))));
      return;
    }
    if (state.view === 'kanban') drawKanban(rows, projects); else drawList(rows);
    const newEl = content.querySelector('.table-wrap, .kanban');
    if (scroll && newEl) { newEl.scrollTop = scroll[0]; newEl.scrollLeft = scroll[1]; }
    if (Math.abs(window.scrollY - winY) > 2) window.scrollTo(0, winY);
  }

  // ---- toplu işlem (owner/admin)
  function drawBulk() {
    if (!ctx.isAdmin || !selected.size) { bulkBar.hidden = true; clear(bulkBar); return; }
    bulkBar.hidden = false;
    const lang = getLang();
    const sel = (key, labelText, options) => {
      const el = h('select', { class: 'input input-sm', 'aria-label': labelText, dataset: { key } },
        h('option', { value: '__' }, labelText), options.map(([v, txt]) => h('option', { value: v }, txt)));
      return el;
    };
    const fields = [
      sel('assignee_id', t('tasks.assignee'), [['', t('tasks.unassigned')], ...store.profiles.filter((p) => p.active !== false).map((p) => [p.id, p.full_name])]),
      sel('priority', t('tasks.col_priority'), PRIORITY_ORDER.map((s) => [s, label('priority', s, lang)])),
      sel('status', t('tasks.col_status'), STATUS_ORDER.map((s) => [s, label('status', s, lang)])),
      sel('reminder', t('field.reminder'), Object.keys(VALUE_LABELS.reminder).map((s) => [s, label('reminder', s, lang)])),
    ];
    const due = h('input', { type: 'date', class: 'input input-sm', 'aria-label': t('field.due_date'), title: t('field.due_date') });
    const apply = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, t('bulk.apply'));
    apply.addEventListener('click', async () => {
      const patch = {};
      fields.forEach((f) => { if (f.value !== '__') patch[f.dataset.key] = f.value; });
      if (due.value) patch.due_date = due.value;
      if (!Object.keys(patch).length) { toast(t('bulk.pick'), { type: 'error' }); return; }
      const ok = await confirmDialog(t('bulk.confirm', { n: selected.size }), { confirmLabel: t('bulk.apply') });
      if (!ok) return;
      apply.disabled = true;
      const { data, error } = await supabase.rpc('bulk_update_tasks', { p_ids: [...selected], p_patch: patch });
      apply.disabled = false;
      if (error) { toast(friendlyError(error), { type: 'error' }); return; }
      selected.clear();
      await reloadAll();
      toast(t('bulk.done', { n: data }), { type: 'ok' });
      draw();
    });
    clear(bulkBar).append(
      h('strong', {}, t('bulk.selected', { n: selected.size })),
      h('button', { class: 'btn btn-link btn-sm', type: 'button', onclick: () => { lastRows.forEach((x) => selected.add(x.id)); draw(); } },
        t('bulk.select_all', { n: lastRows.length })),
      h('button', { class: 'btn btn-link btn-sm', type: 'button', onclick: () => { selected.clear(); draw(); } }, t('bulk.clear')),
      h('div', { class: 'bulk-fields' }, ...fields, due, apply));
  }

  // ---- liste
  function sortHeader(key, text, cls = '') {
    const active = state.sort === key;
    return h('th', { scope: 'col', class: cls, 'aria-sort': active ? (state.dir === 1 ? 'ascending' : 'descending') : 'none' },
      h('button', { type: 'button', class: 'th-btn', onclick: () => {
        if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = 1; }
        saveState(); draw();
      } }, text, active ? icon(state.dir === 1 ? 'arrowUp' : 'arrowDown', 'icon-sm') : null));
  }

  function groupKey(tk) {
    if (state.group === 'directorate') return tk.directorate || t('tasks.none');
    if (state.group === 'project') return tk._project || t('tasks.none');
    if (state.group === 'category') return tk.category || t('tasks.none');
    return '';
  }

  function taskRow(tk, people, now) {
    const c = checklistCounts(tk.id);
    const overdue = isOverdue(tk, now);
    const ds = dueState(tk);
    const check = ctx.isAdmin ? h('input', { type: 'checkbox', checked: selected.has(tk.id), 'aria-label': t('bulk.select_one', { v: tk.code }) }) : null;
    check?.addEventListener('change', () => { if (check.checked) selected.add(tk.id); else selected.delete(tk.id); drawBulk(); });
    return h('tr', { class: `task-row ${overdue ? 'is-overdue' : ''} ${tk.status === 'done' ? 'is-done' : ''} ${selected.has(tk.id) ? 'is-selected' : ''}`, dataset: { task: tk.id } },
      ctx.isAdmin ? h('td', { class: 'c-sel' }, check) : null,
      h('td', { class: 'c-no' }, codeTag(tk)),
      h('td', { class: 'c-title' },
        h('a', { class: 'row-link', href: `#/gorev/${tk.id}` }, tk.title),
        h('div', { class: 'sub muted' }, [tk.directorate, tk.section, tk.category].filter(Boolean).join(' · '),
          c.total ? h('span', { class: 'chip' }, icon('check', 'icon-sm'), `${c.done}/${c.total}`) : null,
          tk.assignee_id ? h('span', { class: 'chip' }, people.get(tk.assignee_id) || '') : null,
          ds && ds !== 'overdue' && !dueInfo(tk) ? h('span', { class: `due-state ds-${ds}` }, DUE_STATE_LABELS[ds][getLang() === 'en' ? 1 : 0]) : null)),
      h('td', { class: 'c-project' }, tk._project),
      h('td', { class: 'c-status' }, statusBadge(tk.status)),
      h('td', { class: 'c-prio' }, priorityBadge(tk.priority)),
      h('td', { class: 'c-due' }, dueCell(tk)),
      h('td', { class: 'c-progress' }, progressBar(tk.progress)));
  }

  function drawList(rows) {
    const people = personById();
    const now = new Date();
    const tbody = h('tbody');
    const cols = ctx.isAdmin ? 8 : 7;
    let shown = 0;

    // Çok görevde gruplar kapalı başlar (başlıklar ve sayılar görünür; tıklayınca açılır)
    const defaultOpen = rows.length <= 300;
    if (state.group) {
      const groups = new Map();
      for (const tk of rows) {
        const k = groupKey(tk);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(tk);
      }
      const order = state.group === 'directorate'
        ? store.lookups.filter((l) => l.kind === 'directorate').map((l) => l.value)
        : state.group === 'project' ? store.projects.map((p) => p.name) : [];
      const keys = [...groups.keys()].sort((a, b) => {
        const ia = order.indexOf(a); const ib = order.indexOf(b);
        if (ia !== ib) return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
        return a.localeCompare(b, 'tr');
      });
      for (const k of keys) {
        const list = groups.get(k);
        const isOpen = defaultOpen !== toggled.has(k);
        const done = list.filter((x) => x.status === 'done').length;
        tbody.append(h('tr', { class: 'group-row' }, h('th', { colspan: cols, scope: 'rowgroup' },
          h('button', { type: 'button', class: 'group-btn', 'aria-expanded': String(isOpen), onclick: () => {
            if (toggled.has(k)) toggled.delete(k); else toggled.add(k);
            draw();
          } }, icon(isOpen ? 'chevronDown' : 'chevron', 'icon-sm'), h('span', {}, k),
          h('span', { class: 'quick-n' }, String(list.length)),
          h('span', { class: 'muted small' }, t('tasks.group_done', { n: done }))))));
        if (!isOpen) continue;
        for (const tk of list) {
          if (shown >= limit) break;
          tbody.append(taskRow(tk, people, now));
          shown++;
        }
      }
    } else {
      for (const tk of rows.slice(0, limit)) { tbody.append(taskRow(tk, people, now)); shown++; }
    }

    const visibleTotal = state.group ? rows.filter((x) => defaultOpen !== toggled.has(groupKey(x))).length : rows.length;
    const more = visibleTotal > shown
      ? h('div', { class: 'load-more' },
        h('button', { class: 'btn', type: 'button', onclick: () => { limit += PAGE * 2; draw(); } },
          t('tasks.show_more', { n: Math.min(PAGE * 2, visibleTotal - shown) })),
        h('span', { class: 'muted small' }, t('tasks.shown_of', { n: shown, total: visibleTotal })))
      : null;

    const wrap = h('div', { class: 'table-wrap' }, h('table', { class: 'task-table' },
      h('thead', {}, h('tr', {},
        ctx.isAdmin ? h('th', { scope: 'col', class: 'c-sel' }, h('span', { class: 'sr-only' }, t('bulk.select'))) : null,
        sortHeader('code', t('tasks.col_no'), 'c-no'), sortHeader('title', t('tasks.col_title')), sortHeader('project', t('tasks.col_project')),
        sortHeader('status', t('tasks.col_status')), sortHeader('priority', t('tasks.col_priority')), sortHeader('due', t('tasks.col_due')),
        sortHeader('progress', t('tasks.col_progress')))),
      tbody), more);
    content.append(wrap);

    // Listenin sonuna gelince sıradaki parça kendiliğinden yüklenir.
    // Bilgisayarda liste kendi kutusunda kayar (kök = kutu); telefonda sayfa kayar (kök = ekran).
    if (more && 'IntersectionObserver' in window) {
      requestAnimationFrame(() => {
        if (!more.isConnected) return;
        const scrolls = /(auto|scroll)/.test(getComputedStyle(wrap).overflowY) && wrap.scrollHeight > wrap.clientHeight + 1;
        const io = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting)) { io.disconnect(); limit += PAGE * 2; draw(); }
        }, { root: scrolls ? wrap : null, rootMargin: '300px' });
        io.observe(more);
        observers.push(io);
      });
    }
  }
  const observers = [];
  const stopObservers = () => { observers.splice(0).forEach((o) => o.disconnect()); };

  // ---- Kanban
  const expanded = new Set();
  function drawKanban(rows) {
    const board = h('div', { class: 'kanban' });
    for (const st of STATUS_ORDER) {
      const items = rows.filter((x) => x.status === st);
      const shown = expanded.has(st) ? items.slice(0, KANBAN_LIMIT * 10) : items.slice(0, KANBAN_LIMIT);
      const col = h('section', { class: `kcol kcol-${st}`, dataset: { status: st }, 'aria-label': label('status', st, getLang()) },
        h('header', { class: 'kcol-head' }, statusBadge(st), h('span', { class: 'quick-n' }, String(items.length))));
      const list = h('div', { class: 'kcol-list' });
      for (const tk of shown) {
        const editable = canEdit(ctx, tk);
        const info = dueInfo(tk);
        const card = h('article', { class: `kcard ${info?.tone === 'overdue' ? 'is-overdue' : ''}`, draggable: editable ? 'true' : null, dataset: { task: tk.id } },
          h('div', { class: 'kcard-top' }, codeTag(tk), priorityBadge(tk.priority)),
          h('a', { class: 'kcard-title', href: `#/gorev/${tk.id}` }, tk.title),
          h('div', { class: 'muted small' }, [tk.directorate, tk._project].filter(Boolean).join(' · ')),
          h('div', { class: 'kcard-meta' },
            info ? h('span', { class: `due-tag due-${info.tone}` }, info.tone === 'overdue' ? icon('alert') : icon('clock'), info.text)
              : tk.due_date ? h('span', { class: 'muted small' }, fmtDate(tk.due_date)) : null),
          tk.progress ? progressBar(tk.progress) : null);
        if (editable) {
          card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', tk.id); e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); });
          card.addEventListener('dragend', () => card.classList.remove('dragging'));
        }
        list.append(card);
      }
      if (items.length > shown.length) {
        list.append(h('button', { class: 'btn btn-link', type: 'button', onclick: () => { expanded.add(st); draw(); } },
          expanded.has(st) ? t('tasks.kanban_narrow', { n: items.length - shown.length }) : t('tasks.show_more', { n: Math.min(items.length - shown.length, KANBAN_LIMIT * 9) })));
      }
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', (e) => {
        e.preventDefault(); col.classList.remove('drop');
        const id = e.dataTransfer.getData('text/plain');
        const tk = store.tasks.get(id);
        if (tk && tk.status !== st && canEdit(ctx, tk)) setStatus(id, st);
      });
      col.append(list);
      board.append(col);
    }
    content.append(board);
  }

  const drawAll = draw;
  drawViewToggle();
  drawFilters();
  drawAll();

  // Realtime ile gelen değişiklikler: art arda gelirse tek çizim
  let dataTimer;
  const offData = on('data', () => {
    clearTimeout(dataTimer);
    dataTimer = setTimeout(() => { if (!document.querySelector('.filters :focus, .bulk-bar :focus')) drawAll(); }, 250);
  });
  if (ctx.openTaskId) openDetail(ctx.openTaskId, ctx);

  // Telefonda büyük "+" düğmesi
  const fab = ctx.isAdmin ? h('button', { class: 'fab', type: 'button', 'aria-label': t('tasks.new'), onclick: () => newTaskDialog(ctx) }, icon('plus')) : null;
  if (fab) document.body.append(fab);

  return () => { clearTimeout(timer); clearTimeout(dataTimer); stopObservers(); offData(); closeDetail(false); fab?.remove(); };
}

// Aynı sayfadayken adres değişti (görev açıldı/kapandı): sayfayı yeniden çizmeden detayı aç/kapat
export function update(ctx) {
  if (ctx.openTaskId) openDetail(ctx.openTaskId, ctx);
  else if (isDetailOpen()) closeDetail(false);
}
