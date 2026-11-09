// Zaman bloklama ("Plan"): görevleri günün saatlerine yerleştirme.
// Soldaki listeden bir görevi gün/saat sütununa sürükleyin (telefonda görevin yanındaki + düğmesi).
// Blok süresi görevin tahmini süresidir (yoksa 1 saat); bloğa tıklayınca saat/süre değişir veya silinir.
import { h, clear, icon, toast, confirmDialog } from './ui.js';
import { t, getLang } from './i18n.js';
import { supabase, friendlyError } from './supabase.js';
import { store, on } from './store.js';
import { todayIso, addDays, startOfWeek, fmtLong, fmtDate, istanbulToDate, dueInfo } from './dates.js';
import { priorityBadge } from './tasks.js';

const H_START = 7; const H_END = 21;   // 07:00–21:00
const PX_H = 48;                        // bir saatin yüksekliği
const SNAP = 15;                        // dakika
const pad = (n) => String(n).padStart(2, '0');
// Türkiye saati sabit UTC+3
const istParts = (ts) => { const d = new Date(new Date(ts).getTime() + 3 * 3600000); return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; };
const toTs = (dateIso, min) => istanbulToDate(dateIso, `${pad(Math.floor(min / 60))}:${pad(min % 60)}`);
const hm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

export function planRange(state, mobile) {
  if (mobile) return { days: [state.anchor], step: 1 };
  const s = startOfWeek(state.anchor);
  return { days: [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(s, i)), step: 7 };
}

export function planView(state, ctx, { save, draw, mobile }) {
  const lang = getLang();
  const R = planRange(state, mobile);
  const person = (ctx.isAdmin && state.pperson) || ctx.profile.id;
  const canWrite = ['owner', 'admin', 'member'].includes(ctx.profile.role) && (person === ctx.profile.id || ctx.isAdmin);
  const wrap = h('div', { class: 'tb-wrap' });
  let blocks = [];

  // Planlanacak işler: kişinin açık görevleri (gecikenler, yakın tarihliler, öncelikliler önce)
  const rank = { urgent: 0, high: 1, medium: 2, low: 3 };
  const pool = [...store.tasks.values()]
    .filter((x) => x.assignee_id === person && !['done', 'cancelled'].includes(x.status))
    .sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) || rank[a.priority] - rank[b.priority]);
  const est = (x) => Math.min(240, Math.max(SNAP, Number(x.estimate_minutes) || 60));

  async function createBlock(taskId, dateIso, startMin, minutes) {
    const s = Math.max(H_START * 60, Math.min(H_END * 60 - SNAP, startMin));
    const e = Math.min(H_END * 60, s + minutes);
    const { error } = await supabase.from('task_time_blocks').insert({ task_id: taskId, profile_id: person, start_at: toTs(dateIso, s).toISOString(), end_at: toTs(dateIso, e).toISOString() });
    if (error) { toast(friendlyError(error), { type: 'error' }); return; }
    toast(t('tb.added', { when: `${fmtDate(dateIso)} ${hm(s)}–${hm(e)}` }), { type: 'ok' });
    load();
  }
  async function moveBlock(b, dateIso, startMin) {
    const len = (new Date(b.end_at) - new Date(b.start_at)) / 60000;
    const s = Math.max(H_START * 60, Math.min(H_END * 60 - len, startMin));
    const { error } = await supabase.from('task_time_blocks').update({ start_at: toTs(dateIso, s).toISOString(), end_at: toTs(dateIso, s + len).toISOString(), updated_at: new Date().toISOString() }).eq('id', b.id);
    if (error) toast(friendlyError(error), { type: 'error' }); else load();
  }

  function editDialog(b) {
    const tk = store.tasks.get(b.task_id);
    const p = istParts(b.start_at); const len = Math.round((new Date(b.end_at) - new Date(b.start_at)) / 60000);
    const date = h('input', { class: 'input', type: 'date', id: 'tb-date', value: p.date });
    const time = h('input', { class: 'input', type: 'time', id: 'tb-time', step: 900, value: hm(p.min) });
    const dur = h('select', { class: 'input', id: 'tb-dur' }, [15, 30, 45, 60, 90, 120, 180, 240].map((m) => h('option', { value: m, selected: m === len }, t('tb.minutes', { n: m }))));
    if (![15, 30, 45, 60, 90, 120, 180, 240].includes(len)) dur.prepend(h('option', { value: len, selected: true }, t('tb.minutes', { n: len })));
    const form = h('form', { class: 'form', novalidate: true },
      h('h2', { class: 'h2' }, tk?.title || t('tb.block')),
      h('div', { class: 'grid-3' },
        h('div', { class: 'field' }, h('label', { for: 'tb-date' }, t('tb.date')), date),
        h('div', { class: 'field' }, h('label', { for: 'tb-time' }, t('tb.start')), time),
        h('div', { class: 'field' }, h('label', { for: 'tb-dur' }, t('tb.duration')), dur)),
      h('div', { class: 'dialog-actions' },
        canWrite ? h('button', { class: 'btn btn-danger-outline', type: 'button', onclick: async () => {
          if (!(await confirmDialog(t('tb.delete_confirm'), { confirmLabel: t('common.delete'), danger: true }))) return;
          const { error } = await supabase.from('task_time_blocks').delete().eq('id', b.id);
          if (error) toast(friendlyError(error), { type: 'error' });
          dlg.close(); load();
        } }, icon('trash'), t('common.delete')) : null,
        h('a', { class: 'btn', href: `#/gorev/${b.task_id}`, onclick: () => dlg.close() }, t('tb.open_task')),
        canWrite ? h('button', { class: 'btn btn-primary', type: 'submit' }, t('common.save')) : null));
    const dlg = h('dialog', { class: 'dialog dialog-wide' }, form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const [hh, mm] = (time.value || '09:00').split(':').map(Number);
      const s = hh * 60 + mm; const m = Number(dur.value);
      const { error } = await supabase.from('task_time_blocks').update({ start_at: toTs(date.value, s).toISOString(), end_at: toTs(date.value, s + m).toISOString(), updated_at: new Date().toISOString() }).eq('id', b.id);
      if (error) { toast(friendlyError(error), { type: 'error' }); return; }
      dlg.close(); load();
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  function quickAddDialog(tk) {
    const date = h('input', { class: 'input', type: 'date', id: 'tq-date', value: R.days.includes(todayIso()) ? todayIso() : R.days[0] });
    const time = h('input', { class: 'input', type: 'time', id: 'tq-time', step: 900, value: '09:00' });
    const dur = h('select', { class: 'input', id: 'tq-dur' }, [15, 30, 45, 60, 90, 120, 180, 240].map((m) => h('option', { value: m, selected: m === est(tk) }, t('tb.minutes', { n: m }))));
    const form = h('form', { class: 'form', novalidate: true },
      h('h2', { class: 'h2' }, t('tb.plan_task')), h('p', { class: 'muted' }, tk.title),
      h('div', { class: 'grid-3' },
        h('div', { class: 'field' }, h('label', { for: 'tq-date' }, t('tb.date')), date),
        h('div', { class: 'field' }, h('label', { for: 'tq-time' }, t('tb.start')), time),
        h('div', { class: 'field' }, h('label', { for: 'tq-dur' }, t('tb.duration')), dur)),
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('common.cancel')),
        h('button', { class: 'btn btn-primary', type: 'submit' }, t('tb.add'))));
    const dlg = h('dialog', { class: 'dialog dialog-wide' }, form);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const [hh, mm] = (time.value || '09:00').split(':').map(Number);
      dlg.close();
      createBlock(tk.id, date.value, hh * 60 + mm, Number(dur.value));
    });
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  function minuteFromEvent(col, e) {
    const y = e.clientY - col.getBoundingClientRect().top;
    return H_START * 60 + Math.round((y / PX_H) * 60 / SNAP) * SNAP;
  }

  // Çakışan blokları yan yana sığdır
  function layout(list) {
    const items = list.map((b) => ({ b, s: istParts(b.start_at).min, e: istParts(b.end_at).min || 24 * 60 })).sort((a, b) => a.s - b.s || b.e - a.e);
    const cols = [];
    for (const it of items) {
      let c = cols.findIndex((end) => end <= it.s);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = it.e; it.col = c;
    }
    items.forEach((it) => { it.n = Math.max(1, items.filter((o) => o.s < it.e && o.e > it.s).reduce((m, o) => Math.max(m, o.col + 1), 0)); });
    return items;
  }

  function draw2() {
    const today = todayIso();
    const nowP = istParts(Date.now());
    const hours = [];
    for (let hr = H_START; hr <= H_END; hr++) hours.push(h('div', { class: 'tb-hour', style: `top:${(hr - H_START) * PX_H}px` }, `${pad(hr)}:00`));
    const gridH = (H_END - H_START) * PX_H;
    const planned = new Map();
    blocks.forEach((b) => planned.set(b.task_id, (planned.get(b.task_id) || 0) + 1));

    const cols = R.days.map((iso) => {
      const dayBlocks = blocks.filter((b) => istParts(b.start_at).date === iso);
      const total = dayBlocks.reduce((s, b) => s + (new Date(b.end_at) - new Date(b.start_at)) / 60000, 0);
      const col = h('div', { class: `tb-col ${iso === today ? 'today' : ''}`, style: `height:${gridH}px`, 'data-date': iso },
        ...layout(dayBlocks).map(({ b, s, e, col: c, n }) => {
          const tk = store.tasks.get(b.task_id);
          const el = h('button', {
            type: 'button', class: `tb-block prio-bg-${tk?.priority || 'medium'} ${tk?.status === 'done' ? 'is-done' : ''}`, draggable: canWrite ? 'true' : 'false',
            style: `top:${(s - H_START * 60) / 60 * PX_H}px;height:${Math.max(18, (e - s) / 60 * PX_H - 2)}px;left:calc(${(c / n) * 100}% + 2px);width:calc(${100 / n}% - 4px)`,
            title: `${tk?.title || ''} · ${hm(s)}–${hm(e)}`, onclick: () => editDialog(b),
          }, h('span', { class: 'tb-time' }, `${hm(s)}–${hm(e)}`), h('span', { class: 'tb-title' }, tk?.title || '…'));
          el.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', `block:${b.id}`); ev.dataTransfer.effectAllowed = 'move'; });
          return el;
        }),
        iso === today && nowP.min >= H_START * 60 && nowP.min <= H_END * 60 ? h('div', { class: 'tb-now', style: `top:${(nowP.min - H_START * 60) / 60 * PX_H}px` }) : null);
      if (canWrite) {
        col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
        col.addEventListener('dragleave', () => col.classList.remove('drop'));
        col.addEventListener('drop', (e) => {
          e.preventDefault(); col.classList.remove('drop');
          const data = e.dataTransfer.getData('text/plain');
          const min = minuteFromEvent(col, e);
          if (data.startsWith('block:')) { const b = blocks.find((x) => x.id === data.slice(6)); if (b) moveBlock(b, iso, min); return; }
          if (data.startsWith('task:')) { const tk = store.tasks.get(data.slice(5)); if (tk) createBlock(tk.id, iso, min, est(tk)); }
        });
      }
      return h('div', { class: 'tb-day' },
        h('div', { class: 'tb-dhead' }, fmtLong(iso, lang, { weekday: 'short', day: 'numeric', month: 'short' }),
          total ? h('span', { class: 'quick-n' }, t('tb.hours', { n: Math.round(total / 6) / 10 })) : null),
        col);
    });

    const list = h('ul', { class: 'tb-pool-list' }, pool.slice(0, 60).map((tk) => {
      const info = dueInfo(tk);
      const li = h('li', { class: 'tb-pool-item', draggable: canWrite && !mobile ? 'true' : 'false' },
        h('div', { class: 'tb-pool-main' },
          h('a', { class: 'row-link', href: `#/gorev/${tk.id}` }, tk.title),
          h('div', { class: 'muted small' }, `${est(tk)} ${t('tasks.minutes')}`, planned.get(tk.id) ? ` · ${t('tb.planned_n', { n: planned.get(tk.id) })}` : '',
            info ? h('span', { class: `due-tag due-${info.tone}` }, ` ${info.text}`) : null)),
        h('div', { class: 'tb-pool-side' }, priorityBadge(tk.priority),
          canWrite ? h('button', { class: 'icon-btn icon-btn-sm', type: 'button', title: t('tb.plan_task'), 'aria-label': `${t('tb.plan_task')}: ${tk.title}`, onclick: () => quickAddDialog(tk) }, icon('plus')) : null));
      li.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', `task:${tk.id}`); e.dataTransfer.effectAllowed = 'copy'; });
      return li;
    }));

    const people = store.profiles.filter((p) => p.active !== false && p.role !== 'viewer');
    const who = ctx.isAdmin ? h('select', { class: 'input input-sm', 'aria-label': t('tb.person') },
      people.map((p) => h('option', { value: p.id, selected: p.id === person }, p.full_name))) : null;
    if (who) who.addEventListener('change', () => { state.pperson = who.value === ctx.profile.id ? '' : who.value; save(); draw(); });

    clear(wrap).append(
      h('div', { class: 'tb-layout' },
        h('aside', { class: 'tb-pool' },
          h('h2', { class: 'h3' }, t('tb.pool'), h('span', { class: 'quick-n' }, String(pool.length))),
          who,
          pool.length ? list : h('p', { class: 'muted small' }, t('tb.pool_empty')),
          pool.length > 60 ? h('p', { class: 'muted small' }, t('tb.pool_more', { n: pool.length - 60 })) : null),
        h('div', { class: 'tb-grid' },
          h('div', { class: 'tb-hours', style: `height:${gridH}px` }, hours),
          h('div', { class: 'tb-days', style: `grid-template-columns:repeat(${R.days.length}, minmax(${mobile ? 0 : 110}px, 1fr))` }, cols))),
      h('p', { class: 'muted small mt' }, mobile ? t('tb.hint_mobile') : t('tb.hint')));
    const grid = wrap.querySelector('.tb-grid');
    requestAnimationFrame(() => { if (grid) grid.scrollTop = Math.max(0, (Math.max(H_START, Math.min(nowP.min / 60, 12)) - H_START - 1) * PX_H); });
  }

  async function load() {
    const from = toTs(R.days[0], 0).toISOString();
    const to = toTs(addDays(R.days[R.days.length - 1], 1), 0).toISOString();
    const { data, error } = await supabase.from('task_time_blocks').select('id,task_id,profile_id,start_at,end_at')
      .eq('profile_id', person).gte('start_at', from).lt('start_at', to).order('start_at');
    if (error) { clear(wrap).append(h('p', { class: 'form-msg form-msg-error' }, friendlyError(error))); return; }
    blocks = data; draw2();
  }
  draw2();
  load();
  const off = on('blocks', () => { if (wrap.isConnected) load(); else off(); });
  return wrap;
}
