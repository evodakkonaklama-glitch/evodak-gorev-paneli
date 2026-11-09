// Görevler: liste (telefonda kart) ve Kanban; filtre, arama, sıralama, hızlı görünümler
import { h, clear, icon, spinner } from './ui.js';
import { t, getLang } from './i18n.js';
import { label, searchFold } from './excel-format.js';
import { fmtDate, fmtTime, dueInfo, todayIso, istanbulToDate } from './dates.js';
import { store, on, setStatus, checklistCounts } from './store.js';
import { openDetail, closeDetail, isDetailOpen, newTaskDialog } from './task-detail.js';

export const STATUS_ORDER = ['todo', 'in_progress', 'waiting', 'blocked', 'done', 'cancelled'];
const PRIORITY_ORDER = ['urgent', 'high', 'medium', 'low'];
const STATUS_ICON = { todo: 'circle', in_progress: 'play', waiting: 'pause', blocked: 'block', done: 'check', cancelled: 'x' };
const PRIORITY_ICON = { urgent: 'alert', high: 'arrowUp', medium: 'minus', low: 'arrowDown' };
const KANBAN_LIMIT = 60;
const STATE_KEY = 'evodak.taskView';

const DEFAULT_STATE = { view: 'list', quick: 'all', q: '', project: '', section: '', category: '', status: '', priority: '', assignee: '', tag: '', from: '', to: '', sort: 'no', dir: 1, filtersOpen: false };
const state = (() => {
  try { return { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem(STATE_KEY) || '{}'), q: '' }; } catch { return { ...DEFAULT_STATE }; }
})();
function saveState() { try { const { q, ...rest } = state; localStorage.setItem(STATE_KEY, JSON.stringify(rest)); } catch { /* yok say */ } }

// ---------------------------------------------------------------- küçük parçalar
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
    task.recurrence !== 'once' ? h('span', { class: 'chip chip-repeat' }, icon('repeat'), label('recurrence', task.recurrence, getLang())) : null,
    info ? h('span', { class: `due-tag due-${info.tone}` }, info.tone === 'overdue' ? icon('alert') : icon('clock'), info.text) : null);
}

export function canEdit(ctx, task) {
  return ctx.isAdmin || (ctx.profile.role === 'member' && task.assignee_id === ctx.profile.id);
}

function isOverdue(tk, now) {
  return tk.due_date && !['done', 'cancelled'].includes(tk.status) && istanbulToDate(tk.due_date, tk.due_time) < now;
}

// ---------------------------------------------------------------- filtreleme
function quickMatch(tk, quick, ctx, today, now) {
  switch (quick) {
    case 'today': return tk.due_date === today;
    case 'overdue': return isOverdue(tk, now);
    case 'mine': return tk.assignee_id === ctx.profile.id;
    case 'done': return tk.status === 'done';
    default: return true;
  }
}

function applyFilters(tasks, ctx) {
  const q = searchFold(state.q);
  const today = todayIso(); const now = new Date();
  return tasks.filter((tk) => quickMatch(tk, state.quick, ctx, today, now)
    && (!q || tk._search.includes(q))
    && (!state.project || tk.project_id === state.project)
    && (!state.section || tk.section === state.section)
    && (!state.category || tk.category === state.category)
    && (!state.status || tk.status === state.status)
    && (!state.priority || tk.priority === state.priority)
    && (!state.assignee || (state.assignee === '-' ? !tk.assignee_id : tk.assignee_id === state.assignee))
    && (!state.tag || (tk.tags || []).includes(state.tag))
    && (!state.from || (tk.due_date && tk.due_date >= state.from))
    && (!state.to || (tk.due_date && tk.due_date <= state.to)));
}

function sortTasks(list, projectOrder) {
  const d = state.dir;
  const key = {
    no: (x) => x.no,
    title: (x) => x._titleKey,
    project: (x) => projectOrder.get(x.project_id) ?? 999,
    status: (x) => STATUS_ORDER.indexOf(x.status),
    priority: (x) => PRIORITY_ORDER.indexOf(x.priority),
    due: (x) => (x.due_date ? `${x.due_date} ${x.due_time || ''}` : '9999'),
    progress: (x) => x.progress,
  }[state.sort] || ((x) => x.no);
  return list.sort((a, b) => {
    const ka = key(a); const kb = key(b);
    if (ka < kb) return -d; if (ka > kb) return d;
    return a.no - b.no;
  });
}

// Başka ekrandan (Projeler) filtreyle görev listesine gitmek için
export function setTaskFilter(patch) {
  ['project', 'section', 'category', 'status', 'priority', 'assignee', 'tag', 'from', 'to'].forEach((k) => { state[k] = ''; });
  Object.assign(state, { quick: 'all', q: '' }, patch);
  saveState();
}

function activeFilterCount() {
  return ['project', 'section', 'category', 'status', 'priority', 'assignee', 'tag', 'from', 'to'].filter((k) => state[k]).length;
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

  // Arama metni ve sıralama anahtarı: veri değişince yeniden hesaplanır
  function decorate() {
    const projects = projectById();
    for (const tk of store.tasks.values()) {
      tk._project = projects.get(tk.project_id)?.name || '';
      tk._titleKey = searchFold(tk.title);
      tk._search = searchFold([tk.no, tk.title, tk.description, tk._project, tk.section, tk.category, (tk.tags || []).join(' ')].join(' '));
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
  const content = h('div', { class: 'list-box' });

  page.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', { class: 'h1' }, t('tasks.title')), count),
      ctx.isAdmin ? h('button', { class: 'btn btn-primary hide-mobile', type: 'button', onclick: () => newTaskDialog(ctx) }, icon('plus'), t('tasks.new')) : null),
    quickBar,
    h('div', { class: 'toolbar toolbar-3' }, h('div', { class: 'search-wrap' }, icon('search'), search), filterBtn, viewToggle),
    filterPanel,
    content);

  // Satırın herhangi bir yerine tıklayınca görevi aç
  content.addEventListener('click', (e) => {
    const row = e.target.closest('.task-row');
    if (!row || e.target.closest('a, button, input, select')) return;
    location.hash = `#/gorev/${row.dataset.task}`;
  });

  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { state.q = search.value; draw(); }, 120); });
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

  function select(key, labelText, options) {
    const id = `f-${key}`;
    const el = h('select', { id, class: 'input' }, h('option', { value: '' }, t('tasks.any')),
      options.map(([v, txt]) => h('option', { value: v, selected: state[key] === v }, txt)));
    el.addEventListener('change', () => { state[key] = el.value; saveState(); draw(); });
    return h('div', { class: 'field' }, h('label', { for: id }, labelText), el);
  }
  function dateInput(key, labelText) {
    const id = `f-${key}`;
    const el = h('input', { id, type: 'date', class: 'input', value: state[key] });
    el.addEventListener('change', () => { state[key] = el.value; saveState(); draw(); });
    return h('div', { class: 'field' }, h('label', { for: id }, labelText), el);
  }

  function drawFilters() {
    const lang = getLang();
    const all = [...store.tasks.values()];
    const uniq = (arr) => [...new Set(arr.filter(Boolean))];
    const lookups = (kind) => store.lookups.filter((l) => l.kind === kind).map((l) => l.value);
    const sections = uniq([...lookups('section'), ...all.map((x) => x.section)]);
    const categories = uniq([...lookups('category'), ...all.map((x) => x.category)]);
    const tags = uniq(all.flatMap((x) => x.tags || [])).sort((a, b) => a.localeCompare(b, 'tr'));
    clear(filterPanel).append(
      h('div', { class: 'filter-grid' },
        select('project', t('tasks.col_project'), store.projects.map((p) => [p.id, p.name])),
        select('section', t('tasks.section'), sections.map((s) => [s, s])),
        select('category', t('tasks.category'), categories.map((s) => [s, s])),
        select('status', t('tasks.col_status'), STATUS_ORDER.map((s) => [s, label('status', s, lang)])),
        select('priority', t('tasks.col_priority'), PRIORITY_ORDER.map((s) => [s, label('priority', s, lang)])),
        select('assignee', t('tasks.assignee'), [['-', t('tasks.unassigned')], ...store.profiles.filter((p) => p.active !== false).map((p) => [p.id, p.full_name])]),
        select('tag', t('tasks.tags'), tags.map((s) => [s, s])),
        dateInput('from', t('tasks.due_from')),
        dateInput('to', t('tasks.due_to'))),
      h('div', { class: 'row-wrap' }, h('button', { class: 'btn btn-link', type: 'button', onclick: () => {
        ['project', 'section', 'category', 'status', 'priority', 'assignee', 'tag', 'from', 'to'].forEach((k) => { state[k] = ''; });
        saveState(); drawFilters(); draw();
      } }, t('tasks.clear_filters'))));
  }

  function drawQuick(all) {
    const today = todayIso(); const now = new Date();
    const items = [['all', t('tasks.q_all')], ['today', t('tasks.q_today')], ['overdue', t('tasks.q_overdue')], ['mine', t('tasks.q_mine')], ['done', t('tasks.q_done')]];
    clear(quickBar).append(...items.map(([k, txt]) => {
      const n = all.filter((tk) => quickMatch(tk, k, ctx, today, now)).length;
      return h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.quick === k), class: `quick-btn ${state.quick === k ? 'active' : ''} ${k === 'overdue' && n ? 'has-overdue' : ''}`,
        onclick: () => { state.quick = k; saveState(); draw(); } }, txt, h('span', { class: 'quick-n' }, String(n)));
    }));
  }

  function draw() {
    decorate();
    const all = [...store.tasks.values()];
    const projects = projectById();
    const projectOrder = new Map(store.projects.map((p, i) => [p.id, i]));
    drawQuick(all);
    const n = activeFilterCount();
    clear(filterBtn).append(icon('filter'), h('span', {}, t('tasks.filters')), n ? h('span', { class: 'quick-n' }, String(n)) : null);
    const rows = sortTasks(applyFilters(all, ctx), projectOrder);
    count.textContent = rows.length === all.length ? t('tasks.count', { n: all.length }) : t('tasks.count_of', { n: rows.length, total: all.length });

    const scrollEl = content.querySelector('.table-wrap, .kanban');
    const scroll = scrollEl ? [scrollEl.scrollTop, scrollEl.scrollLeft] : null;
    clear(content);
    if (!rows.length) {
      content.append(h('div', { class: 'state' }, h('p', {}, t('tasks.no_results')),
        h('button', { class: 'btn', type: 'button', onclick: () => {
          Object.assign(state, { q: '', quick: 'all' }); search.value = '';
          ['project', 'section', 'category', 'status', 'priority', 'assignee', 'tag', 'from', 'to'].forEach((k) => { state[k] = ''; });
          saveState(); drawFilters(); draw();
        } }, t('tasks.clear_filters'))));
      return;
    }
    if (state.view === 'kanban') drawKanban(rows, projects); else drawList(rows);
    const newEl = content.querySelector('.table-wrap, .kanban');
    if (scroll && newEl) { newEl.scrollTop = scroll[0]; newEl.scrollLeft = scroll[1]; }
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

  function drawList(rows) {
    const people = personById();
    const tbody = h('tbody');
    const now = new Date();
    for (const tk of rows) {
      const c = checklistCounts(tk.id);
      const overdue = isOverdue(tk, now);
      tbody.append(h('tr', { class: `task-row ${overdue ? 'is-overdue' : ''} ${tk.status === 'done' ? 'is-done' : ''}`, dataset: { task: tk.id } },
        h('td', { class: 'c-no' }, tk.no),
        h('td', { class: 'c-title' },
          h('a', { class: 'row-link', href: `#/gorev/${tk.id}` }, tk.title),
          h('div', { class: 'sub muted' }, [tk.section, tk.category].filter(Boolean).join(' · '),
            c.total ? h('span', { class: 'chip' }, icon('check', 'icon-sm'), `${c.done}/${c.total}`) : null,
            tk.assignee_id ? h('span', { class: 'chip' }, people.get(tk.assignee_id) || '') : null)),
        h('td', { class: 'c-project' }, tk._project),
        h('td', { class: 'c-status' }, statusBadge(tk.status)),
        h('td', { class: 'c-prio' }, priorityBadge(tk.priority)),
        h('td', { class: 'c-due' }, dueCell(tk)),
        h('td', { class: 'c-progress' }, progressBar(tk.progress))));
    }
    content.append(h('div', { class: 'table-wrap' }, h('table', { class: 'task-table' },
      h('thead', {}, h('tr', {},
        sortHeader('no', t('tasks.col_no'), 'c-no'), sortHeader('title', t('tasks.col_title')), sortHeader('project', t('tasks.col_project')),
        sortHeader('status', t('tasks.col_status')), sortHeader('priority', t('tasks.col_priority')), sortHeader('due', t('tasks.col_due')),
        sortHeader('progress', t('tasks.col_progress')))),
      tbody)));
  }

  // ---- Kanban
  const expanded = new Set();
  function drawKanban(rows) {
    const board = h('div', { class: 'kanban' });
    for (const st of STATUS_ORDER) {
      const items = rows.filter((x) => x.status === st);
      const shown = expanded.has(st) ? items : items.slice(0, KANBAN_LIMIT);
      const col = h('section', { class: `kcol kcol-${st}`, dataset: { status: st }, 'aria-label': label('status', st, getLang()) },
        h('header', { class: 'kcol-head' }, statusBadge(st), h('span', { class: 'quick-n' }, String(items.length))));
      const list = h('div', { class: 'kcol-list' });
      for (const tk of shown) {
        const editable = canEdit(ctx, tk);
        const info = dueInfo(tk);
        const card = h('article', { class: `kcard ${info?.tone === 'overdue' ? 'is-overdue' : ''}`, draggable: editable ? 'true' : null, dataset: { task: tk.id } },
          h('a', { class: 'kcard-title', href: `#/gorev/${tk.id}` }, tk.title),
          h('div', { class: 'muted small' }, tk._project),
          h('div', { class: 'kcard-meta' }, priorityBadge(tk.priority),
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
        list.append(h('button', { class: 'btn btn-link', type: 'button', onclick: () => { expanded.add(st); draw(); } }, t('tasks.show_more', { n: items.length - shown.length })));
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

  drawViewToggle();
  drawFilters();
  draw();

  const offData = on('data', () => { if (!document.querySelector('.filters :focus')) draw(); });
  const offLang = () => {};
  if (ctx.openTaskId) openDetail(ctx.openTaskId, ctx);

  // Telefonda büyük "+" düğmesi
  const fab = ctx.isAdmin ? h('button', { class: 'fab', type: 'button', 'aria-label': t('tasks.new'), onclick: () => newTaskDialog(ctx) }, icon('plus')) : null;
  if (fab) document.body.append(fab);

  return () => { clearTimeout(timer); offData(); offLang(); closeDetail(false); fab?.remove(); };
}

// Aynı sayfadayken adres değişti (görev açıldı/kapandı): sayfayı yeniden çizmeden detayı aç/kapat
export function update(ctx) {
  if (ctx.openTaskId) openDetail(ctx.openTaskId, ctx);
  else if (isDetailOpen()) closeDetail(false);
}
