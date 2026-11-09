// Ayarlar > Şablonlar (owner/admin) ve Projeler > Yeni proje.
// Şablon = aynı türdeki projelerde ortak adımlar. Açıklamadaki "1. ...", "2. ..." satırları
// yeni projede kontrol listesi maddesi olur.
import { h, icon, toast, clear, confirmDialog } from './ui.js';
import { t, getLang } from './i18n.js';
import { label, parseDescription, VALUE_LABELS } from './excel-format.js';
import { supabase } from './supabase.js';
import { store, reloadAll } from './store.js';
import { setTaskFilter } from './tasks.js';
import { addDays, weekdayIndex, fmtDate } from './dates.js';

const TYPES = ['web', 'panel', 'is_plani'];
const COLS = 'id,project_type,sort_order,section,category,title,description,estimate_minutes,recurrence,recurrence_day,reminder,priority,tags';
const opts = (kind, cur) => Object.keys(VALUE_LABELS[kind]).map((k) => h('option', { value: k, selected: k === cur }, label(kind, k, getLang())));

async function fetchTemplates(type) {
  const { data, error } = await supabase.from('task_templates').select(COLS).eq('project_type', type).order('sort_order');
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------- şablon düzenleyici
export function templatesCard() {
  let type = 'web';
  let rows = [];
  const body = h('div', { class: 'tpl-body' });
  const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': t('tpl.type') });
  const workHours = h('input', { class: 'input input-sm', id: 'tpl-hours', type: 'number', min: 0.5, max: 12, step: 0.5, value: 4 });
  supabase.from('app_settings').select('daily_work_minutes').eq('id', 1).maybeSingle()
    .then(({ data }) => { if (data?.daily_work_minutes) workHours.value = String(data.daily_work_minutes / 60); });
  workHours.addEventListener('change', async () => {
    const m = Math.round(Math.min(12, Math.max(0.5, Number(workHours.value) || 4)) * 60);
    const { error } = await supabase.from('app_settings').update({ daily_work_minutes: m }).eq('id', 1);
    toast(error ? t('tpl.err') : t('tpl.saved'), { type: error ? 'error' : 'ok' });
  });
  const card = h('div', { class: 'card', id: 'sablonlar' },
    h('h2', { class: 'h2' }, t('tpl.title')),
    h('p', { class: 'muted small' }, t('tpl.help')),
    h('div', { class: 'row-gap tpl-hours' }, h('label', { for: 'tpl-hours', class: 'small' }, t('tpl.work_hours')), workHours,
      h('span', { class: 'muted small' }, t('tpl.work_hours_help'))),
    tabs, body);

  function drawTabs() {
    clear(tabs).append(...TYPES.map((x) => h('button', {
      type: 'button', role: 'tab', class: `seg-btn ${x === type ? 'active' : ''}`, 'aria-selected': String(x === type),
      onclick: () => { type = x; drawTabs(); load(); },
    }, label('project_type', x, getLang()))));
  }

  async function save(row, patch, silent) {
    const { error } = await supabase.from('task_templates').update(patch).eq('id', row.id);
    if (error) { toast(t('tpl.err'), { type: 'error' }); return false; }
    Object.assign(row, patch);
    if (!silent) toast(t('tpl.saved'), { type: 'ok' });
    return true;
  }

  async function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    await Promise.all(rows.map((r, k) => (r.sort_order !== k + 1 ? save(r, { sort_order: k + 1 }, true) : null)));
    draw();
  }

  function editor(row, i) {
    const f = (id) => `tp-${row.id}-${id}`;
    const title = h('input', { class: 'input', id: f('title'), value: row.title });
    const section = h('input', { class: 'input', id: f('section'), value: row.section, list: 'tpl-sections' });
    const category = h('input', { class: 'input', id: f('cat'), value: row.category || '' });
    const priority = h('select', { class: 'input', id: f('prio') }, opts('priority', row.priority));
    const recurrence = h('select', { class: 'input', id: f('rec') }, opts('recurrence', row.recurrence));
    const reminder = h('select', { class: 'input', id: f('rem') }, opts('reminder', row.reminder));
    const est = h('input', { class: 'input', id: f('est'), type: 'number', min: 0, value: row.estimate_minutes ?? '' });
    const desc = h('textarea', { class: 'input', id: f('desc'), rows: 6, value: row.description || '' });
    const steps = parseDescription(row.description).checklist.length;
    const fieldsBox = h('div', { class: 'tpl-form' },
      h('div', { class: 'field' }, h('label', { for: f('title') }, t('detail.title')), title),
      h('div', { class: 'grid-2' },
        h('div', { class: 'field' }, h('label', { for: f('section') }, t('tasks.section')), section),
        h('div', { class: 'field' }, h('label', { for: f('cat') }, t('tasks.category')), category)),
      h('div', { class: 'grid-4' },
        h('div', { class: 'field' }, h('label', { for: f('prio') }, t('tasks.col_priority')), priority),
        h('div', { class: 'field' }, h('label', { for: f('rec') }, t('tasks.recurrence')), recurrence),
        h('div', { class: 'field' }, h('label', { for: f('rem') }, t('tasks.reminder')), reminder),
        h('div', { class: 'field' }, h('label', { for: f('est') }, t('detail.estimate')), est)),
      h('div', { class: 'field' }, h('label', { for: f('desc') }, t('tpl.desc')), desc,
        h('p', { class: 'muted small' }, t('tpl.desc_help'))),
      h('div', { class: 'row-gap' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
          if (!title.value.trim() || !section.value.trim()) { toast(t('detail.required'), { type: 'error' }); return; }
          const ok = await save(row, {
            title: title.value.trim(), section: section.value.trim(), category: category.value.trim() || null,
            priority: priority.value, recurrence: recurrence.value, reminder: reminder.value,
            estimate_minutes: est.value === '' ? null : Math.max(0, Math.round(Number(est.value))),
            description: desc.value.trim() || null,
          });
          if (ok) draw();
        } }, t('common.save')),
        h('button', { class: 'btn btn-danger-outline', type: 'button', onclick: async () => {
          if (!(await confirmDialog(t('tpl.delete_confirm', { title: row.title }), { confirmLabel: t('common.delete'), danger: true }))) return;
          const { error } = await supabase.from('task_templates').delete().eq('id', row.id);
          if (error) { toast(t('tpl.err'), { type: 'error' }); return; }
          rows.splice(i, 1); draw();
        } }, icon('trash'), t('common.delete'))));
    const det = h('details', { class: 'tpl-item' },
      h('summary', {},
        h('span', { class: 'tpl-no' }, String(i + 1)),
        h('span', { class: 'tpl-title' }, row.title),
        h('span', { class: 'muted small' }, row.section, steps ? ` · ${t('tpl.steps', { n: steps })}` : ''),
        h('span', { class: 'tpl-move' },
          h('button', { class: 'icon-btn icon-btn-sm', type: 'button', title: t('tpl.up'), 'aria-label': t('tpl.up'), disabled: i === 0,
            onclick: (e) => { e.preventDefault(); move(i, -1); } }, icon('chevronUp')),
          h('button', { class: 'icon-btn icon-btn-sm', type: 'button', title: t('tpl.down'), 'aria-label': t('tpl.down'), disabled: i === rows.length - 1,
            onclick: (e) => { e.preventDefault(); move(i, 1); } }, icon('chevronDown')))),
      fieldsBox);
    return det;
  }

  function draw() {
    const sections = [...new Set([...store.lookups.filter((l) => l.kind === 'section').map((l) => l.value), ...rows.map((r) => r.section)])];
    clear(body).append(
      h('datalist', { id: 'tpl-sections' }, sections.map((s) => h('option', { value: s }))),
      h('p', { class: 'muted small' }, t('tpl.count', { n: rows.length })),
      rows.length ? h('div', { class: 'tpl-list' }, rows.map(editor)) : h('p', { class: 'muted' }, t('tpl.empty')),
      h('button', { class: 'btn mt', type: 'button', onclick: async () => {
        const { data, error } = await supabase.from('task_templates').insert({
          project_type: type, sort_order: rows.length + 1, section: rows[rows.length - 1]?.section || sections[0] || 'Genel',
          title: t('tpl.new_title'),
        }).select(COLS).single();
        if (error) { toast(t('tpl.err'), { type: 'error' }); return; }
        rows.push(data); draw();
        const last = body.querySelectorAll('.tpl-item'); const el = last[last.length - 1];
        if (el) { el.open = true; el.querySelector('input')?.select(); el.scrollIntoView({ block: 'center' }); }
      } }, icon('plus'), t('tpl.add')));
  }

  async function load() {
    clear(body).append(h('p', { class: 'muted' }, t('app.loading')));
    try { rows = await fetchTemplates(type); draw(); } catch { clear(body).append(h('p', { class: 'form-msg form-msg-error' }, t('tpl.err'))); }
  }

  drawTabs(); load();
  return card;
}

// ---------------------------------------------------------------- yeni proje
// Görev tarihlerini sırayla hesaplar: hafta içi, günde `dayMinutes` dakika, her görev kendi tahmini süresi kadar.
// Tekrarlayan şablon görevleri sıraya girmez; başlangıç tarihinden itibaren kendi kuralıyla başlar.
export const DEFAULT_ESTIMATE = 60;
const nextWorkday = (iso) => { let d = iso; while (weekdayIndex(d) > 4) d = addDays(d, 1); return d; };
export function scheduleTasks(tasks, startIso, dayMinutes) {
  const cap = Math.max(30, Number(dayMinutes) || 240);
  let day = nextWorkday(startIso);
  let left = cap;
  return tasks.map((tk) => {
    if (tk.recurrence && tk.recurrence !== 'once') return { start_date: startIso, due_date: null };
    let est = Math.max(1, Number(tk.estimate_minutes) || DEFAULT_ESTIMATE);
    if (left <= 0) { day = nextWorkday(addDays(day, 1)); left = cap; }
    const start = day;
    while (est > left) { est -= left; day = nextWorkday(addDays(day, 1)); left = cap; }
    left -= est;
    return { start_date: start, due_date: day };
  });
}

export function newProjectDialog() {
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const name = h('input', { class: 'input', id: 'np-name', required: true, autocomplete: 'off' });
  const type = h('select', { class: 'input', id: 'np-type' }, TYPES.map((x) => h('option', { value: x }, label('project_type', x, getLang()))));
  const useTpl = h('input', { type: 'checkbox', id: 'np-tpl', checked: true });
  const tplInfo = h('p', { class: 'muted small np-info' });
  const people = store.profiles.filter((p) => p.active && p.role !== 'viewer');
  const assignee = h('select', { class: 'input', id: 'np-assignee' }, h('option', { value: '' }, t('np.nobody')),
    people.map((p) => h('option', { value: p.id }, p.full_name)));
  const start = h('input', { class: 'input', id: 'np-start', type: 'date' });
  const hours = h('input', { class: 'input', id: 'np-hours', type: 'number', min: 0.5, max: 12, step: 0.5, value: 4 });
  const preview = h('div', { class: 'np-preview' });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, t('np.create'));
  let tpl = [];
  let picked = new Set();

  supabase.from('app_settings').select('daily_work_minutes').eq('id', 1).maybeSingle()
    .then(({ data }) => { if (data?.daily_work_minutes) { hours.value = String(data.daily_work_minutes / 60); drawPreview(); } });

  function chosen() { return tpl.filter((r) => picked.has(r.id)); }

  function drawPreview() {
    const list = chosen();
    const plan = start.value ? scheduleTasks(list, start.value, Number(hours.value) * 60) : [];
    const planOf = new Map(list.map((r, i) => [r.id, plan[i]]));
    const steps = list.reduce((sum, r) => sum + parseDescription(r.description).checklist.length, 0);
    const last = plan.filter((p) => p?.due_date).map((p) => p.due_date).sort().pop();
    tplInfo.textContent = !tpl.length ? t('np.tpl_none') : `${t('np.tpl_info', { n: list.length, steps })}${last ? ` ${t('np.ends', { date: fmtDate(last) })}` : ''}`;
    if (!useTpl.checked || !tpl.length) { clear(preview); preview.hidden = true; return; }
    preview.hidden = false;
    const all = h('input', { type: 'checkbox', checked: picked.size === tpl.length, 'aria-label': t('np.select_all') });
    all.indeterminate = picked.size > 0 && picked.size < tpl.length;
    all.addEventListener('change', () => { picked = all.checked ? new Set(tpl.map((r) => r.id)) : new Set(); drawPreview(); });
    clear(preview).append(
      h('div', { class: 'np-row np-head' }, all, h('span', {}, t('np.step')), h('span', {}, t('detail.estimate')), h('span', {}, t('np.dates'))),
      ...tpl.map((r) => {
        const cb = h('input', { type: 'checkbox', checked: picked.has(r.id), 'aria-label': r.title });
        cb.addEventListener('change', () => { if (cb.checked) picked.add(r.id); else picked.delete(r.id); drawPreview(); });
        const pl = planOf.get(r.id);
        const rec = r.recurrence !== 'once';
        return h('label', { class: `np-row ${picked.has(r.id) ? '' : 'is-off'}` }, cb,
          h('span', { class: 'np-title' }, r.title, h('span', { class: 'muted small' }, ` · ${r.section}`)),
          h('span', { class: 'muted small' }, rec ? label('recurrence', r.recurrence, getLang()) : `${r.estimate_minutes || DEFAULT_ESTIMATE} ${t('tasks.minutes')}`),
          h('span', { class: 'small' }, pl ? (pl.due_date ? (pl.start_date === pl.due_date ? fmtDate(pl.due_date) : `${fmtDate(pl.start_date)} → ${fmtDate(pl.due_date)}`) : `${fmtDate(pl.start_date)} →`) : '—'));
      }));
  }

  async function refreshTpl() {
    tplInfo.textContent = t('app.loading');
    try {
      tpl = await fetchTemplates(type.value);
      picked = new Set(tpl.map((r) => r.id));
      useTpl.disabled = !tpl.length; if (!tpl.length) useTpl.checked = false;
    } catch { tplInfo.textContent = t('tpl.err'); tpl = []; }
    drawPreview();
  }
  type.addEventListener('change', refreshTpl);
  [start, hours].forEach((x) => x.addEventListener('input', drawPreview));
  useTpl.addEventListener('change', drawPreview);

  const form = h('form', { class: 'form', novalidate: true },
    h('h2', { class: 'h2' }, t('np.title')),
    h('div', { class: 'grid-2' },
      h('div', { class: 'field' }, h('label', { for: 'np-name' }, t('np.name')), name),
      h('div', { class: 'field' }, h('label', { for: 'np-type' }, t('np.type')), type)),
    h('div', { class: 'grid-3' },
      h('div', { class: 'field' }, h('label', { for: 'np-assignee' }, t('np.assignee')), assignee),
      h('div', { class: 'field' }, h('label', { for: 'np-start' }, t('np.start')), start),
      h('div', { class: 'field' }, h('label', { for: 'np-hours' }, t('np.hours')), hours)),
    h('label', { class: 'check' }, useTpl, t('np.use_tpl')), tplInfo,
    preview,
    h('p', { class: 'muted small' }, t('np.help')),
    msg,
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('common.cancel')), btn));
  const dlg = h('dialog', { class: 'dialog dialog-xwide' }, form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const setMsg = (x) => { msg.textContent = x; msg.className = 'form-msg form-msg-error'; };
    if (!name.value.trim()) return setMsg(t('np.err_name'));
    btn.disabled = true; msg.textContent = '';
    const list = useTpl.checked ? chosen() : [];
    const plan = start.value ? scheduleTasks(list, start.value, Number(hours.value) * 60) : [];
    const tasks = list.map((r, i) => {
      const d = parseDescription(r.description);
      return {
        section: r.section, category: r.category, title: r.title, description: d.description,
        checklist: d.checklist.map((x) => ({ text: x.text, note: x.note })),
        estimate_minutes: r.estimate_minutes, recurrence: r.recurrence, recurrence_day: r.recurrence_day,
        reminder: r.reminder, priority: r.priority, tags: r.tags || [],
        assignee_id: assignee.value || null,
        start_date: plan[i]?.start_date || null, due_date: plan[i]?.due_date || null,
      };
    });
    const { data, error } = await supabase.rpc('create_project', { p: { name: name.value.trim(), type: type.value, tasks } });
    btn.disabled = false;
    if (error) return setMsg(error.code === '23505' ? t('np.err_exists') : t('np.err', { msg: error.message }));
    dlg.close();
    toast(t('np.done', { name: name.value.trim(), n: data.tasks }), { type: 'ok' });
    await reloadAll();
    setTaskFilter({ project: data.project_id });
    location.hash = '#/gorevler';
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  name.focus();
  refreshTpl();
}

// ---------------------------------------------------------------- proje düzenle (ad / tür / arşiv)
export function editProjectDialog(p) {
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const name = h('input', { class: 'input', id: 'ep-name', value: p.name });
  const type = h('select', { class: 'input', id: 'ep-type' }, TYPES.map((x) => h('option', { value: x, selected: x === p.type }, label('project_type', x, getLang()))));
  const archived = h('input', { type: 'checkbox', id: 'ep-arch', checked: p.archived });
  const form = h('form', { class: 'form', novalidate: true },
    h('h2', { class: 'h2' }, t('np.edit_title')),
    h('div', { class: 'field' }, h('label', { for: 'ep-name' }, t('np.name')), name),
    h('div', { class: 'field' }, h('label', { for: 'ep-type' }, t('np.type')), type),
    h('label', { class: 'check' }, archived, t('np.archived')),
    h('p', { class: 'muted small' }, t('np.archived_help')),
    msg,
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('common.cancel')),
      h('button', { class: 'btn btn-primary', type: 'submit' }, t('common.save'))));
  const dlg = h('dialog', { class: 'dialog' }, form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!name.value.trim()) { msg.textContent = t('np.err_name'); msg.className = 'form-msg form-msg-error'; return; }
    const { error } = await supabase.from('projects').update({ name: name.value.trim(), type: type.value, archived: archived.checked }).eq('id', p.id);
    if (error) { msg.textContent = error.code === '23505' ? t('np.err_exists') : t('tpl.err'); msg.className = 'form-msg form-msg-error'; return; }
    dlg.close();
    toast(t('tpl.saved'), { type: 'ok' });
    reloadAll();
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}
