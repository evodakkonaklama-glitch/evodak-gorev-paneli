// Ayarlar > Şablonlar (owner/admin) ve Projeler > Yeni proje.
// Şablon = aynı türdeki projelerde ortak adımlar. Açıklamadaki "1. ...", "2. ..." satırları
// yeni projede kontrol listesi maddesi olur.
import { h, icon, toast, clear, confirmDialog } from './ui.js';
import { t, getLang } from './i18n.js';
import { label, parseDescription, VALUE_LABELS } from './excel-format.js';
import { supabase } from './supabase.js';
import { store, reloadAll } from './store.js';
import { setTaskFilter } from './tasks.js';

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
  const card = h('div', { class: 'card', id: 'sablonlar' },
    h('h2', { class: 'h2' }, t('tpl.title')),
    h('p', { class: 'muted small' }, t('tpl.help')),
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
export function newProjectDialog() {
  const msg = h('p', { class: 'form-msg', role: 'alert' });
  const name = h('input', { class: 'input', id: 'np-name', required: true, autocomplete: 'off' });
  const type = h('select', { class: 'input', id: 'np-type' }, TYPES.map((x) => h('option', { value: x }, label('project_type', x, getLang()))));
  const useTpl = h('input', { type: 'checkbox', id: 'np-tpl', checked: true });
  const tplInfo = h('span', { class: 'muted small' });
  const people = store.profiles.filter((p) => p.active && p.role !== 'viewer');
  const assignee = h('select', { class: 'input', id: 'np-assignee' }, h('option', { value: '' }, t('np.nobody')),
    people.map((p) => h('option', { value: p.id }, p.full_name)));
  const start = h('input', { class: 'input', id: 'np-start', type: 'date' });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, t('np.create'));
  let tpl = [];

  async function refreshTpl() {
    tplInfo.textContent = t('app.loading');
    try {
      tpl = await fetchTemplates(type.value);
      const steps = tpl.reduce((s, r) => s + parseDescription(r.description).checklist.length, 0);
      tplInfo.textContent = tpl.length ? t('np.tpl_info', { n: tpl.length, steps }) : t('np.tpl_none');
      useTpl.disabled = !tpl.length; if (!tpl.length) useTpl.checked = false;
    } catch { tplInfo.textContent = t('tpl.err'); tpl = []; }
  }
  type.addEventListener('change', refreshTpl);

  const form = h('form', { class: 'form', novalidate: true },
    h('h2', { class: 'h2' }, t('np.title')),
    h('div', { class: 'field' }, h('label', { for: 'np-name' }, t('np.name')), name),
    h('div', { class: 'field' }, h('label', { for: 'np-type' }, t('np.type')), type),
    h('label', { class: 'check' }, useTpl, t('np.use_tpl')), tplInfo,
    h('div', { class: 'grid-2 mt' },
      h('div', { class: 'field' }, h('label', { for: 'np-assignee' }, t('np.assignee')), assignee),
      h('div', { class: 'field' }, h('label', { for: 'np-start' }, t('np.start')), start)),
    h('p', { class: 'muted small' }, t('np.help')),
    msg,
    h('div', { class: 'dialog-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('common.cancel')), btn));
  const dlg = h('dialog', { class: 'dialog dialog-wide' }, form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const setMsg = (x) => { msg.textContent = x; msg.className = 'form-msg form-msg-error'; };
    if (!name.value.trim()) return setMsg(t('np.err_name'));
    btn.disabled = true; msg.textContent = '';
    const tasks = useTpl.checked ? tpl.map((r) => {
      const d = parseDescription(r.description);
      return {
        section: r.section, category: r.category, title: r.title, description: d.description,
        checklist: d.checklist.map((x) => ({ text: x.text, note: x.note })),
        estimate_minutes: r.estimate_minutes, recurrence: r.recurrence, recurrence_day: r.recurrence_day,
        reminder: r.reminder, priority: r.priority, tags: r.tags || [],
        assignee_id: assignee.value || null, start_date: start.value || null,
      };
    }) : [];
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
