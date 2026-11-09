// Görev detayı: sağdan açılan panel (telefonda tam ekran). Alan değişince otomatik kaydedilir.
import { h, clear, icon, toast, confirmDialog } from './ui.js';
import { t, getLang } from './i18n.js';
import { label, VALUE_LABELS } from './excel-format.js';
import { fmtDate, fmtDateTime, dueInfo } from './dates.js';
import { supabase, friendlyError } from './supabase.js';
import {
  store, on, updateTask, setStatus, hasPending, addItem, toggleItem, editItem, deleteItem, reorderItems,
  deleteTask, restoreTask, snoozeUntil, createTask, resolveConflict, flushTask,
} from './store.js';
import { attachmentsSection } from './files.js';
import { commentsSection } from './comments.js';
import { addDays, todayIso, istanbulToDate, startOfWeek } from './dates.js';

let current = null;   // { id, el, offs[], returnFocus }
let basePath = '/gorevler';
export function setDetailBase(path) { basePath = path || '/gorevler'; }

export function isDetailOpen() { return Boolean(current); }

export function closeDetail(navigate = true) {
  if (!current) return;
  const { id, el, offs, returnFocus } = current;
  flushTask(id);
  offs.forEach((off) => off());
  el.remove();
  document.body.classList.remove('drawer-open');
  current = null;
  if (navigate && location.hash.startsWith('#/gorev/')) location.hash = `#${basePath}`;
  const target = returnFocus || document.querySelector(`[data-task="${id}"] a`);
  if (target && document.contains(target)) target.focus({ preventScroll: true });
}

function canEditTask(ctx, task) {
  return ctx.isAdmin || (ctx.profile.role === 'member' && task.assignee_id === ctx.profile.id);
}

const opt = (value, text, selected) => h('option', { value, selected: selected ? true : null }, text);

// ---------------------------------------------------------------- detay paneli
export function openDetail(id, ctx) {
  if (current && current.id === id) return;
  const returnFocus = document.activeElement;
  if (current) closeDetail(false);
  const task = store.tasks.get(id);
  if (!task) {
    if (store.ready) toast(t('detail.not_found'), { type: 'error' });
    if (location.hash.startsWith('#/gorev/')) history.replaceState(null, '', `#${basePath}`);
    return;
  }

  const lang = getLang();
  const editable = canEditTask(ctx, task);
  const isMember = ctx.profile.role === 'member';
  const bound = [];   // { field, el, read }
  const offs = [];

  // ---- alan bağlama
  function bind(field, el, { parse = (v) => v, format = (v) => v ?? '', event = 'input', validate } = {}) {
    el.value = format(store.tasks.get(id)[field]);
    if (!editable) el.disabled = true;
    const err = h('p', { class: 'field-error', role: 'alert' });
    el.addEventListener(event, () => {
      const value = parse(el.value);
      const problem = validate ? validate(value) : null;
      err.textContent = problem || '';
      el.setAttribute('aria-invalid', problem ? 'true' : 'false');
      if (problem) return;
      updateTask(id, { [field]: value });
    });
    bound.push({ field, el, format });
    return { el, err };
  }

  function field(labelText, control, { wide = false, help } = {}) {
    const el = control.el || control;
    if (!el.id) el.id = `d-${Math.random().toString(36).slice(2, 8)}`;
    return h('div', { class: `field ${wide ? 'field-wide' : ''}` }, h('label', { for: el.id }, labelText), el, control.err || null,
      help ? h('p', { class: 'muted small' }, help) : null);
  }

  const nullIfEmpty = (v) => (v === '' ? null : v);
  const required = (v) => (!v || !String(v).trim() ? t('detail.required') : null);

  // ---- başlık
  const titleCtl = bind('title', h('textarea', { class: 'input title-input', rows: 1, 'aria-label': t('detail.title') }), { validate: required });
  autoGrow(titleCtl.el);

  // ---- seçimler
  const statusSel = h('select', { class: 'input' }, Object.keys(VALUE_LABELS.status).map((k) => opt(k, label('status', k, lang))));
  statusSel.value = task.status;
  if (!editable) statusSel.disabled = true;
  statusSel.addEventListener('change', () => setStatus(id, statusSel.value));
  bound.push({ field: 'status', el: statusSel, format: (v) => v });

  const prioCtl = bind('priority', h('select', { class: 'input' }, Object.keys(VALUE_LABELS.priority).map((k) => opt(k, label('priority', k, lang)))), { event: 'change' });
  const projCtl = bind('project_id', h('select', { class: 'input' }, store.projects.map((p) => opt(p.id, p.name))), { event: 'change' });
  const assCtl = bind('assignee_id', h('select', { class: 'input' }, opt('', t('tasks.unassigned')),
    store.profiles.filter((p) => p.active !== false).map((p) => opt(p.id, p.full_name))), { event: 'change', parse: nullIfEmpty });
  if (isMember) { projCtl.el.disabled = true; assCtl.el.disabled = true; }

  const listId = (kind) => `dl-${kind}`;
  const datalist = (kind, values) => h('datalist', { id: listId(kind) }, [...new Set(values.filter(Boolean))].map((v) => h('option', { value: v })));
  const allTasks = [...store.tasks.values()];
  const sectionCtl = bind('section', h('input', { class: 'input', list: listId('section') }), { validate: required });
  const categoryCtl = bind('category', h('input', { class: 'input', list: listId('category') }), { parse: nullIfEmpty });
  const tagsCtl = bind('tags', h('input', { class: 'input', list: listId('tag') }), {
    event: 'change', format: (v) => (v || []).join(', '),
    parse: (v) => [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))],
  });

  const startCtl = bind('start_date', h('input', { class: 'input', type: 'date' }), { event: 'change', parse: nullIfEmpty });
  const dueCtl = bind('due_date', h('input', { class: 'input', type: 'date' }), { event: 'change', parse: nullIfEmpty });
  const timeCtl = bind('due_time', h('input', { class: 'input', type: 'time' }), {
    event: 'change', format: (v) => (v || '09:00').slice(0, 5), parse: (v) => (v ? `${v}:00` : '09:00:00'),
  });
  const estCtl = bind('estimate_minutes', h('input', { class: 'input', type: 'number', min: 0, step: 5, inputmode: 'numeric' }), {
    parse: (v) => (v === '' ? null : Math.max(0, Math.round(Number(v)))),
    validate: (v) => (v !== null && Number.isNaN(v) ? t('detail.number') : null),
  });
  const recCtl = bind('recurrence', h('select', { class: 'input' }, Object.keys(VALUE_LABELS.recurrence).map((k) => opt(k, label('recurrence', k, lang)))), { event: 'change' });
  const recDayWrap = h('div');
  const remCtl = bind('reminder', h('select', { class: 'input' }, Object.keys(VALUE_LABELS.reminder).map((k) => opt(k, label('reminder', k, lang)))), { event: 'change' });

  function drawRecDay() {
    const tk = store.tasks.get(id);
    clear(recDayWrap);
    if (tk.recurrence === 'weekly') {
      const sel = h('select', { class: 'input', id: 'd-recday', disabled: !editable }, opt('', '—'),
        Object.keys(VALUE_LABELS.weekday).map((k) => opt(k, label('weekday', k, lang), tk.recurrence_day === k)));
      sel.addEventListener('change', () => updateTask(id, { recurrence_day: sel.value || null }));
      recDayWrap.append(h('div', { class: 'field' }, h('label', { for: 'd-recday' }, t('detail.recurrence_day')), sel));
    } else if (tk.recurrence === 'monthly') {
      const inp = h('input', { class: 'input', id: 'd-recday', type: 'number', min: 1, max: 31, value: tk.recurrence_day || '', disabled: !editable });
      inp.addEventListener('change', () => {
        const n = Math.min(31, Math.max(1, Math.round(Number(inp.value) || 1)));
        inp.value = n; updateTask(id, { recurrence_day: String(n) });
      });
      recDayWrap.append(h('div', { class: 'field' }, h('label', { for: 'd-recday' }, t('detail.recurrence_day_month')), inp));
    }
  }
  recCtl.el.addEventListener('change', () => {
    if (!['weekly', 'monthly'].includes(recCtl.el.value)) updateTask(id, { recurrence_day: null });
    setTimeout(drawRecDay, 0);
  });

  const descCtl = bind('description', h('textarea', { class: 'input', rows: 4 }), { parse: nullIfEmpty });
  autoGrow(descCtl.el);
  const refsCtl = bind('reference_links', h('textarea', { class: 'input', rows: 2, placeholder: 'https://…' }), {
    event: 'change', format: (v) => (v || []).join('\n'),
    parse: (v) => v.split('\n').map((x) => x.trim()).filter(Boolean),
  });
  const refsView = h('ul', { class: 'refs' });

  // ---- üst bilgi ve işlemler
  const headInfo = h('div', { class: 'drawer-headinfo' });
  const progressBox = h('div');
  const metaLine = h('p', { class: 'muted small' });
  const conflictBox = h('div', { 'aria-live': 'assertive' });
  const actions = h('div', { class: 'row-wrap' });

  function drawHead() {
    const tk = store.tasks.get(id);
    if (!tk) return;
    const info = dueInfo(tk);
    clear(headInfo).append(
      h('span', { class: 'muted' }, `#${tk.no}`),
      info ? h('span', { class: `due-tag due-${info.tone}` }, info.tone === 'overdue' ? icon('alert') : icon('clock'), info.text) : null);
    clear(progressBox).append(
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': tk.progress, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': t('tasks.col_progress') },
        h('div', { class: 'progress-track' }, h('div', { class: 'progress-fill', style: `width:${tk.progress}%` })),
        h('span', { class: 'progress-text' }, `${tk.progress}%`)),
      h('p', { class: 'muted small' }, t('detail.progress_auto')));
    const who = store.profiles.find((p) => p.id === tk.updated_by)?.full_name || '—';
    metaLine.textContent = t('tasks.last_change', { who, when: fmtDateTime(tk.updated_at) });
    clear(refsView);
    (tk.reference_links || []).forEach((r) => refsView.append(h('li', {}, /^https?:\/\//i.test(r)
      ? h('a', { href: r, target: '_blank', rel: 'noopener noreferrer' }, icon('link'), r)
      : h('span', {}, icon('file'), r))));
    clear(actions);
    if (editable && !['done', 'cancelled'].includes(tk.status)) {
      actions.append(h('button', { class: 'btn btn-success', type: 'button', onclick: () => { setStatus(id, 'done'); toast(t('tasks.marked_done'), { type: 'ok' }); } }, icon('check'), t('tasks.mark_done')));
    }
    if (!['done', 'cancelled'].includes(tk.status)) actions.append(snoozeMenu(id));
    if (ctx.isAdmin) {
      actions.append(h('button', { class: 'btn btn-danger-outline', type: 'button', onclick: removeTask }, icon('trash'), t('detail.delete')));
    }
  }

  async function removeTask() {
    const ok = await confirmDialog(t('detail.delete_confirm', { title: store.tasks.get(id)?.title || '' }), { confirmLabel: t('detail.delete'), danger: true });
    if (!ok) return;
    const copy = await deleteTask(id);
    closeDetail();
    toast(t('detail.deleted'), { timeout: 8000, action: { label: t('import.undo'), run: () => restoreTask(copy) } });
  }

  // ---- kontrol listesi
  const checklistBox = h('div', { class: 'checklist-edit' });
  let dragId = null;

  function drawChecklist() {
    const ae = document.activeElement;
    if (checklistBox.contains(ae) && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && ae.type === 'text' && !ae.closest('.cl-add')))) return;
    const items = store.checklist.get(id) || [];
    const ul = h('ul', { class: 'cl-list' });
    items.forEach((it, idx) => {
      const chk = h('input', { type: 'checkbox', checked: it.done, disabled: !editable, 'aria-label': it.text });
      chk.addEventListener('change', () => toggleItem(id, it.id, chk.checked));
      const txt = h('textarea', { class: 'cl-text', rows: 1, disabled: !editable, 'aria-label': t('detail.item_text') });
      txt.value = it.text;
      autoGrow(txt);
      txt.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); txt.blur(); } });
      txt.addEventListener('input', () => { if (txt.value.trim()) editItem(id, it.id, { text: txt.value.replace(/\s*\n\s*/g, ' ').trim() }); });
      txt.addEventListener('blur', () => setTimeout(() => { if (!checklistBox.contains(document.activeElement)) drawChecklist(); }, 50));
      const note = h('input', { type: 'text', class: 'cl-note', value: it.note || '', placeholder: t('detail.item_note'), disabled: !editable, 'aria-label': t('detail.item_note') });
      note.addEventListener('input', () => editItem(id, it.id, { note: note.value.trim() || null }));
      const move = (dir) => {
        const ids = items.map((x) => x.id);
        const j = idx + dir;
        if (j < 0 || j >= ids.length) return;
        [ids[idx], ids[j]] = [ids[j], ids[idx]];
        reorderItems(id, ids);
      };
      const li = h('li', { class: `cl-item ${it.done ? 'done' : ''}`, draggable: editable ? 'true' : null, dataset: { item: it.id } },
        editable ? h('span', { class: 'cl-grip', 'aria-hidden': 'true', title: t('detail.drag') }, icon('grip')) : null,
        chk,
        h('div', { class: 'cl-texts' }, txt, note),
        editable ? h('div', { class: 'cl-tools' },
          h('button', { type: 'button', class: 'icon-btn-sm', 'aria-label': t('detail.move_up'), disabled: idx === 0, onclick: () => move(-1) }, icon('arrowUp')),
          h('button', { type: 'button', class: 'icon-btn-sm', 'aria-label': t('detail.move_down'), disabled: idx === items.length - 1, onclick: () => move(1) }, icon('arrowDown')),
          h('button', { type: 'button', class: 'icon-btn-sm danger', 'aria-label': t('detail.item_delete'), onclick: () => deleteItem(id, it.id) }, icon('trash'))) : null);
      if (editable) {
        li.addEventListener('dragstart', (e) => { dragId = it.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.id); li.classList.add('dragging'); });
        li.addEventListener('dragend', () => { dragId = null; li.classList.remove('dragging'); });
        li.addEventListener('dragover', (e) => { if (dragId) { e.preventDefault(); li.classList.add('drop'); } });
        li.addEventListener('dragleave', () => li.classList.remove('drop'));
        li.addEventListener('drop', (e) => {
          e.preventDefault(); li.classList.remove('drop');
          if (!dragId || dragId === it.id) return;
          const ids = items.map((x) => x.id).filter((x) => x !== dragId);
          ids.splice(ids.indexOf(it.id), 0, dragId);
          reorderItems(id, ids);
        });
      }
      ul.append(li);
    });
    const done = items.filter((x) => x.done).length;
    const add = h('form', { class: 'cl-add' });
    const addInput = h('input', { type: 'text', class: 'input', placeholder: t('detail.item_add_ph'), 'aria-label': t('detail.item_add') });
    add.append(addInput, h('button', { class: 'btn', type: 'submit' }, icon('plus'), t('detail.item_add')));
    add.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = addInput.value.trim();
      if (!v) return;
      const at = v.indexOf(' – ');
      addItem(id, at >= 0 ? v.slice(0, at).trim() : v, at >= 0 ? v.slice(at + 3).trim() : '');
      addInput.value = '';
      setTimeout(() => checklistBox.querySelector('.cl-add input')?.focus(), 30);
    });
    clear(checklistBox).append(
      h('h3', { class: 'h3' }, t('tasks.checklist'), items.length ? h('span', { class: 'muted' }, ` ${done}/${items.length}`) : null),
      items.length ? ul : h('p', { class: 'muted small' }, t('detail.no_items')),
      editable ? add : null);
  }

  // ---- tekrarlayan görev: geçmiş tekrarlar
  const occBox = h('div');
  async function loadOccurrences() {
    const tk = store.tasks.get(id);
    clear(occBox);
    if (!tk || tk.recurrence === 'once') return;
    const { data } = await supabase.from('task_occurrences').select('occurrence_date,completed_at,completed_by,checklist_snapshot')
      .eq('task_id', id).order('occurrence_date', { ascending: false }).limit(12);
    const rows = data || [];
    occBox.append(h('div', { class: 'checklist-edit' },
      h('h3', { class: 'h3' }, icon('repeat'), ' ', t('rec.history'), h('span', { class: 'muted' }, ` ${rows.length}`)),
      h('p', { class: 'muted small' }, t('rec.next_due', { date: fmtDate(tk.due_date), rule: label('recurrence', tk.recurrence, lang) })),
      rows.length ? h('ul', { class: 'history-list occ-list' }, rows.map((r) => {
        const items = Array.isArray(r.checklist_snapshot) ? r.checklist_snapshot : [];
        const who = store.profiles.find((p) => p.id === r.completed_by)?.full_name || t('detail.system');
        return h('li', {}, h('strong', {}, fmtDate(r.occurrence_date)), ' ',
          h('span', { class: 'muted small' }, `${t('rec.completed_by', { who, when: fmtDateTime(r.completed_at) })}${items.length ? ` · ${items.filter((x) => x.done).length}/${items.length}` : ''}`));
      })) : h('p', { class: 'muted small' }, t('rec.none'))));
  }
  loadOccurrences();
  offs.push(on('rollover', (r) => { if (r.id === id) { loadOccurrences(); drawChecklist(); } }));

  // ---- dosyalar
  const files = attachmentsSection(id, ctx, editable);
  offs.push(files.destroy);

  // ---- yorumlar
  const comments = commentsSection(id, ctx);
  offs.push(comments.destroy);

  // ---- değişiklik geçmişi
  const historyBox = h('div', { class: 'history' });
  const historyDetails = h('details', { class: 'details' }, h('summary', {}, icon('history'), t('detail.history')), historyBox);
  historyDetails.addEventListener('toggle', () => { if (historyDetails.open) loadHistory(); });

  async function loadHistory() {
    clear(historyBox).append(h('p', { class: 'muted pad' }, t('app.loading')));
    const { data, error } = await supabase.from('activity_log').select('id,entity,entity_id,action,changes,profile_id,created_at')
      .eq('task_id', id).order('created_at', { ascending: false }).limit(80);
    clear(historyBox);
    if (error) { historyBox.append(h('p', { class: 'pad form-msg-error' }, friendlyError(error))); return; }
    if (!data.length) { historyBox.append(h('p', { class: 'pad muted' }, t('detail.history_empty'))); return; }
    const ul = h('ul', { class: 'history-list' });
    for (const row of data) {
      const who = store.profiles.find((p) => p.id === row.profile_id)?.full_name || t('detail.system');
      const lines = describeChange(row);
      if (!lines.length) continue;
      ul.append(h('li', {}, h('div', { class: 'muted small' }, `${fmtDateTime(row.created_at)} · ${who}`), lines.map((l) => h('div', { class: 'small' }, l))));
    }
    historyBox.append(ul);
  }

  function fmtValue(fieldName, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (['status', 'priority', 'recurrence', 'reminder'].includes(fieldName)) return label(fieldName, v, lang);
    if (['start_date', 'due_date'].includes(fieldName)) return fmtDate(v);
    if (fieldName === 'due_time') return String(v).slice(0, 5);
    if (fieldName === 'project_id') return store.projects.find((p) => p.id === v)?.name || '?';
    if (fieldName === 'assignee_id') return store.profiles.find((p) => p.id === v)?.full_name || '?';
    if (fieldName === 'progress') return `%${v}`;
    if (Array.isArray(v)) return v.join(', ') || '—';
    const s = String(v);
    return s.length > 60 ? `${s.slice(0, 60)}…` : s;
  }

  function describeChange(row) {
    const c = row.changes || {};
    if (row.entity === 'checklist_items') {
      const itemText = (c.text && typeof c.text === 'object' ? c.text.new : c.text)
        || (store.checklist.get(id) || []).find((x) => x.id === row.entity_id)?.text || '';
      if (row.action === 'insert') return [t('hist.item_added', { text: c.text || '' })];
      if (row.action === 'delete') return [t('hist.item_deleted', { text: c.text || '' })];
      const out = [];
      if (c.done) out.push(t(c.done.new ? 'hist.item_done' : 'hist.item_undone', { text: itemText }));
      if (c.text && typeof c.text === 'object') out.push(t('hist.item_renamed', { old: c.text.old, new: c.text.new }));
      if (c.sort_order && !c.done && !c.text) out.push(t('hist.item_moved'));
      return out;
    }
    if (row.entity === 'attachments') return [t(row.action === 'insert' ? 'hist.file_added' : 'hist.file_deleted', { name: c.file_name || '' })];
    if (row.action === 'complete_occurrence') return [t('hist.occurrence', { occ: fmtDate(c.occurrence), next: fmtDate(c.next) })];
    if (row.action === 'insert') return [t('hist.created')];
    if (row.action === 'delete') return [t('hist.deleted')];
    if (row.action === 'restore') return [t('hist.restored')];
    const skip = new Set(['completed_at', 'deleted_at', 'updated_at']);
    return Object.entries(c).filter(([k]) => !skip.has(k)).map(([k, v]) =>
      `${t(`field.${k === 'project_id' ? 'project' : k === 'assignee_id' ? 'assignee' : k}`)}: ${fmtValue(k, v.old)} → ${fmtValue(k, v.new)}`);
  }

  // ---- çakışma
  function showConflict(c) {
    const names = c.fields.map((f) => t(`field.${f === 'project_id' ? 'project' : f === 'assignee_id' ? 'assignee' : f}`)).join(', ');
    clear(conflictBox).append(h('div', { class: 'notice notice-warn conflict' }, icon('alert'),
      h('div', {},
        h('p', {}, h('strong', {}, t('conflict.title')), ' ', t('conflict.body', { who: c.who || t('conflict.someone'), fields: names })),
        h('div', { class: 'row-wrap' },
          h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { resolveConflict(c, 'mine'); clear(conflictBox); } }, t('conflict.keep_mine')),
          h('button', { class: 'btn', type: 'button', onclick: () => { resolveConflict(c, 'theirs'); clear(conflictBox); refreshFields(true); } }, t('conflict.take_theirs'))))));
  }

  // ---- dışarıdan gelen değişikliği alanlara yansıt (odaktaki ve kaydedilmemiş alanlar ezilmez)
  function refreshFields(force = false) {
    const tk = store.tasks.get(id);
    if (!tk) { closeDetail(); toast(t('detail.removed_elsewhere'), { type: 'error' }); return; }
    for (const b of bound) {
      if (!force && (b.el === document.activeElement || hasPending(id, b.field))) continue;
      const v = b.format(tk[b.field]);
      if (b.el.value !== String(v ?? '')) b.el.value = v ?? '';
    }
    drawHead();
  }

  // ---- panel iskeleti
  const titleId = `drawer-title-${id}`;
  const closeBtn = h('button', { class: 'icon-btn-dark', type: 'button', 'aria-label': t('common.close'), onclick: () => closeDetail() }, icon('x'));
  const drawer = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('header', { class: 'drawer-head' }, headInfo, closeBtn),
    h('div', { class: 'drawer-body' },
      conflictBox,
      h('label', { class: 'sr-only', for: titleCtl.el.id || (titleCtl.el.id = titleId) }, t('detail.title')),
      titleCtl.el, titleCtl.err,
      !editable ? h('p', { class: 'notice' }, icon('eye'), h('span', {}, t('detail.readonly'))) : null,
      actions,
      progressBox,
      h('div', { class: 'detail-grid' },
        field(t('tasks.col_status'), statusSel),
        field(t('tasks.col_priority'), prioCtl),
        field(t('tasks.col_project'), projCtl),
        field(t('tasks.assignee'), assCtl),
        field(t('tasks.section'), sectionCtl),
        field(t('tasks.category'), categoryCtl),
        field(t('tasks.start'), startCtl),
        field(t('tasks.col_due'), dueCtl),
        field(t('detail.due_time'), timeCtl),
        field(t('detail.estimate'), estCtl),
        field(t('tasks.recurrence'), recCtl),
        recDayWrap,
        field(t('tasks.reminder'), remCtl),
        field(t('tasks.tags'), tagsCtl, { help: t('detail.tags_help') })),
      field(t('tasks.description'), descCtl, { wide: true }),
      checklistBox,
      occBox,
      files.el,
      h('div', { class: 'field field-wide' },
        h('label', { for: refsCtl.el.id || (refsCtl.el.id = `refs-${id}`) }, t('tasks.references')),
        refsView, editable ? refsCtl.el : null, h('p', { class: 'muted small' }, t('detail.refs_help'))),
      comments.el,
      historyDetails,
      metaLine,
      datalist('section', [...store.lookups.filter((l) => l.kind === 'section').map((l) => l.value), ...allTasks.map((x) => x.section)]),
      datalist('category', [...store.lookups.filter((l) => l.kind === 'category').map((l) => l.value), ...allTasks.map((x) => x.category)]),
      datalist('tag', allTasks.flatMap((x) => x.tags || []))));
  titleCtl.el.id = titleId;

  const backdrop = h('div', { class: 'drawer-backdrop', onclick: (e) => { if (e.target === backdrop) closeDetail(); } }, drawer);
  backdrop.addEventListener('keydown', (e) => { if (e.key === 'Tab') trapFocus(e, drawer); });
  // Esc, odak nerede olursa olsun paneli kapatır (açık bir onay penceresi yoksa)
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.preventDefault(); closeDetail(); } };
  document.addEventListener('keydown', onKey);
  offs.push(() => document.removeEventListener('keydown', onKey));

  drawRecDay();
  drawHead();
  drawChecklist();
  document.body.append(backdrop);
  document.body.classList.add('drawer-open');
  setTimeout(() => (editable ? titleCtl.el : closeBtn).focus({ preventScroll: true }), 30);

  offs.push(on('task', (tid) => { if (tid === id) refreshFields(); }));
  offs.push(on('checklist', (tid) => { if (tid === id) drawChecklist(); }));
  offs.push(on('conflict', (c) => { if (c.id === id) showConflict(c); }));
  current = { id, el: backdrop, offs, returnFocus };
}

function trapFocus(e, root) {
  const f = [...root.querySelectorAll('button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0]; const last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function autoGrow(el) {
  const grow = () => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };
  el.addEventListener('input', grow);
  setTimeout(grow, 0);
  setTimeout(grow, 120);
}

// ---------------------------------------------------------------- yeni görev
// Erteleme: 10 dk, 1 saat, yarın 09:00, gelecek hafta (pazartesi 09:00). O zaman yeniden bildirim gelir.
function snoozeMenu(id) {
  const options = [
    ['snz.10m', () => new Date(Date.now() + 10 * 60000)],
    ['snz.1h', () => new Date(Date.now() + 60 * 60000)],
    ['snz.tomorrow', () => istanbulToDate(addDays(todayIso(), 1), '09:00')],
    ['snz.next_week', () => istanbulToDate(addDays(startOfWeek(todayIso()), 7), '09:00')],
  ];
  const menu = h('details', { class: 'snooze-menu' },
    h('summary', { class: 'btn' }, icon('clock'), t('tasks.snooze_menu')),
    h('div', { class: 'snooze-pop', role: 'menu' }, options.map(([key, at]) => h('button', {
      type: 'button', role: 'menuitem', class: 'snooze-opt', onclick: async () => {
        menu.open = false;
        const when = at();
        try {
          await snoozeUntil(id, when);
          toast(t('snz.done', { when: fmtDateTime(when.toISOString()) }), { type: 'ok' });
        } catch (err) { toast(friendlyError(err), { type: 'error' }); }
      } }, t(key)))));
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.open) { e.stopPropagation(); menu.open = false; menu.querySelector('summary').focus(); } });
  return menu;
}

export function newTaskDialog(ctx) {
  if (!ctx.isAdmin) return;
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const title = h('input', { class: 'input', id: 'nt-title', required: true });
  const project = h('select', { class: 'input', id: 'nt-project' }, store.projects.map((p) => opt(p.id, p.name)));
  const sections = [...new Set([...store.lookups.filter((l) => l.kind === 'section').map((l) => l.value), ...[...store.tasks.values()].map((x) => x.section)].filter(Boolean))];
  const section = h('input', { class: 'input', id: 'nt-section', list: 'nt-sections', value: sections[0] || '' });
  const form = h('form', { class: 'form', method: 'dialog' },
    h('h2', { class: 'h2' }, t('tasks.new')),
    h('div', { class: 'field' }, h('label', { for: 'nt-title' }, t('detail.title')), title),
    h('div', { class: 'field' }, h('label', { for: 'nt-project' }, t('tasks.col_project')), project),
    h('div', { class: 'field' }, h('label', { for: 'nt-section' }, t('tasks.section')), section,
      h('datalist', { id: 'nt-sections' }, sections.map((s) => h('option', { value: s })))),
    msg,
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('common.cancel')),
      h('button', { class: 'btn btn-primary', type: 'submit' }, t('detail.create'))));
  const dlg = h('dialog', { class: 'dialog dialog-wide' }, form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!title.value.trim() || !section.value.trim()) { msg.textContent = t('detail.required'); msg.className = 'form-msg form-msg-error'; return; }
    const row = await createTask({ title: title.value.trim(), project_id: project.value, section: section.value.trim() });
    dlg.close();
    location.hash = `#/gorev/${row.id}`;
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  title.focus();
}
