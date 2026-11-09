// Veri katmanı: tek kaynak (görevler, maddeler, projeler, kişiler, listeler)
// - Alan değişince 600 ms sonra yalnızca değişen alan kaydedilir
// - Sürüm (version) kontrolüyle çakışma: başkası AYNI alanı değiştirdiyse sorulur, farklı alansa birleştirilir
// - Çevrimdışıyken değişiklikler IndexedDB kuyruğuna yazılır, bağlanınca sırayla gönderilir
// - Realtime ile diğer kişinin değişiklikleri birkaç saniyede gelir
import { supabase, fetchAll } from './supabase.js';
import { kv, queue } from './idb.js';

const SAVE_DELAY = 600;
const listeners = new Map();
const pending = new Map();          // taskId -> { patch, base, timer }
const pendingItems = new Map();     // itemId -> { taskId, values, timer }
let inflight = 0;
let lastError = null;
let channel = null;
let snapshotTimer = null;
let flushing = false;
let profileId = null;

export const store = {
  ready: false,
  offlineData: false,               // veriler çevrimdışı kopyadan mı yüklendi
  tasks: new Map(),
  checklist: new Map(),             // taskId -> [madde]
  projects: [],
  profiles: [],
  lookups: [],
  status: 'saved',                  // saved | saving | offline | error
  queued: 0,
};

// ---------------------------------------------------------------- olaylar
export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}
function emit(event, payload) { (listeners.get(event) || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } }); }

let dataTimer = null;
function emitData() { clearTimeout(dataTimer); dataTimer = setTimeout(() => emit('data'), 150); }

// ---------------------------------------------------------------- yardımcılar
const TASK_COLS = 'id,no,project_id,section,category,title,description,tags,status,priority,progress,assignee_id,start_date,due_date,due_time,estimate_minutes,recurrence,recurrence_day,reminder,reference_links,completed_at,version,deleted_at,created_at,updated_at,created_by,updated_by';

function isNetErr(e) {
  if (!navigator.onLine) return true;
  const m = String(e?.message || e || '');
  return e?.name === 'TypeError' || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(m);
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Sağ üstteki durum: Kaydedildi / Kaydediliyor… / Çevrimdışı / Kayıt başarısız
function updateStatus() {
  const busy = pending.size || pendingItems.size || inflight;
  let s;
  if (!navigator.onLine || store.queued) s = 'offline';
  else if (busy) s = 'saving';
  else if (lastError) s = 'error';
  else s = 'saved';
  if (s !== store.status) { store.status = s; emit('status', s); } else if (s === 'offline') emit('status', s);
}

function scheduleSnapshot() {
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(saveSnapshot, 3000);
}

async function saveSnapshot() {
  if (!profileId) return;
  const items = [];
  store.checklist.forEach((list) => items.push(...list));
  await kv.set(`snapshot:${profileId}`, {
    at: Date.now(), tasks: [...store.tasks.values()], checklist: items,
    projects: store.projects, profiles: store.profiles, lookups: store.lookups,
  });
}

function setChecklist(items) {
  store.checklist = new Map();
  for (const it of items) {
    if (!store.checklist.has(it.task_id)) store.checklist.set(it.task_id, []);
    store.checklist.get(it.task_id).push(it);
  }
  store.checklist.forEach((list) => list.sort((a, b) => a.sort_order - b.sort_order));
}

// ---------------------------------------------------------------- yükleme
export async function loadAll(profile) {
  profileId = profile.id;
  try {
    const [tasks, items, projects, profiles, lookups] = await Promise.all([
      fetchAll(() => supabase.from('tasks').select(TASK_COLS).is('deleted_at', null).order('no')),
      fetchAll(() => supabase.from('checklist_items').select('id,task_id,text,note,done,done_at,done_by,sort_order').order('task_id').order('sort_order')),
      fetchAll(() => supabase.from('projects').select('id,name,type,sort_order,archived').order('sort_order')),
      fetchAll(() => supabase.from('profiles').select('id,full_name,email,role,active').order('full_name')),
      fetchAll(() => supabase.from('lookups').select('id,kind,value,sort_order').order('sort_order')),
    ]);
    store.tasks = new Map(tasks.map((t) => [t.id, t]));
    setChecklist(items);
    Object.assign(store, { projects, profiles, lookups, offlineData: false });
    saveSnapshot();
  } catch (err) {
    const snap = await kv.get(`snapshot:${profile.id}`);
    if (!snap) throw err;
    store.tasks = new Map(snap.tasks.map((t) => [t.id, t]));
    setChecklist(snap.checklist);
    Object.assign(store, { projects: snap.projects, profiles: snap.profiles, lookups: snap.lookups, offlineData: true });
  }
  // Gönderilmeyi bekleyen değişiklikleri yerel veriye yeniden uygula
  const q = await queue.all();
  store.queued = q.length;
  for (const op of q) applyOpLocally(op);
  store.ready = true;
  updateStatus();
  emit('data');
  subscribeRealtime();
  flushQueue();
}

export async function reloadAll() {
  if (!profileId) return;
  await loadAll({ id: profileId });
}

export function reset() {
  if (channel) { supabase.removeChannel(channel); channel = null; }
  store.ready = false; store.tasks = new Map(); store.checklist = new Map();
  pending.clear(); pendingItems.clear(); profileId = null;
}

// ---------------------------------------------------------------- Realtime
function subscribeRealtime() {
  if (channel) return;
  channel = supabase.channel('evodak-data')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (p) => {
      if (p.eventType === 'DELETE') { store.tasks.delete(p.old.id); emitData(); return; }
      applyServerTask(p.new, true);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'checklist_items' }, (p) => {
      if (p.eventType === 'DELETE') {
        for (const [tid, list] of store.checklist) {
          const i = list.findIndex((x) => x.id === p.old.id);
          if (i >= 0) { list.splice(i, 1); emit('checklist', tid); break; }
        }
        return;
      }
      const it = p.new;
      if (pendingItems.has(it.id)) return; // kullanıcı bu maddeyi düzenliyor
      const list = store.checklist.get(it.task_id) || [];
      const i = list.findIndex((x) => x.id === it.id);
      if (i >= 0) list[i] = { ...list[i], ...it }; else list.push(it);
      list.sort((a, b) => a.sort_order - b.sort_order);
      store.checklist.set(it.task_id, list);
      emit('checklist', it.task_id);
      scheduleSnapshot();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attachments' }, (p) => emit('attachments', p.new?.task_id || null))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, (p) => emit('comments', p.new?.task_id || null))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_time_blocks' }, () => emit('blocks'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, () => refreshSmall('projects'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lookups' }, () => refreshSmall('lookups'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => refreshSmall('profiles'))
    .subscribe((status) => { if (status === 'SUBSCRIBED') emit('realtime', true); });
}

async function refreshSmall(kind) {
  const sel = { projects: 'id,name,type,sort_order,archived', lookups: 'id,kind,value,sort_order', profiles: 'id,full_name,email,role,active' }[kind];
  const q = supabase.from(kind).select(sel);
  const { data } = await (kind === 'profiles' ? q.order('full_name') : q.order('sort_order'));
  if (data) { store[kind] = data; emitData(); scheduleSnapshot(); }
}

// Sunucudan gelen satırı yerele uygula; kullanıcının henüz kaydedilmemiş alanları korunur
function applyServerTask(row, fromRealtime = false) {
  if (!row) return;
  if (row.deleted_at) { store.tasks.delete(row.id); emitData(); emit('task', row.id); return; }
  const local = store.tasks.get(row.id);
  if (local && local.version > row.version && fromRealtime) return; // eski olay
  const p = pending.get(row.id);
  const merged = { ...(local || {}), ...row };
  if (p) for (const k of Object.keys(p.patch)) merged[k] = p.patch[k];
  store.tasks.set(row.id, merged);
  emit('task', row.id);
  emitData();
  scheduleSnapshot();
}

async function refreshTask(id) {
  const { data } = await supabase.from('tasks').select(TASK_COLS).eq('id', id).maybeSingle();
  if (data) applyServerTask(data);
  else if (data === null) { store.tasks.delete(id); emitData(); emit('task', id); }
}

async function refreshItems(taskId) {
  const { data } = await supabase.from('checklist_items').select('id,task_id,text,note,done,done_at,done_by,sort_order').eq('task_id', taskId).order('sort_order');
  if (data) { store.checklist.set(taskId, data); emit('checklist', taskId); }
}

// ---------------------------------------------------------------- görev düzenleme
export function updateTask(id, patch) {
  const t = store.tasks.get(id);
  if (!t) return;
  let p = pending.get(id);
  if (!p) { p = { patch: {}, base: {} }; pending.set(id, p); }
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in p.base)) p.base[k] = t[k];
    p.patch[k] = v;
  }
  Object.assign(t, patch);
  clearTimeout(p.timer);
  p.timer = setTimeout(() => flushTask(id), SAVE_DELAY);
  updateStatus();
  emit('task', id);
  emitData();
}

export function flushTask(id) {
  const p = pending.get(id);
  if (!p) return Promise.resolve();
  clearTimeout(p.timer);
  pending.delete(id);
  const t = store.tasks.get(id);
  return send({ kind: 'task', id, patch: p.patch, base: p.base, version: t ? t.version : null });
}

export async function flushAll() {
  await Promise.all([...pending.keys()].map(flushTask));
  await Promise.all([...pendingItems.keys()].map(flushItem));
}

export function hasPending(id, field) {
  const p = pending.get(id);
  return Boolean(p && field in p.patch);
}

export async function createTask(values) {
  const maxNo = Math.max(0, ...[...store.tasks.values()].map((t) => t.no || 0));
  const row = {
    id: crypto.randomUUID(), no: maxNo + 1, status: 'todo', priority: 'medium', progress: 0,
    tags: [], reference_links: [], recurrence: 'once', reminder: 'none', due_time: '09:00:00', version: 1,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...values,
  };
  store.tasks.set(row.id, row);
  emitData();
  const insertValues = { ...row };
  ['progress', 'version', 'created_at', 'updated_at'].forEach((k) => delete insertValues[k]);
  await send({ kind: 'insert-task', id: row.id, values: insertValues });
  return row;
}

export async function deleteTask(id) {
  const t = store.tasks.get(id);
  if (!t) return null;
  await flushTask(id);
  const copy = { ...t };
  store.tasks.delete(id);
  emitData();
  await send({ kind: 'task', id, patch: { deleted_at: new Date().toISOString() }, base: { deleted_at: null }, version: t.version, force: true });
  return copy;
}

export async function restoreTask(copy) {
  store.tasks.set(copy.id, { ...copy, deleted_at: null });
  emitData();
  await send({ kind: 'restore', id: copy.id });
}

// ---------------------------------------------------------------- kontrol listesi
function itemsOf(taskId) {
  if (!store.checklist.has(taskId)) store.checklist.set(taskId, []);
  return store.checklist.get(taskId);
}

function recalcLocal(taskId) {
  // Sunucu kesin hesabı yapar; burada yalnızca ekranda hemen göstermek için tahmini oran
  const t = store.tasks.get(taskId);
  const list = itemsOf(taskId);
  if (!t) return;
  if (t.recurrence !== 'once') { emit('task', taskId); emitData(); return; } // tekrar döngüsünü sunucu yönetir
  if (list.length) {
    const done = list.filter((x) => x.done).length;
    t.progress = Math.round((done * 100) / list.length);
    if (done === list.length) t.status = 'done';
    else if (done > 0 && (t.status === 'todo' || t.status === 'done')) t.status = 'in_progress';
    else if (t.status === 'done') t.status = 'in_progress';
  }
  emit('task', taskId);
  emitData();
}

export async function addItem(taskId, text, note = '') {
  const list = itemsOf(taskId);
  const it = { id: crypto.randomUUID(), task_id: taskId, text, note: note || null, done: false, sort_order: (list.at(-1)?.sort_order ?? 0) + 1 };
  list.push(it);
  emit('checklist', taskId);
  recalcLocal(taskId);
  await send({ kind: 'item', action: 'insert', id: it.id, taskId, values: { id: it.id, task_id: taskId, text, note: it.note, sort_order: it.sort_order } });
}

export async function toggleItem(taskId, itemId, done) {
  const it = itemsOf(taskId).find((x) => x.id === itemId);
  if (!it) return;
  it.done = done;
  emit('checklist', taskId);
  recalcLocal(taskId);
  await send({ kind: 'item', action: 'update', id: itemId, taskId, values: { done } });
}

export function editItem(taskId, itemId, values) {
  const it = itemsOf(taskId).find((x) => x.id === itemId);
  if (!it) return;
  Object.assign(it, values);
  let p = pendingItems.get(itemId);
  if (!p) { p = { taskId, values: {} }; pendingItems.set(itemId, p); }
  Object.assign(p.values, values);
  clearTimeout(p.timer);
  p.timer = setTimeout(() => flushItem(itemId), SAVE_DELAY);
  updateStatus();
}

function flushItem(itemId) {
  const p = pendingItems.get(itemId);
  if (!p) return Promise.resolve();
  clearTimeout(p.timer);
  pendingItems.delete(itemId);
  return send({ kind: 'item', action: 'update', id: itemId, taskId: p.taskId, values: p.values });
}

export async function deleteItem(taskId, itemId) {
  const list = itemsOf(taskId);
  const i = list.findIndex((x) => x.id === itemId);
  if (i < 0) return;
  list.splice(i, 1);
  pendingItems.delete(itemId);
  emit('checklist', taskId);
  recalcLocal(taskId);
  await send({ kind: 'item', action: 'delete', id: itemId, taskId });
}

export async function reorderItems(taskId, orderedIds) {
  const list = itemsOf(taskId);
  const byId = new Map(list.map((x) => [x.id, x]));
  const changes = [];
  orderedIds.forEach((id, idx) => {
    const it = byId.get(id);
    if (it && it.sort_order !== idx + 1) { it.sort_order = idx + 1; changes.push(it); }
  });
  list.sort((a, b) => a.sort_order - b.sort_order);
  emit('checklist', taskId);
  for (const it of changes) await send({ kind: 'item', action: 'update', id: it.id, taskId, values: { sort_order: it.sort_order } });
}

// Durum değişikliği: "Tamamlandı"ya alınan görevin açık maddeleri de tiklenir (oran %100 olsun)
export async function setStatus(taskId, status) {
  const t = store.tasks.get(taskId);
  if (!t || t.status === status) return;
  // Tekrarlayan görevde maddelere dokunma: sunucu tamamlanan tekrarı kaydeder, tarihi ilerletir, maddeleri sıfırlar
  if (status === 'done' && t.recurrence !== 'once') {
    updateTask(taskId, { status });
    await flushTask(taskId);
    return 'recurring';
  }
  if (status === 'done') {
    const open = itemsOf(taskId).filter((x) => !x.done);
    for (const it of open) { it.done = true; }
    if (open.length) {
      emit('checklist', taskId);
      for (const it of open) await send({ kind: 'item', action: 'update', id: it.id, taskId, values: { done: true } });
    }
  }
  updateTask(taskId, { status });
}

export function checklistCounts(taskId) {
  const list = store.checklist.get(taskId) || [];
  return { total: list.length, done: list.filter((x) => x.done).length };
}

// ---------------------------------------------------------------- erteleme
export async function snooze(taskId, minutes = 10) {
  return snoozeUntil(taskId, new Date(Date.now() + minutes * 60000));
}

// Hatırlatmayı belirli bir zamana ertele (o zaman yeniden bildirim gelir)
export async function snoozeUntil(taskId, date) {
  const { error } = await supabase.from('notification_snoozes').insert({
    task_id: taskId, profile_id: profileId, until: date.toISOString(),
  });
  if (error) throw error;
}

// ---------------------------------------------------------------- gönderim, kuyruk
function applyOpLocally(op) {
  if (op.kind === 'task') {
    const t = store.tasks.get(op.id);
    if (t) { if (op.patch.deleted_at) store.tasks.delete(op.id); else Object.assign(t, op.patch); }
  } else if (op.kind === 'insert-task') {
    if (!store.tasks.has(op.id)) store.tasks.set(op.id, { progress: 0, version: 1, ...op.values });
  } else if (op.kind === 'item') {
    const list = itemsOf(op.taskId);
    const i = list.findIndex((x) => x.id === op.id);
    if (op.action === 'insert' && i < 0) list.push({ done: false, ...op.values });
    if (op.action === 'update' && i >= 0) Object.assign(list[i], op.values);
    if (op.action === 'delete' && i >= 0) list.splice(i, 1);
  }
}

async function send(op) {
  if (!navigator.onLine) { await enqueue(op); return; }
  inflight++; updateStatus();
  try {
    await runOp(op);
    lastError = null;
  } catch (err) {
    if (isNetErr(err)) await enqueue(op);
    else { lastError = err; emit('error', err); console.error(err); if (op.id && op.kind !== 'item') refreshTask(op.id); }
  } finally {
    inflight--; updateStatus();
  }
}

async function enqueue(op) {
  await queue.add({ ...op, queuedAt: Date.now() });
  store.queued = (await queue.all()).length;
  updateStatus();
  scheduleSnapshot();
}

export async function flushQueue() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const items = await queue.all();
    for (const op of items) {
      try {
        await runOp(op);
        await queue.remove(op.seq);
      } catch (err) {
        if (isNetErr(err)) break;
        console.error('Kuyruktaki değişiklik gönderilemedi', err);
        lastError = err; emit('error', err);
        await queue.remove(op.seq);
      }
    }
    store.queued = (await queue.all()).length;
  } finally {
    flushing = false;
    updateStatus();
  }
}

async function runOp(op) {
  if (op.kind === 'task') return runTaskUpdate(op);
  if (op.kind === 'insert-task') {
    const { data, error } = await supabase.from('tasks').insert(op.values).select(TASK_COLS).single();
    if (error) {
      if (error.code === '23505' && /no/.test(error.message || '')) {
        // NO çakıştı: bir sonrakini dene
        const maxNo = Math.max(0, ...[...store.tasks.values()].map((t) => t.no || 0));
        op.values.no = maxNo + 1;
        return runOp(op);
      }
      throw error;
    }
    applyServerTask(data);
    return null;
  }
  if (op.kind === 'restore') {
    const { data, error } = await supabase.from('tasks').update({ deleted_at: null }).eq('id', op.id).select(TASK_COLS).single();
    if (error) throw error;
    applyServerTask(data);
    return null;
  }
  if (op.kind === 'item') {
    let res;
    if (op.action === 'insert') res = await supabase.from('checklist_items').insert(op.values);
    else if (op.action === 'update') res = await supabase.from('checklist_items').update(op.values).eq('id', op.id);
    else res = await supabase.from('checklist_items').delete().eq('id', op.id);
    if (res.error) throw res.error;
    await refreshTask(op.taskId); // oran, durum ve sürüm sunucuda hesaplandı
    const tk = store.tasks.get(op.taskId);
    if (tk && tk.recurrence !== 'once') await refreshItems(op.taskId); // tekrar döngüsü maddeleri sıfırlamış olabilir
    return null;
  }
  return null;
}

async function runTaskUpdate(op, attempt = 0) {
  let q = supabase.from('tasks').update(op.patch).eq('id', op.id);
  if (op.version != null && !op.force) q = q.eq('version', op.version);
  const { data, error } = await q.select(TASK_COLS);
  if (error) throw error;
  if (data && data.length) {
    const before = store.tasks.get(op.id)?.due_date;
    applyServerTask(data[0]);
    if (op.patch.status === 'done' && data[0].status !== 'done' && data[0].recurrence !== 'once') {
      await refreshItems(op.id);
      emit('rollover', { id: op.id, from: before, next: data[0].due_date });
    }
    return null;
  }

  // Satır güncellenmedi: sürüm değişmiş (başkası kaydetmiş) veya görev yok/yetki yok
  const { data: server, error: e2 } = await supabase.from('tasks').select(TASK_COLS).eq('id', op.id).maybeSingle();
  if (e2) throw e2;
  if (!server) { store.tasks.delete(op.id); emitData(); emit('error', new Error('not_found')); return null; }
  const conflicts = Object.keys(op.patch).filter((k) => !same(server[k], op.base?.[k]) && !same(server[k], op.patch[k]));
  if (!conflicts.length && attempt < 3) {
    // Başkası başka alanları değiştirmiş: birleştir ve yeniden dene
    return runTaskUpdate({ ...op, version: server.version }, attempt + 1);
  }
  // Aynı alanı başkası da değiştirmiş: kullanıcıya sor
  const who = store.profiles.find((p) => p.id === server.updated_by)?.full_name || '';
  emit('conflict', { id: op.id, fields: conflicts, server, mine: op.patch, who });
  return null;
}

// Çakışma kararı: 'mine' -> benim değerlerim yazılsın, 'theirs' -> sunucudakiler kalsın
export async function resolveConflict(c, choice) {
  if (choice === 'mine') {
    await send({ kind: 'task', id: c.id, patch: c.mine, base: c.server, version: c.server.version });
  } else {
    pending.delete(c.id);
    applyServerTask(c.server);
  }
}

// ---------------------------------------------------------------- bağlantı izleme
window.addEventListener('online', () => { updateStatus(); flushQueue(); if (store.offlineData) reloadAll(); });
window.addEventListener('offline', updateStatus);
window.addEventListener('beforeunload', (e) => {
  if (pending.size || pendingItems.size) { flushAll(); e.preventDefault(); e.returnValue = ''; }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
