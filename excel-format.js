// Excel (18 sütun) <-> panel verisi dönüşümleri.
// Tarayıcıya bağımlı değildir; içe ve dışa aktarma bu dosyayı ortak kullanır.

export const SHEETS = { tasks: 'Görevler', people: 'Kişiler', lists: 'Listeler' };

export const TASK_COLUMNS = [
  'NO', 'PROJE', 'BÖLÜM', 'KATEGORİ', 'YAPILMASI GEREKEN', 'AÇIKLAMA', 'ETİKETLER', 'DURUM', 'ÖNCELİK',
  'BİTİRME ORANI', 'SORUMLU KİŞİ', 'BAŞLANGIÇ TARİHİ', 'BİTİRME TARİHİ', 'TAHMİNİ SÜRE (dk)', 'TEKRAR',
  'TEKRAR GÜNÜ', 'HATIRLATMA', 'REFERANS',
];

// Kod -> [Türkçe, İngilizce]
export const VALUE_LABELS = {
  status: {
    todo: ['Yapılacak', 'To do'], in_progress: ['Devam ediyor', 'In progress'], waiting: ['Bekliyor', 'Waiting'],
    blocked: ['Engellendi', 'Blocked'], done: ['Tamamlandı', 'Done'], cancelled: ['İptal edildi', 'Cancelled'],
  },
  priority: { urgent: ['Acil', 'Urgent'], high: ['Yüksek', 'High'], medium: ['Orta', 'Medium'], low: ['Düşük', 'Low'] },
  recurrence: {
    once: ['Tek sefer', 'Once'], daily: ['Her gün', 'Daily'], weekdays: ['Hafta içi her gün', 'Every weekday'],
    weekly: ['Her hafta', 'Weekly'], monthly: ['Her ay', 'Monthly'], yearly: ['Her yıl', 'Yearly'],
  },
  reminder: {
    none: ['Yok', 'None'], at_time: ['Tam zamanında', 'At due time'], '15m': ['15 dk önce', '15 min before'],
    '1h': ['1 saat önce', '1 hour before'], '1d': ['1 gün önce', '1 day before'], '1w': ['1 hafta önce', '1 week before'],
  },
  weekday: {
    mon: ['Pazartesi', 'Monday'], tue: ['Salı', 'Tuesday'], wed: ['Çarşamba', 'Wednesday'], thu: ['Perşembe', 'Thursday'],
    fri: ['Cuma', 'Friday'], sat: ['Cumartesi', 'Saturday'], sun: ['Pazar', 'Sunday'],
  },
  role: {
    owner: ['Yönetici (owner)', 'Owner'], admin: ['Yetkili (admin)', 'Admin'],
    member: ['Üye (member)', 'Member'], viewer: ['İzleyici (viewer)', 'Viewer'],
  },
  language: { tr: ['Türkçe', 'Turkish'], en: ['English', 'English'] },
  project_type: { web: ['Web', 'Web'], panel: ['Panel', 'Panel'], is_plani: ['İş Planı', 'Business plan'] },
};

const DEFAULTS = { status: 'todo', priority: 'medium', recurrence: 'once', reminder: 'none' };

export function norm(v) {
  return String(v ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr');
}

// Arama için: Türkçe harf farklarını yok sayar (I/İ/ı/i, ş/s, ğ/g, ü/u, ö/o, ç/c)
const FOLD = { 'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u' };
export function searchFold(v) {
  return norm(v).replace(/i̇/g, 'i').replace(/[ışğüöçâîû]/g, (c) => FOLD[c]);
}

function str(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/ /g, ' ').trim();
}

// Türkçe/İngilizce etiket, kod veya "Yönetici (owner)" gibi değerleri koda çevirir
export function toCode(kind, value) {
  const n = norm(value);
  if (!n) return null;
  const table = VALUE_LABELS[kind];
  for (const [code, labels] of Object.entries(table)) {
    if (n === norm(code) || labels.some((l) => norm(l) === n)) return code;
  }
  if (kind === 'role') {
    const m = n.match(/\((owner|admin|member|viewer)\)/);
    if (m) return m[1];
    const tr = { 'yönetici': 'owner', 'yetkili': 'admin', 'üye': 'member', 'izleyici': 'viewer' };
    if (tr[n]) return tr[n];
  }
  if (kind === 'language' && (n.startsWith('tür') || n === 'turkish')) return 'tr';
  if (kind === 'language' && (n.startsWith('eng') || n === 'ingilizce')) return 'en';
  return undefined; // tanınmayan değer
}

export function label(kind, code, lang = 'tr') {
  const l = VALUE_LABELS[kind]?.[code];
  return l ? l[lang === 'en' ? 1 : 0] : (code ?? '');
}

export function projectTypeFromName(name) {
  const n = norm(name);
  if (n.includes('web')) return 'web';
  if (n.includes('panel')) return 'panel';
  return 'is_plani';
}

// ---------- Tarih / saat ----------
const pad = (n) => String(n).padStart(2, '0');

function excelSerialToParts(serial) {
  // Excel 1900 tarih sistemi (1900 artık yıl hatası dahil)
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

function validYmd(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Dönüş: { date: 'YYYY-MM-DD', time: 'HH:MM' | null } | null (boş) | undefined (geçersiz)
export function parseDateCell(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) {
    return { date: `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`,
      time: v.getHours() || v.getMinutes() ? `${pad(v.getHours())}:${pad(v.getMinutes())}` : null };
  }
  if (typeof v === 'number' && isFinite(v) && v > 0) {
    const p = excelSerialToParts(v);
    return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: p.hh || p.mm ? `${pad(p.hh)}:${pad(p.mm)}` : null };
  }
  const s = str(v);
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (m) {
    const [d, mo, y] = [+m[1], +m[2], +m[3]];
    if (!validYmd(y, mo, d)) return undefined;
    return { date: `${y}-${pad(mo)}-${pad(d)}`, time: m[4] ? `${pad(+m[4])}:${m[5]}` : null };
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/);
  if (m) {
    if (!validYmd(+m[1], +m[2], +m[3])) return undefined;
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] && (m[4] !== '00' || m[5] !== '00') ? `${m[4]}:${m[5]}` : null };
  }
  return undefined;
}

export function parseTimeCell(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return `${pad(v.getHours())}:${pad(v.getMinutes())}`;
  if (typeof v === 'number' && isFinite(v)) {
    const mins = Math.round((v % 1) * 1440);
    return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`;
  }
  const m = str(v).match(/^(\d{1,2})[:.](\d{2})$/);
  if (m && +m[1] < 24 && +m[2] < 60) return `${pad(+m[1])}:${m[2]}`;
  return undefined;
}

export function formatDateTR(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

// ---------- Açıklama <-> kontrol listesi ----------
const ITEM_RE = /^\s*([✓✔]\s*)?(\d+)\s*[.)]\s*([✓✔]\s*)?(.*)$/;
const NOTE_SEP = ' – ';

export function parseDescription(text) {
  const desc = [];
  const items = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const m = raw.match(ITEM_RE);
    if (m && m[4].trim()) {
      const body = m[4].trim();
      const at = body.indexOf(NOTE_SEP);
      items.push({
        text: at >= 0 ? body.slice(0, at).trim() : body,
        note: at >= 0 ? body.slice(at + NOTE_SEP.length).trim() : '',
        done: Boolean(m[1] || m[3]),
      });
    } else {
      desc.push(raw.trimEnd());
    }
  }
  while (desc.length && !desc[0].trim()) desc.shift();
  while (desc.length && !desc[desc.length - 1].trim()) desc.pop();
  return { description: desc.join('\n'), checklist: items };
}

export function buildDescription(description, checklist) {
  const lines = [];
  if (description) lines.push(description);
  (checklist || []).forEach((it, i) => {
    const body = it.note ? `${it.text}${NOTE_SEP}${it.note}` : it.text;
    lines.push(`${it.done ? '✓ ' : ''}${i + 1}. ${body}`);
  });
  return lines.join('\n');
}

function splitList(v) {
  return [...new Set(str(v).split(',').map((s) => s.trim()).filter(Boolean))];
}

function splitRefs(v) {
  return str(v).split(/\r?\n/).flatMap((line) => {
    const l = line.trim();
    if (!l) return [];
    // Satır yalnızca linklerden oluşuyorsa her linki ayrı kaydet; değilse satırı not olarak koru
    const tokens = l.split(/[\s,;]+/).filter(Boolean);
    if (tokens.every((x) => /^https?:\/\/\S+$/i.test(x))) return tokens;
    return [l];
  });
}

// ---------- Sayfa okuma ----------
function sheetRows(XLSX, wb, name) {
  const key = Object.keys(wb.Sheets).find((k) => norm(k) === norm(name));
  if (!key) return null;
  return XLSX.utils.sheet_to_json(wb.Sheets[key], { header: 1, raw: true, defval: null, blankrows: true });
}

function headerIndex(row) {
  const idx = {};
  (row || []).forEach((h, i) => { if (h !== null && h !== '') idx[norm(h)] = i; });
  return idx;
}

function isEmptyRow(row) {
  return !row || row.every((c) => c === null || c === undefined || str(c) === '');
}

// Listeler sayfası: her sütun bir liste
function parseLists(rows) {
  const out = { projects: [], sections: [], categories: [] };
  if (!rows || !rows.length) return out;
  const idx = headerIndex(rows[0]);
  const col = (h) => {
    const i = idx[norm(h)];
    if (i === undefined) return [];
    const vals = [];
    for (let r = 1; r < rows.length; r++) {
      const v = str(rows[r]?.[i]);
      if (v && !vals.some((x) => norm(x) === norm(v))) vals.push(v);
    }
    return vals;
  };
  out.projects = col('PROJE');
  out.sections = col('BÖLÜM');
  out.categories = col('KATEGORİ');
  return out;
}

function parsePeople(rows, errors) {
  const people = [];
  if (!rows || !rows.length) return people;
  const idx = headerIndex(rows[0]);
  const g = (row, h) => row[idx[norm(h)]];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (isEmptyRow(row)) continue;
    const excelRow = r + 1;
    const name = str(g(row, 'AD SOYAD'));
    if (!name) { errors.push({ sheet: SHEETS.people, row: excelRow, reason: 'err.person_name' }); continue; }
    const email = str(g(row, 'E-POSTA')).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ sheet: SHEETS.people, row: excelRow, reason: 'err.email', value: email }); continue;
    }
    const roleRaw = g(row, 'ROL');
    const role = roleRaw ? toCode('role', roleRaw) : 'member';
    if (role === undefined) { errors.push({ sheet: SHEETS.people, row: excelRow, reason: 'err.role', value: str(roleRaw) }); continue; }
    const langRaw = g(row, 'DİL');
    const language = langRaw ? toCode('language', langRaw) : 'tr';
    const summary = parseTimeCell(g(row, 'GÜNLÜK ÖZET SAATİ'));
    let qs = null; let qe = null;
    const quiet = str(g(row, 'SESSİZ SAATLER'));
    if (quiet) {
      const m = quiet.match(/^(\d{1,2}[:.]\d{2})\s*[-–]\s*(\d{1,2}[:.]\d{2})$/);
      qs = m ? parseTimeCell(m[1]) : undefined; qe = m ? parseTimeCell(m[2]) : undefined;
      if (!qs || !qe) { errors.push({ sheet: SHEETS.people, row: excelRow, reason: 'err.quiet', value: quiet }); continue; }
    }
    if (summary === undefined) {
      errors.push({ sheet: SHEETS.people, row: excelRow, reason: 'err.time', value: str(g(row, 'GÜNLÜK ÖZET SAATİ')) }); continue;
    }
    const own = norm(g(row, 'SADECE KENDİ GÖREVLERİ'));
    people.push({
      full_name: name, email, role, phone: str(g(row, 'TELEFON')), language: language || 'tr',
      daily_summary_time: summary, quiet_hours_start: qs, quiet_hours_end: qe,
      only_own_tasks: own ? ['evet', 'yes', 'true', '1'].includes(own) : null,
    });
  }
  return people;
}

/**
 * Çalışma kitabını okuyup doğrular.
 * existingPeople: veritabanındaki kişilerin adları (sorumlu eşlemesi için)
 */
export function parseWorkbook(XLSX, wb, { existingPeople = [], fileName = '' } = {}) {
  const errors = [];
  const warnings = [];

  const taskRows = sheetRows(XLSX, wb, SHEETS.tasks);
  if (!taskRows) return { fatal: 'err.no_tasks_sheet' };
  const idx = headerIndex(taskRows[0]);
  const missingCols = ['NO', 'BÖLÜM', 'YAPILMASI GEREKEN'].filter((c) => idx[norm(c)] === undefined);
  if (missingCols.length) return { fatal: 'err.missing_columns', fatalValue: missingCols.join(', ') };

  const lists = parseLists(sheetRows(XLSX, wb, SHEETS.lists));
  const people = parsePeople(sheetRows(XLSX, wb, SHEETS.people), errors);
  const personNames = new Set([...people.map((p) => norm(p.full_name)), ...existingPeople.map(norm)]);

  const g = (row, h) => { const i = idx[norm(h)]; return i === undefined ? null : row[i]; };
  const tasks = [];
  const seenNo = new Map();

  for (let r = 1; r < taskRows.length; r++) {
    const row = taskRows[r];
    if (isEmptyRow(row)) continue;
    const excelRow = r + 1;
    const fail = (reason, value) => errors.push({ sheet: SHEETS.tasks, row: excelRow, no: str(g(row, 'NO')), reason, value });

    const noRaw = g(row, 'NO');
    const no = typeof noRaw === 'number' ? noRaw : Number(str(noRaw));
    if (str(noRaw) === '') { fail('err.no_empty'); continue; }
    if (!Number.isInteger(no) || no <= 0) { fail('err.no_invalid', str(noRaw)); continue; }
    if (seenNo.has(no)) { fail('err.no_duplicate', seenNo.get(no)); continue; }

    const project = str(g(row, 'PROJE'));
    const section = str(g(row, 'BÖLÜM'));
    const title = str(g(row, 'YAPILMASI GEREKEN'));
    if (!project) { fail('err.project_empty'); continue; }
    if (!section) { fail('err.section_empty'); continue; }
    if (!title) { fail('err.title_empty'); continue; }

    const coded = {};
    let bad = false;
    for (const [field, col] of [['status', 'DURUM'], ['priority', 'ÖNCELİK'], ['recurrence', 'TEKRAR'], ['reminder', 'HATIRLATMA']]) {
      const raw = g(row, col);
      const c = str(raw) ? toCode(field, raw) : DEFAULTS[field];
      if (c === undefined || c === null) { fail(`err.${field}`, str(raw)); bad = true; break; }
      coded[field] = c;
    }
    if (bad) continue;

    let recurrence_day = null;
    const rdRaw = str(g(row, 'TEKRAR GÜNÜ'));
    if (rdRaw && coded.recurrence === 'weekly') {
      recurrence_day = toCode('weekday', rdRaw);
      if (!recurrence_day) { fail('err.weekday', rdRaw); continue; }
    } else if (rdRaw && coded.recurrence === 'monthly') {
      const dnum = Number(rdRaw);
      if (!Number.isInteger(dnum) || dnum < 1 || dnum > 31) { fail('err.monthday', rdRaw); continue; }
      recurrence_day = String(dnum);
    }

    const start = parseDateCell(g(row, 'BAŞLANGIÇ TARİHİ'));
    if (start === undefined) { fail('err.start_date', str(g(row, 'BAŞLANGIÇ TARİHİ'))); continue; }
    const due = parseDateCell(g(row, 'BİTİRME TARİHİ'));
    if (due === undefined) { fail('err.due_date', str(g(row, 'BİTİRME TARİHİ'))); continue; }
    if (start && due && due.date < start.date) { fail('err.due_before_start'); continue; }

    const estRaw = g(row, 'TAHMİNİ SÜRE (dk)');
    let estimate = null;
    if (str(estRaw) !== '') {
      estimate = Number(estRaw);
      if (!isFinite(estimate) || estimate < 0) { fail('err.estimate', str(estRaw)); continue; }
      estimate = Math.round(estimate);
    }

    const assignee = str(g(row, 'SORUMLU KİŞİ'));
    if (assignee && !personNames.has(norm(assignee))) { fail('err.assignee', assignee); continue; }

    const parsed = parseDescription(g(row, 'AÇIKLAMA'));
    // Tamamlanmış görevin maddeleri tikli sayılır
    if (coded.status === 'done') parsed.checklist.forEach((it) => { it.done = true; });

    if (coded.recurrence === 'once' && coded.reminder !== 'none' && !due && coded.status !== 'done' && coded.status !== 'cancelled') {
      warnings.push({ row: excelRow, no, reason: 'warn.reminder_no_due' });
    }
    if (coded.recurrence !== 'once' && !start && !due) {
      warnings.push({ row: excelRow, no, reason: 'warn.recurring_no_start' });
    }

    seenNo.set(no, excelRow);
    tasks.push({
      _row: excelRow,
      no, project, project_type: projectTypeFromName(project), section,
      category: str(g(row, 'KATEGORİ')),
      title,
      description: parsed.description,
      checklist: parsed.checklist,
      tags: splitList(g(row, 'ETİKETLER')),
      status: coded.status, priority: coded.priority,
      assignee,
      start_date: start ? start.date : null,
      due_date: due ? due.date : null,
      due_time: due && due.time ? due.time : null,
      estimate_minutes: estimate,
      recurrence: coded.recurrence, recurrence_day,
      reminder: coded.reminder,
      reference_links: splitRefs(g(row, 'REFERANS')),
    });
  }

  // Projeler: Listeler sırası, sonra görevlerde geçen diğerleri
  const projectNames = [...lists.projects];
  for (const t of tasks) if (!projectNames.some((p) => norm(p) === norm(t.project))) {
    projectNames.push(t.project);
    if (lists.projects.length) warnings.push({ row: t._row, no: t.no, reason: 'warn.project_not_in_lists', value: t.project });
  }
  // Görevdeki proje yazımını listedeki yazımla birleştir
  for (const t of tasks) t.project = projectNames.find((p) => norm(p) === norm(t.project));
  const projects = projectNames.map((name, i) => ({ name, type: projectTypeFromName(name), sort_order: i + 1 }));

  const lookups = [];
  const addLookups = (kind, values) => {
    const seen = new Set();
    values.forEach((v) => { if (v && !seen.has(norm(v))) { seen.add(norm(v)); lookups.push({ kind, value: v, sort_order: seen.size }); } });
  };
  addLookups('section', [...lists.sections, ...tasks.map((t) => t.section)]);
  addLookups('category', [...lists.categories, ...tasks.map((t) => t.category)]);
  addLookups('tag', tasks.flatMap((t) => t.tags));

  return {
    fileName, tasks, people, projects, lookups,
    templates: buildTemplates(tasks, projects),
    errors, warnings,
  };
}

/**
 * Şablon: aynı türdeki TÜM projelerde bulunan adımlar.
 * Açıklamadan yalnızca tüm projelerde ortak olan maddeler alınır.
 * Kategorisi "Özel" içeren adımlar hiçbir zaman şablona girmez.
 */
export function buildTemplates(tasks, projects) {
  const out = [];
  for (const type of ['web', 'panel', 'is_plani']) {
    const typeProjects = projects.filter((p) => p.type === type && tasks.some((t) => t.project === p.name));
    if (typeProjects.length < 2) continue;
    const byProject = typeProjects.map((p) => tasks.filter((t) => t.project === p.name).sort((a, b) => a.no - b.no));
    const key = (t) => norm(t.title);
    const counts = new Map();
    byProject.forEach((list) => new Set(list.map(key)).forEach((k) => counts.set(k, (counts.get(k) || 0) + 1)));

    let order = 0;
    for (const t of byProject[0]) {
      const k = key(t);
      if (counts.get(k) !== typeProjects.length) continue;
      if (norm(t.category).includes('özel')) continue;
      if (out.some((o) => o.project_type === type && norm(o.title) === k)) continue;
      const instances = byProject.map((list) => list.find((x) => key(x) === k));
      const itemKey = (it) => norm(it.note ? `${it.text} – ${it.note}` : it.text);
      const common = t.checklist.filter((it) => instances.every((inst) => inst.checklist.some((x) => itemKey(x) === itemKey(it))));
      const sameDesc = instances.every((inst) => norm(inst.description) === norm(t.description));
      out.push({
        project_type: type, sort_order: ++order,
        section: t.section, category: t.category, title: t.title,
        description: buildDescription(sameDesc ? t.description : '', common.map((it) => ({ ...it, done: false }))),
        estimate_minutes: t.estimate_minutes, recurrence: t.recurrence, recurrence_day: t.recurrence_day,
        reminder: t.reminder, priority: t.priority, tags: t.tags,
      });
    }
  }
  return out;
}

// ---------- Önizleme: veritabanındaki görevlerle karşılaştırma ----------
const COMPARE_FIELDS = ['project', 'section', 'category', 'title', 'description', 'tags', 'status', 'priority',
  'assignee', 'start_date', 'due_date', 'estimate_minutes', 'recurrence', 'recurrence_day', 'reminder',
  'reference_links', 'checklist'];

function comparable(t, field) {
  const v = t[field];
  if (field === 'checklist') return JSON.stringify((v || []).map((i) => [norm(i.text), norm(i.note), !!i.done]));
  if (Array.isArray(v)) return JSON.stringify(v.map(norm));
  return norm(v ?? '');
}

/**
 * existing: [{ no, project, section, ..., assignee (ad), checklist:[{text,note,done}], deleted }]
 */
export function diffWithExisting(parsed, existing) {
  const byNo = new Map(existing.map((e) => [e.no, e]));
  const toInsert = []; const toUpdate = []; const unchanged = [];
  for (const t of parsed.tasks) {
    const e = byNo.get(t.no);
    if (!e) { toInsert.push(t); continue; }
    const changed = COMPARE_FIELDS.filter((f) => {
      // Excel'de tarihi olmayan tekrarlayan görevde paneldeki ilerlemiş tarih korunur
      if (f === 'due_date' && !t.due_date && t.recurrence !== 'once') return false;
      return comparable(t, f) !== comparable(e, f);
    });
    if (e.deleted) changed.push('restore');
    if (changed.length) toUpdate.push({ task: t, changed }); else unchanged.push(t);
  }
  const notInFile = existing.filter((e) => !e.deleted && !parsed.tasks.some((t) => t.no === e.no)).length;
  return { toInsert, toUpdate, unchanged, notInFile };
}

// RPC'ye gidecek veri (yalnızca eklenecek/güncellenecek görevler)
export function buildPayload(parsed, diff) {
  const strip = ({ _row, ...rest }) => rest;
  return {
    file_name: parsed.fileName,
    projects: parsed.projects,
    lookups: parsed.lookups,
    people: parsed.people,
    tasks: [...diff.toInsert, ...diff.toUpdate.map((u) => u.task)].map(strip),
    templates: parsed.templates,
  };
}
