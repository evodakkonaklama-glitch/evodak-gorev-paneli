// Excel içe aktarma: dosya seç → önizleme → onay → kaydet → (isterseniz) geri al
import { h, clear, icon, spinner, toast, confirmDialog } from './ui.js';
import { t } from './i18n.js';
import { supabase, fetchAll, friendlyError } from './supabase.js';
import { parseWorkbook, diffWithExisting, buildPayload, norm } from './excel-format.js';
import { fmtDateTime } from './dates.js';
import { reloadAll } from './store.js';

const MAX_FILE = 10 * 1024 * 1024;
const LIST_LIMIT = 100;

export async function render(root, ctx) {
  const page = h('section', { class: 'page page-narrow' });
  root.append(page);
  if (!ctx.isAdmin) {
    page.append(h('div', { class: 'notice notice-warn' }, icon('alert'), h('p', {}, t('import.admin_only'))));
    return null;
  }
  await showStart(page);
  return null;
}

async function showStart(page) {
  clear(page);
  const input = h('input', { type: 'file', accept: '.xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', class: 'sr-only', id: 'xlsx-file' });
  const drop = h('label', { class: 'dropzone', for: 'xlsx-file' },
    icon('upload', 'icon-lg'),
    h('span', { class: 'btn btn-primary', role: 'presentation' }, t('import.choose')),
    h('span', { class: 'muted' }, t('import.drop')));
  input.addEventListener('change', () => { if (input.files[0]) handleFile(page, input.files[0]); });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('drag');
    const f = e.dataTransfer.files[0]; if (f) handleFile(page, f);
  });

  const last = h('div');
  page.append(
    h('h1', { class: 'h1' }, t('import.title')),
    h('p', { class: 'muted' }, t('import.help')),
    input, drop, last);

  const { data } = await supabase.from('import_batches').select('id,file_name,created_at,undone_at')
    .is('undone_at', null).order('created_at', { ascending: false }).limit(1);
  if (data && data[0]) {
    const b = data[0];
    last.append(h('div', { class: 'card row-between' },
      h('span', {}, t('import.last', { file: b.file_name || '—', when: fmtDateTime(b.created_at) })),
      h('button', { class: 'btn', type: 'button', onclick: () => undo(page, b.id) }, t('import.undo'))));
  }
}

async function handleFile(page, file) {
  clear(page);
  if (file.size > MAX_FILE) { fail(page, t('import.too_big')); return; }
  page.append(spinner(t('import.reading')));

  let wb;
  try {
    const buf = await file.arrayBuffer();
    wb = window.XLSX.read(buf, { type: 'array' });
  } catch (err) {
    console.error(err);
    fail(page, t('import.fatal.read'));
    return;
  }

  try {
    const [profiles, projects, tplCount] = await Promise.all([
      fetchAll(() => supabase.from('profiles').select('id,full_name,email').order('full_name')),
      fetchAll(() => supabase.from('projects').select('id,name').order('sort_order')),
      supabase.from('task_templates').select('id', { count: 'exact', head: true }),
    ]);
    const parsed = parseWorkbook(window.XLSX, wb, { existingPeople: profiles.map((p) => p.full_name), fileName: file.name });
    if (parsed.fatal) { fail(page, t(`import.fatal.${parsed.fatal}`, { v: parsed.fatalValue })); return; }

    clear(page).append(spinner(t('import.comparing')));
    const existing = await loadExisting(projects, profiles);
    const diff = diffWithExisting(parsed, existing);
    showPreview(page, parsed, diff, { profiles, projects, templatesExist: (tplCount.count || 0) > 0 });
  } catch (err) {
    console.error(err);
    fail(page, friendlyError(err));
  }
}

async function loadExisting(projects, profiles) {
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const personName = new Map(profiles.map((p) => [p.id, p.full_name]));
  const [tasks, items] = await Promise.all([
    fetchAll(() => supabase.from('tasks')
      .select('id,no,project_id,section,category,title,description,tags,status,priority,assignee_id,start_date,due_date,estimate_minutes,recurrence,recurrence_day,reminder,reference_links,deleted_at')
      .order('no')),
    fetchAll(() => supabase.from('checklist_items').select('task_id,text,note,done,sort_order').order('task_id').order('sort_order')),
  ]);
  const itemsByTask = new Map();
  for (const it of items) {
    if (!itemsByTask.has(it.task_id)) itemsByTask.set(it.task_id, []);
    itemsByTask.get(it.task_id).push(it);
  }
  return tasks.map((tk) => ({
    ...tk,
    project: projectName.get(tk.project_id) || '',
    assignee: tk.assignee_id ? personName.get(tk.assignee_id) || '' : '',
    checklist: itemsByTask.get(tk.id) || [],
    deleted: Boolean(tk.deleted_at),
  }));
}

function fail(page, message) {
  clear(page).append(
    h('h1', { class: 'h1' }, t('import.title')),
    h('div', { class: 'notice notice-error', role: 'alert' }, icon('alert'), h('p', {}, message)),
    h('button', { class: 'btn', type: 'button', onclick: () => showStart(page) }, t('import.cancel')));
}

function stat(labelText, value, tone = '') {
  return h('div', { class: `stat ${tone}` }, h('span', { class: 'stat-value' }, String(value)), h('span', { class: 'stat-label' }, labelText));
}

function reasonText(e) { return t(e.reason, { v: e.value ?? '' }); }

function table(headers, rows) {
  const shown = rows.slice(0, LIST_LIMIT);
  return h('div', {},
    h('div', { class: 'table-wrap' }, h('table', { class: 'simple-table' },
      h('thead', {}, h('tr', {}, headers.map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', {}, shown.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))))),
    rows.length > LIST_LIMIT ? h('p', { class: 'muted small' }, t('import.more', { n: rows.length - LIST_LIMIT })) : null);
}

function showPreview(page, parsed, diff, { profiles, projects, templatesExist }) {
  clear(page);
  const writeCount = diff.toInsert.length + diff.toUpdate.length;
  const items = [...diff.toInsert, ...diff.toUpdate.map((u) => u.task)].reduce((s, tk) => s + tk.checklist.length, 0);
  const newProjects = parsed.projects.filter((p) => !projects.some((x) => norm(x.name) === norm(p.name))).length;
  const newPeople = parsed.people.filter((p) => !profiles.some((x) => (p.email && norm(x.email) === norm(p.email)) || norm(x.full_name) === norm(p.full_name))).length;

  page.append(
    h('h1', { class: 'h1' }, t('import.preview', { file: parsed.fileName })),
    h('div', { class: 'stats' },
      stat(t('import.to_insert'), diff.toInsert.length, 'tone-green'),
      stat(t('import.to_update'), diff.toUpdate.length, 'tone-amber'),
      stat(t('import.unchanged'), diff.unchanged.length),
      stat(t('import.errors'), parsed.errors.length, parsed.errors.length ? 'tone-red' : '')),
    h('div', { class: 'stats stats-small' },
      stat(t('import.checklist_items'), items),
      stat(t('import.projects'), `${parsed.projects.length}${newProjects ? ` (+${newProjects})` : ''}`),
      stat(t('import.people'), `${parsed.people.length}${newPeople ? ` (+${newPeople})` : ''}`),
      templatesExist ? null : stat(t('import.templates'), parsed.templates.length)));

  if (diff.notInFile) page.append(h('p', { class: 'notice' }, icon('alert'), h('span', {}, t('import.not_in_file', { n: diff.notInFile }))));

  if (parsed.errors.length) {
    page.append(h('h2', { class: 'h2 tone-red-text' }, t('import.error_list')),
      table([t('import.col_row'), t('import.col_no'), t('import.col_reason')],
        parsed.errors.map((e) => [`${e.sheet} ${e.row}`, e.no || '—', reasonText(e)])));
  }
  if (diff.toUpdate.length) {
    page.append(h('details', { class: 'details' }, h('summary', {}, `${t('import.update_list')} (${diff.toUpdate.length})`),
      table([t('import.col_no'), t('tasks.col_title'), t('import.col_fields')],
        diff.toUpdate.map((u) => [u.task.no, u.task.title, u.changed.map((f) => t(`field.${f}`)).join(', ')]))));
  }
  if (parsed.warnings.length) {
    page.append(h('details', { class: 'details' }, h('summary', {}, `${t('import.warning_list')} (${parsed.warnings.length})`),
      table([t('import.col_row'), t('import.col_no'), t('import.col_reason')],
        parsed.warnings.map((w) => [w.row, w.no, reasonText(w)]))));
  }

  const actions = h('div', { class: 'actions sticky-actions' },
    h('button', { class: 'btn', type: 'button', onclick: () => showStart(page) }, t('import.cancel')));
  if (writeCount) {
    const go = h('button', { class: 'btn btn-primary', type: 'button' },
      parsed.errors.length ? t('import.confirm_errors', { n: writeCount, e: parsed.errors.length }) : t('import.confirm', { n: writeCount }));
    go.addEventListener('click', () => save(page, buildPayload(parsed, diff)));
    actions.append(go);
  } else {
    page.append(h('p', { class: 'notice notice-ok' }, icon('check'), h('span', {}, t('import.nothing'))));
  }
  page.append(actions);
}

async function save(page, payload) {
  clear(page).append(spinner(t('import.saving')));
  const { data, error } = await supabase.rpc('import_excel', { p: payload });
  if (error) { fail(page, friendlyError(error)); return; }
  await reloadAll();
  clear(page).append(
    h('div', { class: 'state' },
      icon('check', 'icon-lg tone-green-text'),
      h('h1', { class: 'h2' }, t('import.done_title')),
      h('p', {}, t('import.done_body', { ins: data.inserted, upd: data.updated, tpl: data.templates })),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => undo(page, data.batch_id) }, t('import.undo')),
        h('a', { class: 'btn btn-primary', href: '#/gorevler' }, t('import.go_tasks')))));
}

async function undo(page, batchId) {
  const ok = await confirmDialog(t('import.undo_confirm'), { confirmLabel: t('import.undo'), danger: true });
  if (!ok) return;
  clear(page).append(spinner());
  const { data, error } = await supabase.rpc('undo_import', { p_batch: batchId });
  if (error) { fail(page, friendlyError(error)); return; }
  await reloadAll();
  toast(t('import.undone', { del: data.deleted, res: data.restored }), { type: 'ok', timeout: 6000 });
  showStart(page);
}

