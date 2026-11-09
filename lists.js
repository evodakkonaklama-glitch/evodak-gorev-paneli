// Ayarlar > Listeler (owner/admin): Proje sırası, Bölüm ve Kategori listeleri (ekle / yeniden adlandır / çıkar / sırala)
// Bölüm/kategori adını değiştirmek o adı taşıyan görevleri ve şablonları da günceller.
// Listeden çıkarmak görevleri değiştirmez; yalnızca seçim listesinden kalkar.
import { h, icon, toast, clear, confirmDialog } from './ui.js';
import { t, getLang } from './i18n.js';
import { label } from './excel-format.js';
import { supabase } from './supabase.js';
import { store, reloadAll, on } from './store.js';
import { newProjectDialog, editProjectDialog } from './templates.js';

const KINDS = ['project', 'section', 'category'];

export function listsCard() {
  let kind = 'project';
  const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': t('lists.title') });
  const body = h('div', { class: 'lists-body' });
  const card = h('div', { class: 'card', id: 'listeler' },
    h('h2', { class: 'h2' }, t('lists.title')),
    h('p', { class: 'muted small' }, t('lists.help')),
    tabs, body);

  function drawTabs() {
    clear(tabs).append(...KINDS.map((k) => h('button', {
      type: 'button', role: 'tab', class: `seg-btn ${k === kind ? 'active' : ''}`, 'aria-selected': String(k === kind),
      onclick: () => { kind = k; drawTabs(); draw(); },
    }, t(`lists.${k}`))));
  }

  const usage = (k, value) => [...store.tasks.values()].filter((x) => (k === 'section' ? x.section : x.category) === value).length;

  async function move(rows, i, dir, table) {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    const changes = rows.map((r, k) => ({ r, k: k + 1 })).filter(({ r, k }) => r.sort_order !== k);
    const results = await Promise.all(changes.map(({ r, k }) => supabase.from(table).update({ sort_order: k }).eq('id', r.id)));
    if (results.some((x) => x.error)) { toast(t('tpl.err'), { type: 'error' }); }
    changes.forEach(({ r, k }) => { r.sort_order = k; });
    await reloadAll();
  }

  function moveBtns(rows, i, table) {
    return h('span', { class: 'tpl-move' },
      h('button', { class: 'icon-btn icon-btn-sm', type: 'button', 'aria-label': t('tpl.up'), title: t('tpl.up'), disabled: i === 0, onclick: () => move(rows, i, -1, table) }, icon('chevronUp')),
      h('button', { class: 'icon-btn icon-btn-sm', type: 'button', 'aria-label': t('tpl.down'), title: t('tpl.down'), disabled: i === rows.length - 1, onclick: () => move(rows, i, 1, table) }, icon('chevronDown')));
  }

  function drawProjects() {
    const rows = [...store.projects].sort((a, b) => a.sort_order - b.sort_order);
    clear(body).append(
      h('ul', { class: 'list-rows' }, rows.map((p, i) => h('li', { class: `list-row ${p.archived ? 'is-archived' : ''}` },
        h('span', { class: 'list-name' }, p.name, ' ', h('span', { class: 'muted small' }, `${label('project_type', p.type, getLang())}${p.archived ? ` · ${t('np.archived_chip')}` : ''}`)),
        h('span', { class: 'muted small' }, t('lists.used', { n: [...store.tasks.values()].filter((x) => x.project_id === p.id).length })),
        h('button', { class: 'icon-btn icon-btn-sm', type: 'button', title: t('np.edit_title'), 'aria-label': `${t('np.edit_title')}: ${p.name}`, onclick: () => editProjectDialog(p) }, icon('edit')),
        moveBtns(rows, i, 'projects')))),
      h('button', { class: 'btn mt', type: 'button', onclick: () => newProjectDialog() }, icon('plus'), t('np.title')),
      h('p', { class: 'muted small' }, t('lists.project_help')));
  }

  function drawLookups() {
    const rows = store.lookups.filter((l) => l.kind === kind).sort((a, b) => a.sort_order - b.sort_order);
    const input = h('input', { class: 'input', id: 'lst-new', placeholder: t('lists.new_ph'), autocomplete: 'off' });
    const add = h('form', { class: 'row-gap mt' }, h('label', { class: 'sr-only', for: 'lst-new' }, t('lists.new_ph')), input,
      h('button', { class: 'btn btn-primary', type: 'submit' }, icon('plus'), t('lists.add')));
    add.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      if (rows.some((r) => r.value.toLocaleLowerCase('tr') === v.toLocaleLowerCase('tr'))) { toast(t('lists.exists'), { type: 'error' }); return; }
      const { error } = await supabase.from('lookups').insert({ kind, value: v, sort_order: rows.length + 1 });
      if (error) { toast(t('tpl.err'), { type: 'error' }); return; }
      input.value = '';
      await reloadAll();
      toast(t('lists.added', { v }), { type: 'ok' });
    });

    clear(body).append(
      rows.length ? h('ul', { class: 'list-rows' }, rows.map((r, i) => {
        const n = usage(kind, r.value);
        return h('li', { class: 'list-row' },
          h('span', { class: 'list-name' }, r.value),
          h('span', { class: 'muted small' }, t('lists.used', { n })),
          h('button', { class: 'icon-btn icon-btn-sm', type: 'button', title: t('lists.rename'), 'aria-label': `${t('lists.rename')}: ${r.value}`, onclick: () => renameDialog(r, n) }, icon('edit')),
          h('button', { class: 'icon-btn icon-btn-sm', type: 'button', title: t('lists.remove'), 'aria-label': `${t('lists.remove')}: ${r.value}`, onclick: async () => {
            if (!(await confirmDialog(n ? t('lists.remove_used', { v: r.value, n }) : t('lists.remove_confirm', { v: r.value }), { confirmLabel: t('lists.remove'), danger: true }))) return;
            const { error } = await supabase.from('lookups').delete().eq('id', r.id);
            if (error) { toast(t('tpl.err'), { type: 'error' }); return; }
            await reloadAll();
          } }, icon('trash')),
          moveBtns(rows, i, 'lookups'));
      })) : h('p', { class: 'muted' }, t('lists.empty')),
      add);
  }

  function renameDialog(r, n) {
    const msg = h('p', { class: 'form-msg', role: 'alert' });
    const input = h('input', { class: 'input', id: 'lst-rename', value: r.value });
    const form = h('form', { class: 'form', novalidate: true },
      h('h2', { class: 'h2' }, t('lists.rename')),
      h('div', { class: 'field' }, h('label', { for: 'lst-rename' }, t('lists.new_name')), input),
      n ? h('p', { class: 'muted small' }, t('lists.rename_help', { n })) : null,
      msg,
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('common.cancel')),
        h('button', { class: 'btn btn-primary', type: 'submit' }, t('common.save'))));
    const dlg = h('dialog', { class: 'dialog' }, form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v || v === r.value) { dlg.close(); return; }
      const { data, error } = await supabase.rpc('rename_lookup', { p_kind: kind, p_old: r.value, p_new: v });
      if (error) { msg.textContent = error.code === '23505' ? t('lists.exists') : t('tpl.err'); msg.className = 'form-msg form-msg-error'; return; }
      dlg.close();
      toast(t('lists.renamed', { n: data }), { type: 'ok' });
      reloadAll();
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    input.select();
  }

  function draw() { if (kind === 'project') drawProjects(); else drawLookups(); }
  drawTabs(); draw();
  const off = on('data', () => { if (card.isConnected) draw(); else off(); });
  return card;
}
