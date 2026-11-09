// Çöp kutusu (owner/admin): silinen görevler 30 gün burada kalır, sonra gece bakımında kalıcı silinir.
// Geri yükleme: owner/admin. Kalıcı silme ve çöpü boşaltma: yalnızca owner.
import { h, icon, toast, clear, confirmDialog, spinner } from './ui.js';
import { t } from './i18n.js';
import { supabase } from './supabase.js';
import { store, reloadAll } from './store.js';
import { fmtDate } from './dates.js';
import { callFn } from './people.js';

const DAYS = 30;

export async function render(root, ctx) {
  if (!ctx.isAdmin) { location.hash = '#/bugun'; return null; }
  const isOwner = ctx.profile.role === 'owner';
  const list = h('div', { class: 'trash-list' });
  const count = h('p', { class: 'muted count' });
  const emptyBtn = isOwner ? h('button', { class: 'btn btn-danger-outline', type: 'button' }, icon('trash'), t('trash.empty_btn')) : null;
  root.append(h('section', { class: 'page page-narrow' },
    h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'h1' }, t('trash.title')), count), emptyBtn),
    h('p', { class: 'muted small' }, t('trash.help', { n: DAYS })),
    list));

  let rows = [];
  const projectName = (id) => store.projects.find((p) => p.id === id)?.name || '';
  const personName = (id) => store.profiles.find((p) => p.id === id)?.full_name || '';

  function draw() {
    count.textContent = t('trash.count', { n: rows.length });
    if (emptyBtn) emptyBtn.disabled = !rows.length;
    if (!rows.length) { clear(list).append(h('div', { class: 'state' }, icon('trash', 'icon-lg'), h('p', {}, t('trash.none')))); return; }
    clear(list).append(...rows.map((r) => {
      const age = Math.floor((Date.now() - new Date(r.deleted_at).getTime()) / 86400000);
      const left = Math.max(0, DAYS - age);
      return h('div', { class: 'trash-row' },
        h('div', { class: 'trash-main' },
          h('div', { class: 'trash-title' }, h('span', { class: 'muted' }, `#${r.no} `), r.title),
          h('div', { class: 'muted small' }, [projectName(r.project_id), r.section].filter(Boolean).join(' · ')),
          h('div', { class: 'small' }, t('trash.deleted_info', { date: fmtDate(r.deleted_at.slice(0, 10)), who: personName(r.updated_by) || '—' }),
            ' · ', h('span', { class: left <= 3 ? 'text-red' : 'muted' }, t('trash.days_left', { n: left })))),
        h('div', { class: 'trash-actions' },
          h('button', { class: 'btn btn-sm', type: 'button', onclick: async (e) => {
            e.currentTarget.disabled = true;
            const { error } = await supabase.from('tasks').update({ deleted_at: null }).eq('id', r.id);
            if (error) { toast(t('trash.err'), { type: 'error' }); e.currentTarget.disabled = false; return; }
            rows = rows.filter((x) => x.id !== r.id); draw();
            toast(t('trash.restored', { title: r.title }), { type: 'ok', action: { label: t('trash.open'), run: () => { location.hash = `#/gorev/${r.id}`; } } });
            reloadAll();
          } }, icon('undo'), t('trash.restore')),
          isOwner ? h('button', { class: 'btn btn-sm btn-danger-outline', type: 'button', onclick: async () => {
            if (!(await confirmDialog(t('trash.purge_confirm', { title: r.title }), { confirmLabel: t('trash.purge'), danger: true }))) return;
            const res = await callFn('maintenance', { mode: 'purge', task_ids: [r.id] });
            if (!res.ok) { toast(t('trash.err'), { type: 'error' }); return; }
            rows = rows.filter((x) => x.id !== r.id); draw();
            toast(t('trash.purged', { n: 1 }), { type: 'ok' });
          } }, t('trash.purge')) : null));
    }));
  }

  async function load() {
    clear(list).append(spinner());
    const { data, error } = await supabase.from('tasks').select('id,no,title,project_id,section,deleted_at,updated_by')
      .not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(1000);
    if (error) { clear(list).append(h('p', { class: 'form-msg form-msg-error' }, t('trash.err'))); return; }
    rows = data; draw();
  }

  if (emptyBtn) emptyBtn.addEventListener('click', async () => {
    if (!(await confirmDialog(t('trash.empty_confirm', { n: rows.length }), { confirmLabel: t('trash.empty_btn'), danger: true }))) return;
    emptyBtn.disabled = true;
    const res = await callFn('maintenance', { mode: 'purge' });
    if (!res.ok) { toast(t('trash.err'), { type: 'error' }); emptyBtn.disabled = false; return; }
    toast(t('trash.purged', { n: res.tasks }), { type: 'ok' });
    load();
  });

  load();
  return null;
}
