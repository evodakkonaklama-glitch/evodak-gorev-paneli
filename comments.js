// Görev yorumları: görevi gören herkes okur; owner/admin/üye yazar. Sorumluya zil bildirimi sunucuda gider.
import { h, clear, icon, toast, confirmDialog } from './ui.js';
import { t } from './i18n.js';
import { fmtDateTime } from './dates.js';
import { supabase, friendlyError } from './supabase.js';
import { store, on } from './store.js';

export function commentsSection(taskId, ctx) {
  const list = h('ul', { class: 'comment-list' });
  const count = h('span', { class: 'quick-n' }, '0');
  const canWrite = ['owner', 'admin', 'member'].includes(ctx.profile.role) && navigator.onLine !== false;
  const input = h('textarea', { class: 'input', rows: 2, id: `cm-${taskId}`, placeholder: t('cm.placeholder'), maxlength: 4000 });
  const send = h('button', { class: 'btn btn-primary', type: 'submit' }, t('cm.send'));
  const form = canWrite ? h('form', { class: 'comment-form' },
    h('label', { class: 'sr-only', for: `cm-${taskId}` }, t('cm.placeholder')), input, send) : null;
  const el = h('section', { class: 'comments field-wide' },
    h('h3', { class: 'h3' }, icon('chat'), t('cm.title'), count), list, form);

  const name = (pid) => store.profiles.find((p) => p.id === pid)?.full_name || t('detail.system');
  let rows = [];
  function draw() {
    count.textContent = String(rows.length);
    if (!rows.length) { clear(list).append(h('li', { class: 'muted small' }, t('cm.none'))); return; }
    clear(list).append(...rows.map((c) => h('li', { class: `comment ${c.profile_id === ctx.profile.id ? 'is-mine' : ''}` },
      h('div', { class: 'comment-head' },
        h('strong', {}, name(c.profile_id)), h('span', { class: 'muted small' }, fmtDateTime(c.created_at)),
        (c.profile_id === ctx.profile.id || ctx.isAdmin) ? h('button', {
          class: 'icon-btn icon-btn-sm comment-del', type: 'button', title: t('common.delete'), 'aria-label': t('common.delete'),
          onclick: async () => {
            if (!(await confirmDialog(t('cm.delete_confirm'), { confirmLabel: t('common.delete'), danger: true }))) return;
            const { error } = await supabase.from('task_comments').delete().eq('id', c.id);
            if (error) toast(friendlyError(error), { type: 'error' }); else load();
          } }, icon('x')) : null),
      h('p', { class: 'comment-text' }, c.text))));
  }
  async function load() {
    const { data, error } = await supabase.from('task_comments').select('id,profile_id,text,created_at').eq('task_id', taskId).order('created_at');
    if (error) { clear(list).append(h('li', { class: 'form-msg-error small' }, friendlyError(error))); return; }
    rows = data; draw();
  }
  if (form) {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      const { error } = await supabase.from('task_comments').insert({ task_id: taskId, profile_id: ctx.profile.id, text });
      send.disabled = false;
      if (error) { toast(friendlyError(error), { type: 'error' }); return; }
      input.value = '';
      load();
    });
  }
  load();
  const off = on('comments', (tid) => { if (!tid || tid === taskId) load(); });
  return { el, destroy: off };
}
