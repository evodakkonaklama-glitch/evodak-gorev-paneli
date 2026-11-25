// Excel içe aktarma: dosya seç → önizleme → onay → (yedek) → parça parça kaydet → (isterseniz) geri al
// ERA "Görev Takip" (25 sütun) ve eski 18 sütunlu dosya okunur; görevler ID (kod) ile eşlenir.
import { h, clear, icon, spinner, toast, confirmDialog } from './ui.js';
import { t } from './i18n.js';
import { supabase, fetchAll, friendlyError } from './supabase.js';
import { parseWorkbook, diffWithExisting, buildPayloadChunks, norm, personMatcher, label } from './excel-format.js';
import { getLang } from './i18n.js';
import { fmtDateTime } from './dates.js';
import { reloadAll } from './store.js';
import { callFn } from './people.js';

const MAX_FILE = 15 * 1024 * 1024;
const LIST_LIMIT = 100;
const CHUNK = 500;

let ctxRef = null;

export async function render(root, ctx) {
  ctxRef = ctx;
  const page = h('section', { class: 'page page-narrow' });
  root.append(page);
  if (!ctx.isAdmin) {
    page.append(h('div', { class: 'notice notice-warn' }, icon('alert'), h('p', {}, t('import.admin_only'))));
    return null;
  }
  await showStart(page);
  return null;
}

const isOwner = () => ctxRef?.profile?.role === 'owner';

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
      fetchAll(() => supabase.from('projects').select('id,name,code_prefix,archived').order('sort_order')),
      supabase.from('task_templates').select('id', { count: 'exact', head: true }),
    ]);
    const parsed = parseWorkbook(window.XLSX, wb, { existingPeople: profiles.map((p) => p.full_name), fileName: file.name });
    if (parsed.fatal) { fail(page, t(`import.fatal.${parsed.fatal}`, { v: parsed.fatalValue })); return; }

    clear(page).append(spinner(t('import.comparing')));
    const existing = await loadExisting(projects, profiles);
    // Excel'deki "Hakan" ile paneldeki "Hakan Günsür" aynı kişi sayılır
    const matches = (excelName, fullName) => Boolean(fullName) && personMatcher([fullName])(excelName);
    const diff = diffWithExisting(parsed, existing, matches);
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
      .select('id,no,code,project_id,directorate,section,category,task_class,title,description,tags,status,priority,progress,assignee_id,co_assignee_ids,start_date,due_date,estimate_minutes,quantity,recurrence,freq_count,recurrence_day,reminder,reference_links,deleted_at')
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
    co_assignees: (tk.co_assignee_ids || []).map((id) => personName.get(id)).filter(Boolean),
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

function checkbox(text, hint, checked = false) {
  const input = h('input', { type: 'checkbox', checked });
  return { input, el: h('label', { class: 'check-row' }, input, h('span', {}, h('strong', {}, text), hint ? h('span', { class: 'muted small block' }, hint) : null)) };
}

function showPreview(page, parsed, diff, { profiles, projects, templatesExist }) {
  clear(page);
  const writeCount = diff.toInsert.length + diff.toUpdate.length;
  const items = [...diff.toInsert, ...diff.toUpdate.map((u) => u.task)].reduce((s, tk) => s + (tk.checklist || []).length, 0);
  // Adı değişecek projeler: dosyadaki ad panelde yok ama aynı kod önekli proje var
  const fileNames = new Set(parsed.projects.map((p) => norm(p.name)));
  const renames = parsed.projects.map((p) => {
    if (projects.some((x) => norm(x.name) === norm(p.name)) || !p.code_prefix) return null;
    const old = projects.find((x) => (x.code_prefix || '').toLocaleUpperCase('tr') === p.code_prefix && !fileNames.has(norm(x.name)));
    return old ? { from: old.name, to: p.name } : null;
  }).filter(Boolean);
  const newProjects = parsed.projects.filter((p) => !projects.some((x) => norm(x.name) === norm(p.name)) && !renames.some((r) => r.to === p.name));
  const coCount = parsed.tasks.filter((x) => (x.co_assignees || []).length).length;
  const newPeople = parsed.people.filter((p) => !profiles.some((x) => (p.email && norm(x.email) === norm(p.email)) || norm(x.full_name) === norm(p.full_name))).length;
  const dirCount = parsed.lookups.filter((l) => l.kind === 'directorate').length;

  page.append(
    h('h1', { class: 'h1' }, t('import.preview', { file: parsed.fileName })),
    h('p', { class: 'muted' }, t(parsed.format === 'era' ? 'import.format_era' : 'import.format_legacy')),
    h('div', { class: 'stats' },
      stat(t('import.to_insert'), diff.toInsert.length, 'tone-green'),
      stat(t('import.to_update'), diff.toUpdate.length, 'tone-amber'),
      stat(t('import.unchanged'), diff.unchanged.length),
      stat(t('import.errors'), parsed.errors.length, parsed.errors.length ? 'tone-red' : '')),
    h('div', { class: 'stats stats-small' },
      dirCount ? stat(t('import.directorates'), dirCount) : null,
      stat(t('import.projects'), `${parsed.projects.length}${newProjects.length ? ` (+${newProjects.length})` : ''}`),
      items ? stat(t('import.checklist_items'), items) : null,
      coCount ? stat(t('import.co_tasks'), coCount) : null,
      parsed.people.length ? stat(t('import.people'), `${parsed.people.length}${newPeople ? ` (+${newPeople})` : ''}`) : null));

  if (renames.length) {
    page.append(h('details', { class: 'details', open: true }, h('summary', {}, `${t('import.renames')} (${renames.length})`),
      h('ul', { class: 'plain-list' }, renames.map((r) => h('li', {}, `${r.from} → `, h('strong', {}, r.to))))));
  }
  if (newProjects.length) {
    page.append(h('details', { class: 'details' }, h('summary', {}, `${t('import.new_projects')} (${newProjects.length})`),
      h('ul', { class: 'plain-list' }, newProjects.map((p) => h('li', {}, `${p.name}${p.code_prefix ? ` · ${p.code_prefix}` : ''}`)))));
  }

  // Tam değiştirme (yalnızca owner): dosyada olmayanlar çöp kutusuna
  let replace = null;
  if (diff.notInFile) {
    if (isOwner()) {
      replace = checkbox(t('import.replace', { n: diff.notInFile }), t('import.replace_hint'));
      page.append(h('div', { class: 'card card-warn' }, replace.el));
    } else {
      page.append(h('p', { class: 'notice' }, icon('alert'), h('span', {}, t('import.not_in_file', { n: diff.notInFile }))));
    }
  }

  // Şablonlar: dosyadan yeniden oluştur
  let tpl = null;
  if (parsed.templates.length) {
    const byType = ['web', 'panel', 'is_plani'].map((k) => `${label('project_type', k, getLang())} ${parsed.templates.filter((x) => x.project_type === k).length}`).join(' · ');
    tpl = checkbox(t('import.templates_rebuild', { n: parsed.templates.length }), `${byType}. ${t(templatesExist ? 'import.templates_hint_replace' : 'import.templates_hint_new')}`, !templatesExist || parsed.format === 'era');
    page.append(h('div', { class: 'card' }, tpl.el));
  }

  if (parsed.errors.length) {
    page.append(h('h2', { class: 'h2 tone-red-text' }, t('import.error_list')),
      table([t('import.col_row'), t('import.col_no'), t('import.col_reason')],
        parsed.errors.map((e) => [`${e.sheet} ${e.row}`, e.no || '—', reasonText(e)])));
  }
  if (diff.toUpdate.length) {
    page.append(h('details', { class: 'details' }, h('summary', {}, `${t('import.update_list')} (${diff.toUpdate.length})`),
      table([t('import.col_no'), t('tasks.col_title'), t('import.col_fields')],
        diff.toUpdate.map((u) => [u.task.code, u.task.title, u.changed.map((f) => t(`field.${f}`)).join(', ')]))));
  }
  if (parsed.warnings.length) {
    page.append(h('details', { class: 'details', open: parsed.warnings.some((w) => w.reason === 'warn.assignee_unknown') },
      h('summary', {}, `${t('import.warning_list')} (${parsed.warnings.length})`),
      table([t('import.col_row'), t('import.col_no'), t('import.col_reason')],
        parsed.warnings.map((w) => [w.row, w.no, reasonText(w)]))));
  }

  const actions = h('div', { class: 'actions sticky-actions' },
    h('button', { class: 'btn', type: 'button', onclick: () => showStart(page) }, t('import.cancel')));
  const go = h('button', { class: 'btn btn-primary', type: 'button' });
  const refresh = () => {
    const willReplace = replace?.input.checked;
    const willTpl = tpl?.input.checked;
    go.disabled = !writeCount && !willReplace && !willTpl;
    go.textContent = parsed.errors.length && writeCount
      ? t('import.confirm_errors', { n: writeCount, e: parsed.errors.length })
      : writeCount ? t('import.confirm', { n: writeCount }) : t('import.confirm_other');
  };
  replace?.input.addEventListener('change', refresh);
  tpl?.input.addEventListener('change', refresh);
  refresh();
  if (!writeCount) page.append(h('p', { class: 'notice notice-ok' }, icon('check'), h('span', {}, t('import.nothing'))));
  go.addEventListener('click', async () => {
    const willReplace = Boolean(replace?.input.checked);
    if (willReplace) {
      const ok = await confirmDialog(t('import.replace_confirm', { n: diff.notInFile, m: parsed.tasks.length }),
        { confirmLabel: t('import.replace_go'), danger: true });
      if (!ok) return;
    }
    save(page, parsed, diff, { replace: willReplace, templates: Boolean(tpl?.input.checked) });
  });
  actions.append(go);
  page.append(actions);
}

function progressView(page) {
  const bar = h('div', { class: 'progress-fill', style: 'width:0%' });
  const text = h('p', { class: 'muted' }, '');
  clear(page).append(h('div', { class: 'state' },
    h('h1', { class: 'h2' }, t('import.saving')),
    h('div', { class: 'progress progress-wide', role: 'progressbar' }, h('div', { class: 'progress-track' }, bar)),
    text));
  return (done, total, label) => {
    bar.style.width = `${total ? Math.round((done * 100) / total) : 100}%`;
    text.textContent = label;
  };
}

async function save(page, parsed, diff, { replace, templates }) {
  const chunks = buildPayloadChunks(parsed, diff, CHUNK);
  const steps = chunks.length + (replace ? 2 : 0) + (templates ? 1 : 0) + 1;
  let step = 0;
  const set = progressView(page);

  try {
    // 1) Tam değiştirmeden önce otomatik yedek
    if (replace) {
      set(step, steps, t('import.step_backup'));
      const r = await callFn('maintenance', { mode: 'backup' });
      if (!r.ok) throw new Error(t('import.backup_failed'));
      step++;
    }

    // 2) Görevler 500'erli parçalarla (aynı içe aktarma oturumu)
    let batchId = null;
    let inserted = 0; let updated = 0; let noAssignee = 0; let renamed = 0;
    for (let i = 0; i < chunks.length; i++) {
      set(step, steps, t('import.step_chunk', { i: i + 1, n: chunks.length }));
      const { data, error } = await supabase.rpc('import_excel', { p: { ...chunks[i], batch_id: batchId } });
      if (error) {
        if (batchId) await supabase.rpc('undo_import', { p_batch: batchId });   // yarım kalmasın
        throw error;
      }
      batchId = data.batch_id;
      inserted += data.inserted; updated += data.updated; noAssignee += data.no_assignee || 0; renamed += (data.renamed || []).length;
      step++;
    }

    // 3) Dosyada olmayanlar çöp kutusuna
    let trashed = 0;
    if (replace) {
      set(step, steps, t('import.step_trash'));
      const { data, error } = await supabase.rpc('import_trash_missing', { p_batch: batchId, p_codes: parsed.tasks.map((x) => x.code) });
      if (error) throw error;
      trashed = data || 0;
      step++;
    }

    // 4) Şablonlar
    let tplCount = 0;
    if (templates) {
      set(step, steps, t('import.step_templates'));
      const { data, error } = await supabase.rpc('replace_templates', { p: parsed.templates });
      if (error) throw error;
      tplCount = data || 0;
      step++;
    }

    const fin = await supabase.rpc('import_finish', { p_batch: batchId });
    const archived = (fin.data?.archived_projects || []).length;
    set(steps, steps, t('import.step_reload'));
    await reloadAll();

    clear(page).append(
      h('div', { class: 'state' },
        icon('check', 'icon-lg tone-green-text'),
        h('h1', { class: 'h2' }, t('import.done_title')),
        h('p', {}, t('import.done_body', { ins: inserted, upd: updated })),
        trashed ? h('p', {}, t('import.done_trashed', { n: trashed })) : null,
        tplCount ? h('p', {}, t('import.done_templates', { n: tplCount })) : null,
        renamed ? h('p', {}, t('import.done_renamed', { n: renamed })) : null,
        archived ? h('p', {}, t('import.done_archived', { n: archived })) : null,
        noAssignee ? h('p', { class: 'tone-amber-text' }, t('import.done_no_assignee', { n: noAssignee })) : null,
        h('div', { class: 'actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => undo(page, batchId) }, t('import.undo')),
          h('a', { class: 'btn', href: '#/ozet' }, t('summary.title')),
          h('a', { class: 'btn btn-primary', href: '#/gorevler' }, t('import.go_tasks')))));
  } catch (err) {
    console.error(err);
    fail(page, err?.message && !err.code ? err.message : friendlyError(err));
  }
}

async function undo(page, batchId) {
  const ok = await confirmDialog(t('import.undo_confirm'), { confirmLabel: t('import.undo'), danger: true });
  if (!ok) return;
  clear(page).append(spinner());
  const { data, error } = await supabase.rpc('undo_import', { p_batch: batchId });
  if (error) { fail(page, friendlyError(error)); return; }
  await reloadAll();
  toast(t('import.undone', { del: data.deleted, res: data.restored + (data.untrashed || 0) }), { type: 'ok', timeout: 6000 });
  showStart(page);
}
