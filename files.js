// Görev dosyaları: yükleme (ilerleme çubuğu), liste, önizleme, indirme, silme
// Dosyalar özel "files" deposunda durur; açmak için 1 saatlik imzalı link üretilir.
import { h, clear, icon, toast, confirmDialog } from './ui.js';
import { t } from './i18n.js';
import { supabase, friendlyError, SUPABASE_BASE, SUPABASE_KEY } from './supabase.js';
import { store, on } from './store.js';
import { fmtDateTime } from './dates.js';

export const MAX_BYTES = 20 * 1024 * 1024;
export const QUOTA_BYTES = 1024 * 1024 * 1024;
const BUCKET = 'files';

export function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2).replace('.', ',')} GB`;
}

// Depo anahtarında sorun çıkaran karakterleri temizle (asıl ad veritabanında saklanır)
export function safeName(name) {
  const map = { ı: 'i', İ: 'I', ş: 's', Ş: 'S', ğ: 'g', Ğ: 'G', ü: 'u', Ü: 'U', ö: 'o', Ö: 'O', ç: 'c', Ç: 'C' };
  const cleaned = String(name || 'dosya')
    .replace(/[ıİşŞğĞüÜöÖçÇ]/g, (c) => map[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[_.]+/, '');
  return (cleaned || 'dosya').slice(-80);
}

function kindOf(mime, name) {
  if (/^image\//.test(mime || '')) return 'image';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  return 'other';
}

const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

// Yükleme: XMLHttpRequest ile (ilerleme yüzdesi için)
function uploadToStorage(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    supabase.auth.getSession().then(({ data }) => {
      const token = data?.session?.access_token;
      if (!token) { reject(new Error(t('files.need_login'))); return; }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${SUPABASE_BASE}/storage/v1/object/${BUCKET}/${encodePath(path)}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', SUPABASE_KEY);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.setRequestHeader('cache-control', '3600');
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) { resolve(path); return; }
        let msg = xhr.responseText;
        try { const j = JSON.parse(xhr.responseText); msg = j.message || j.error || msg; } catch { /* düz metin */ }
        if (xhr.status === 413 || /size|large/i.test(msg)) msg = t('files.too_big');
        else if (xhr.status === 403 || /row-level|policy|unauthorized/i.test(msg)) msg = t('files.no_permission');
        reject(new Error(msg));
      };
      xhr.onerror = () => reject(new Error(t('auth.network')));
      xhr.send(file);
    }, reject);
  });
}

async function signedUrl(path, download) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600, download ? { download } : undefined);
  if (error) throw error;
  return data.signedUrl;
}

export async function storageUsage() {
  const { data, error } = await supabase.rpc('storage_usage');
  if (error) throw error;
  return data || { bytes: 0, files: 0 };
}

// ---------------------------------------------------------------- önizleme penceresi
async function preview(att) {
  let url;
  try { url = await signedUrl(att.storage_path); } catch (err) { toast(friendlyError(err), { type: 'error' }); return; }
  const kind = kindOf(att.mime_type, att.file_name);
  const body = kind === 'image'
    ? h('img', { src: url, alt: att.file_name, class: 'preview-img' })
    : h('iframe', { src: url, title: att.file_name, class: 'preview-frame' });
  const dlg = h('dialog', { class: 'dialog dialog-preview' },
    h('div', { class: 'preview-head' }, h('strong', { class: 'preview-name' }, att.file_name),
      h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, icon('link'), t('files.open_new')),
      h('button', { class: 'icon-btn-dark', type: 'button', 'aria-label': t('common.close'), onclick: () => dlg.close() }, icon('x'))),
    body);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
}

async function download(att) {
  try {
    const url = await signedUrl(att.storage_path, att.file_name);
    const a = h('a', { href: url, download: att.file_name, rel: 'noopener' });
    document.body.append(a); a.click(); a.remove();
  } catch (err) { toast(friendlyError(err), { type: 'error' }); }
}

// ---------------------------------------------------------------- görev detayındaki bölüm
export function attachmentsSection(taskId, ctx, editable) {
  const box = h('div', { class: 'files-box' });
  const list = h('ul', { class: 'file-list' });
  const uploads = h('ul', { class: 'upload-list', 'aria-live': 'polite' });
  const usage = h('p', { class: 'muted small' });
  const input = h('input', { type: 'file', multiple: true, class: 'sr-only', id: `file-${taskId}` });

  async function load() {
    const { data, error } = await supabase.from('attachments')
      .select('id,storage_path,file_name,mime_type,size_bytes,uploaded_by,created_at')
      .eq('task_id', taskId).order('created_at');
    clear(list);
    if (error) { list.append(h('li', { class: 'form-msg-error' }, friendlyError(error))); return; }
    if (!data.length) { list.append(h('li', { class: 'muted small' }, t('files.none'))); return; }
    for (const att of data) {
      const kind = kindOf(att.mime_type, att.file_name);
      const who = store.profiles.find((p) => p.id === att.uploaded_by)?.full_name || '—';
      list.append(h('li', { class: 'file-item' },
        h('span', { class: `file-icon file-${kind}` }, icon(kind === 'image' ? 'image' : 'file')),
        h('div', { class: 'file-info' },
          kind === 'other'
            ? h('button', { type: 'button', class: 'file-name', onclick: () => download(att) }, att.file_name)
            : h('button', { type: 'button', class: 'file-name', onclick: () => preview(att) }, att.file_name),
          h('span', { class: 'muted small' }, `${fmtSize(att.size_bytes)} · ${who} · ${fmtDateTime(att.created_at)}`)),
        h('div', { class: 'file-tools' },
          kind !== 'other' ? h('button', { type: 'button', class: 'icon-btn-sm', 'aria-label': `${t('files.preview')}: ${att.file_name}`, title: t('files.preview'), onclick: () => preview(att) }, icon('eye')) : null,
          h('button', { type: 'button', class: 'icon-btn-sm', 'aria-label': `${t('files.download')}: ${att.file_name}`, title: t('files.download'), onclick: () => download(att) }, icon('download')),
          editable ? h('button', { type: 'button', class: 'icon-btn-sm danger', 'aria-label': `${t('files.delete')}: ${att.file_name}`, title: t('files.delete'), onclick: () => remove(att) }, icon('trash')) : null)));
    }
  }

  async function remove(att) {
    const ok = await confirmDialog(t('files.delete_confirm', { name: att.file_name }), { confirmLabel: t('files.delete'), danger: true });
    if (!ok) return;
    const { error: e1 } = await supabase.storage.from(BUCKET).remove([att.storage_path]);
    if (e1) { toast(friendlyError(e1), { type: 'error' }); return; }
    const { error: e2 } = await supabase.from('attachments').delete().eq('id', att.id);
    if (e2) { toast(friendlyError(e2), { type: 'error' }); return; }
    toast(t('files.deleted'), { type: 'ok' });
    load(); loadUsage();
  }

  async function loadUsage() {
    if (!ctx.isAdmin) return;
    try {
      const u = await storageUsage();
      usage.textContent = t('files.usage', { used: fmtSize(u.bytes), total: fmtSize(QUOTA_BYTES) });
    } catch { usage.textContent = ''; }
  }

  async function uploadOne(file) {
    const row = h('li', { class: 'upload-item' });
    const bar = h('div', { class: 'progress-fill', style: 'width:0%' });
    const pct = h('span', { class: 'progress-text' }, '0%');
    row.append(h('span', { class: 'upload-name' }, file.name), h('div', { class: 'progress' }, h('div', { class: 'progress-track' }, bar), pct));
    uploads.append(row);

    if (file.size > MAX_BYTES) {
      clear(row).append(h('span', { class: 'form-msg-error' }, icon('alert'), ` ${file.name}: ${t('files.too_big_video')}`));
      setTimeout(() => row.remove(), 12000);
      return;
    }
    const path = `${taskId}/${crypto.randomUUID().slice(0, 8)}-${safeName(file.name)}`;
    try {
      await uploadToStorage(path, file, (p) => { const v = Math.round(p * 100); bar.style.width = `${v}%`; pct.textContent = `${v}%`; });
      const { error } = await supabase.from('attachments').insert({
        task_id: taskId, storage_path: path, file_name: file.name,
        mime_type: file.type || null, size_bytes: file.size, uploaded_by: ctx.profile.id,
      });
      if (error) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw error;
      }
      row.remove();
      load(); loadUsage();
    } catch (err) {
      clear(row).append(h('span', { class: 'form-msg-error' }, icon('alert'), ` ${file.name}: ${err.message || friendlyError(err)}`));
      setTimeout(() => row.remove(), 12000);
    }
  }

  async function handleFiles(files) {
    for (const f of [...files]) await uploadOne(f);
    input.value = '';
  }

  input.addEventListener('change', () => handleFiles(input.files));

  const drop = editable ? h('label', { class: 'file-drop', for: input.id },
    icon('upload'), h('span', {}, h('strong', {}, t('files.choose')), ' ', h('span', { class: 'muted' }, t('files.drop'))),
    h('span', { class: 'muted small' }, t('files.limit'))) : null;
  if (drop) {
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('drag'); handleFiles(e.dataTransfer.files); });
  }

  box.append(h('h3', { class: 'h3' }, t('files.title')), list, uploads, editable ? input : null, drop, usage);
  load(); loadUsage();
  const off = on('attachments', (tid) => { if (!tid || tid === taskId) load(); });
  return { el: box, destroy: off };
}

// ---------------------------------------------------------------- Ayarlar: alan göstergesi
export function storageCard() {
  const fill = h('div', { class: 'progress-fill', style: 'width:0%' });
  const text = h('p', { class: 'muted small' }, t('app.loading'));
  const card = h('div', { class: 'card' },
    h('h2', { class: 'h2' }, t('files.storage')),
    h('div', { class: 'progress' }, h('div', { class: 'progress-track' }, fill)),
    text,
    h('p', { class: 'muted small' }, t('files.storage_note')));
  storageUsage().then((u) => {
    const pct = Math.min(100, (u.bytes / QUOTA_BYTES) * 100);
    fill.style.width = `${Math.max(pct, u.bytes ? 1 : 0)}%`;
    if (pct > 85) fill.classList.add('fill-red'); else if (pct > 60) fill.classList.add('fill-amber');
    text.textContent = t('files.usage_full', { used: fmtSize(u.bytes), total: fmtSize(QUOTA_BYTES), n: u.files, pct: pct.toFixed(1).replace('.', ',') });
  }).catch((err) => { text.textContent = friendlyError(err); });
  return card;
}
