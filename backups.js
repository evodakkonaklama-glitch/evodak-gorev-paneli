// Ayarlar > Veri ve yedekler (owner/admin): Excel içe/dışa aktarma, çöp kutusu, yedek listesi
import { h, icon, toast, clear, confirmDialog } from './ui.js';
import { t, getLang } from './i18n.js';
import { supabase } from './supabase.js';
import { store, reloadAll } from './store.js';
import { exportTasks } from './export.js';
import { callFn } from './people.js';

const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

async function download(path) {
  const name = path.split('/').pop();
  const { data, error } = await supabase.storage.from('backups').createSignedUrl(path, 300, { download: name });
  if (error) { toast(t('backup.err'), { type: 'error' }); return; }
  const a = h('a', { href: data.signedUrl, download: name });
  document.body.append(a); a.click(); a.remove();
}

export function dataCard(ctx) {
  const isOwner = ctx.profile.role === 'owner';
  const list = h('div', { class: 'backup-list' });
  const nowBtn = h('button', { class: 'btn', type: 'button' }, icon('save'), t('backup.now'));

  async function load() {
    clear(list).append(h('p', { class: 'muted small' }, t('app.loading')));
    const { data, error } = await supabase.from('backups').select('id,json_path,xlsx_path,size_bytes,kind,created_at').order('created_at', { ascending: false }).limit(20);
    if (error) { clear(list).append(h('p', { class: 'form-msg form-msg-error' }, t('backup.err'))); return; }
    if (!data.length) { clear(list).append(h('p', { class: 'muted small' }, t('backup.none'))); return; }
    const df = new Intl.DateTimeFormat(getLang() === 'en' ? 'en-GB' : 'tr-TR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
    clear(list).append(...data.map((b) => h('div', { class: 'backup-row' },
      h('div', {}, h('div', { class: 'backup-date' }, df.format(new Date(b.created_at))),
        h('div', { class: 'muted small' }, `${t(b.kind === 'manual' ? 'backup.manual' : 'backup.weekly')} · ${fmtSize(b.size_bytes || 0)}`)),
      h('div', { class: 'row-gap' },
        b.xlsx_path ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => download(b.xlsx_path) }, icon('download'), 'Excel') : null,
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => download(b.json_path) }, icon('download'), 'JSON'),
        isOwner ? h('button', { class: 'btn btn-sm btn-danger-outline', type: 'button', onclick: () => restore(b, df.format(new Date(b.created_at))) }, icon('undo'), t('backup.restore')) : null))));
  }

  // Geri yükleme: yalnızca owner, iki onay. Sunucu önce şimdiki halin yedeğini alır.
  async function restore(b, when) {
    if (!(await confirmDialog(t('backup.restore_confirm1', { when }), { confirmLabel: t('backup.restore_continue'), danger: true }))) return;
    if (!(await confirmDialog(t('backup.restore_confirm2', { when }), { confirmLabel: t('backup.restore'), danger: true }))) return;
    const wait = toast(t('backup.restoring'), { timeout: 0 });
    const r = await callFn('maintenance', { mode: 'restore', backup_id: b.id });
    wait.remove();
    if (!r.ok) { toast(t('backup.restore_err', { msg: r.error || '' }), { type: 'error', timeout: 10000 }); load(); return; }
    toast(t('backup.restored', { n: r.restored?.tasks ?? 0 }), { type: 'ok', timeout: 8000 });
    await reloadAll();
    load();
  }

  nowBtn.addEventListener('click', async () => {
    nowBtn.disabled = true; nowBtn.lastChild.textContent = t('backup.working');
    const r = await callFn('maintenance', { mode: 'backup' });
    nowBtn.disabled = false; nowBtn.lastChild.textContent = t('backup.now');
    if (!r.ok) { toast(t('backup.err'), { type: 'error' }); return; }
    toast(t('backup.done', { n: r.backup?.tasks ?? 0 }), { type: 'ok' });
    load();
  });

  const card = h('div', { class: 'card', id: 'veri' },
    h('h2', { class: 'h2' }, t('settings.data')),
    h('div', { class: 'data-actions' },
      h('a', { class: 'btn', href: '#/ice-aktar' }, icon('upload'), t('settings.import_excel')),
      h('button', { class: 'btn', type: 'button', onclick: () => exportTasks([...store.tasks.values()]) }, icon('download'), t('export.all')),
      h('a', { class: 'btn', href: '#/cop' }, icon('trash'), t('trash.title'))),
    h('p', { class: 'muted small' }, t('export.help')),
    h('h3', { class: 'h3 mt' }, t('backup.title')),
    h('p', { class: 'muted small' }, t('backup.help')),
    list,
    h('div', { class: 'mt' }, nowBtn));
  load();
  return card;
}
