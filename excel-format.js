// Excel <-> panel verisi dönüşümleri.
// İki biçim okunur: ERA "Görev Takip" (25 sütun, Paket 9) ve eski 18 sütunlu "Görevler".
// Dışa aktarma her zaman ERA biçimindedir. Tarayıcıya bağımlı değildir.

export const SHEETS = { era: 'Görev Takip', tasks: 'Görevler', people: 'Kişiler', lists: 'Listeler', summary: 'Özet Panel' };
export const BIRIM_PROJECT = 'Evodak Birim İşleri';
export const BIRIM_PREFIX = 'BRM';

// ERA biçiminin 25 sütunu + panelin ek sütunları (isteğe bağlı)
export const ERA_COLUMNS = [
  'ID', 'Direktörlük / Birim', 'Alt Birim', 'Proje', 'Görev / Fonksiyon', 'Görev Detayı / Açıklama', 'Sorumlu',
  'Öncelik', 'Başlangıç', 'Termin', 'Bitiş (Gerçekleşen)', 'Durum', 'İlerleme %', 'Kalan Gün', 'Termin Durumu',
  'Tekrar Tipi', 'Süre (dk)', 'Adet', 'Günde', 'Haftada', 'Ayda', 'Yılda', 'Yıllık Tekrar', 'Toplam Saat (yıllık)', 'Notlar',
];
export const EXTRA_COLUMNS = ['Hatırlatma', 'Tekrar Günü', 'Etiketler', 'Referans', 'Kontrol Listesi'];

// Eski 18 sütun (yalnızca okuma)
export const LEGACY_COLUMNS = [
  'NO', 'PROJE', 'BÖLÜM', 'KATEGORİ', 'YAPILMASI GEREKEN', 'AÇIKLAMA', 'ETİKETLER', 'DURUM', 'ÖNCELİK',
  'BİTİRME ORANI', 'SORUMLU KİŞİ', 'BAŞLANGIÇ TARİHİ', 'BİTİRME TARİHİ', 'TAHMİNİ SÜRE (dk)', 'TEKRAR',
  'TEKRAR GÜNÜ', 'HATIRLATMA', 'REFERANS',
];

// Kod -> [Türkçe, İngilizce]
export const VALUE_LABELS = {
  status: {
    todo: ['Başlamadı', 'Not started'], in_progress: ['Devam Ediyor', 'In progress'], waiting: ['Beklemede', 'On hold'],
    done: ['Tamamlandı', 'Done'], cancelled: ['İptal', 'Cancelled'],
  },
  priority: { urgent: ['Kritik', 'Critical'], high: ['Yüksek', 'High'], medium: ['Orta', 'Medium'], low: ['Düşük', 'Low'] },
  recurrence: {
    once: ['Tek sefer', 'Once'], daily: ['Günlük', 'Daily'], weekdays: ['Hafta içi her gün', 'Every weekday'],
    weekly: ['Haftalık', 'Weekly'], monthly: ['Aylık', 'Monthly'], yearly: ['Yıllık', 'Yearly'],
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
  project_type: {
    web: ['Web', 'Web'], panel: ['Panel', 'Panel'], is_plani: ['İş Planı', 'Business plan'],
    program: ['Program', 'Programme'], birim: ['Birim İşleri', 'Unit tasks'],
  },
};

// Eski etiketler ve eş anlamlılar (içe aktarmada tanınır)
const ALIASES = {
  status: { todo: ['Yapılacak', 'To do'], waiting: ['Bekliyor', 'Waiting', 'Engellendi', 'Blocked'], cancelled: ['İptal edildi'] },
  priority: { urgent: ['Acil', 'Urgent'] },
  recurrence: { daily: ['Her gün'], weekly: ['Her hafta'], monthly: ['Her ay'], yearly: ['Her yıl'] },
  weekday: { mon: ['Pzt'], tue: ['Sal'], wed: ['Çar', 'Çrş'], thu: ['Per', 'Prş'], fri: ['Cum'], sat: ['Cmt'], sun: ['Paz'] },
};

const DEFAULTS = { status: 'todo', priority: 'medium', recurrence: 'once', reminder: 'none' };

export function norm(v) {
  return String(v ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr');
}

// Arama için: Türkçe harf farklarını yok sayar (I/İ/ı/i, ş/s, ğ/g, ü/u, ö/o, ç/c)
const FOLD = { 'ı': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u' };
export function searchFold(v) {
  return norm(v).replace(/i̇/g, 'i').replace(/[ışğüöçâîû]/g, (c) => FOLD[c]);
}

function str(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/ /g, ' ').trim();
}

// Türkçe/İngilizce etiket, kod, eski etiket veya "Yönetici (owner)" gibi değerleri koda çevirir
export function toCode(kind, value) {
  const n = norm(value);
  if (!n) return null;
  const table = VALUE_LABELS[kind];
  for (const [code, labels] of Object.entries(table)) {
    if (n === norm(code) || labels.some((l) => norm(l) === n)) return code;
  }
  for (const [code, labels] of Object.entries(ALIASES[kind] || {})) {
    if (labels.some((l) => norm(l) === n)) return code;
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
  if (n === norm(BIRIM_PROJECT) || n.includes('birim iş')) return 'birim';
  if (n.includes('program')) return 'program';
  if (n.includes('web')) return 'web';
  if (n.includes('panel')) return 'panel';
  return 'is_plani';
}

// Doğal sıralama: GTP-2 < GTP-10, PAZ-01.02 < PAZ-01.10
const collator = new Intl.Collator('tr', { numeric: true, sensitivity: 'base' });
export function compareCode(a, b) { return collator.compare(String(a ?? ''), String(b ?? '')); }

// ---------- Tarih / saat ----------
const pad = (n) => String(n).padStart(2, '0');

function excelSerialToParts(serial) {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
}

export function isoToSerial(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000 + 25569;
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
  if (s === '-' || s === '—') return null;
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

function todayIso() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Istanbul' }));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------- Hesaplanan alanlar (Excel formülleriyle aynı) ----------
// gün = 6/hafta, hafta = 4,2/ay, 12 ay
export function yearlyRepeat(tk) {
  const f = tk.freq_count ?? 1;
  switch (tk.recurrence) {
    case 'daily': return f * 6 * 4.2 * 12;
    case 'weekdays': return f * 5 * 4.2 * 12;
    case 'weekly': return f * 4.2 * 12;
    case 'monthly': return f * 12;
    case 'yearly': return f;
    default: return 1;
  }
}
export function totalHours(tk) {
  const v = ((tk.estimate_minutes || 0) * (tk.quantity || 1) * yearlyRepeat(tk)) / 60;
  return Math.round(v * 10) / 10;
}
export function daysLeft(tk, today = todayIso()) {
  if (!tk.due_date) return null;
  return Math.round((Date.parse(tk.due_date.slice(0, 10)) - Date.parse(today)) / 86400000);
}
// 'overdue' | 'soon' | 'scheduled' | null
// Excel'deki gibi yalnızca tek seferlik görevlerin termin durumu vardır; tekrarlayan rutin işler
// (Günlük/Haftalık/Aylık/Yıllık) gecikmiş sayılmaz, kaçırılan tekrar Bugün ekranında "tekrarlananlar"da görünür.
export function dueState(tk, today = todayIso()) {
  if (!tk.due_date || tk.status === 'done' || tk.status === 'cancelled' || (tk.recurrence && tk.recurrence !== 'once')) return null;
  const d = daysLeft(tk, today);
  if (d < 0) return 'overdue';
  if (d <= 7) return 'soon';
  return 'scheduled';
}
export const DUE_STATE_LABELS = {
  overdue: ['Gecikmiş', 'Overdue'], soon: ['Yaklaşıyor (≤7 gün)', 'Due soon (≤7 days)'], scheduled: ['Takvimde', 'Scheduled'],
};

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
    const tokens = l.split(/[\s,;]+/).filter(Boolean);
    if (tokens.every((x) => /^https?:\/\/\S+$/i.test(x))) return tokens;
    return [l];
  });
}

// ---------- Tekrar günü ----------
// Haftalık: "Pazartesi, Perşembe" -> "mon,thu" · Aylık: "1, 15" -> "1,15" · Yıllık: "01.03, 01.09" -> "03-01,09-01"
export function parseRecurrenceDay(recurrence, raw) {
  const s = str(raw);
  if (!s) return null;
  const parts = s.split(/[,;/]+|\s+ve\s+/).map((x) => x.trim()).filter(Boolean);
  if (recurrence === 'weekly') {
    const codes = parts.map((p) => toCode('weekday', p));
    if (codes.some((c) => !c)) return undefined;
    return [...new Set(codes)].join(',');
  }
  if (recurrence === 'monthly') {
    const nums = parts.map(Number);
    if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > 31)) return undefined;
    return [...new Set(nums)].sort((a, b) => a - b).join(',');
  }
  if (recurrence === 'yearly') {
    const out = [];
    for (const p of parts) {
      const m = p.match(/^(\d{1,2})[./-](\d{1,2})$/);
      if (!m || +m[1] < 1 || +m[1] > 31 || +m[2] < 1 || +m[2] > 12) return undefined;
      out.push(`${pad(+m[2])}-${pad(+m[1])}`);
    }
    return out.join(',');
  }
  return null;
}

export function formatRecurrenceDay(recurrence, day, lang = 'tr') {
  if (!day) return '';
  if (recurrence === 'weekly') return day.split(',').map((c) => label('weekday', c, lang)).join(', ');
  if (recurrence === 'monthly') return day.split(',').join(', ');
  if (recurrence === 'yearly') return day.split(',').map((x) => { const [m, d] = x.split('-'); return `${d}.${m}`; }).join(', ');
  return day;
}

// Gün verilmemiş çok sıklıklı tekrarlar için varsayılan günler (prompt 9. bölüm)
export function defaultRecurrenceDay(recurrence, freq, startIso) {
  const f = freq || 1;
  if (recurrence === 'weekly') return f >= 3 ? 'mon,wed,fri' : f === 2 ? 'mon,thu' : 'mon';
  if (recurrence === 'monthly') return f >= 2 ? '1,15' : '1';
  if (recurrence === 'yearly' && f >= 2 && startIso) {
    const base = startIso.slice(0, 10);
    const [, m0, d0] = base.split('-').map(Number);
    const step = Math.max(1, Math.round(12 / Math.min(f, 12)));
    const out = [];
    for (let i = 0; i < Math.min(f, 12); i++) out.push(`${pad(((m0 - 1 + i * step) % 12) + 1)}-${pad(Math.min(d0, 28))}`);
    return [...new Set(out)].sort().join(',');
  }
  return null;
}

// Notlar'daki "Tekrar: Her hafta (Pazartesi)" / "Tekrar: Her ay (15)" kalıbı
function dayFromNotes(recurrence, notes) {
  const n = str(notes);
  let m;
  if (recurrence === 'weekly' && (m = n.match(/Tekrar:\s*Her hafta\s*\(([^)]+)\)/i))) return parseRecurrenceDay('weekly', m[1]) || null;
  if (recurrence === 'monthly' && (m = n.match(/Tekrar:\s*Her ay\s*\(([^)]+)\)/i))) return parseRecurrenceDay('monthly', m[1]) || null;
  return null;
}

// ---------- Sayfa okuma ----------
function findSheet(wb, name) {
  return Object.keys(wb.Sheets).find((k) => norm(k) === norm(name));
}
function sheetRows(XLSX, wb, name) {
  const key = findSheet(wb, name);
  if (!key) return null;
  return XLSX.utils.sheet_to_json(wb.Sheets[key], { header: 1, raw: true, defval: null, blankrows: true });
}

function headerIndex(row) {
  const idx = {};
  (row || []).forEach((h, i) => { if (h !== null && h !== '' && idx[norm(h)] === undefined) idx[norm(h)] = i; });
  return idx;
}

function isEmptyRow(row) {
  return !row || row.every((c) => c === null || c === undefined || str(c) === '');
}

// Listeler sayfası: her sütun bir liste (sütun adları eşanlamlılarıyla)
function listColumn(rows, ...names) {
  if (!rows || !rows.length) return [];
  const idx = headerIndex(rows[0]);
  const i = names.map((n) => idx[norm(n)]).find((x) => x !== undefined);
  if (i === undefined) return [];
  const vals = [];
  for (let r = 1; r < rows.length; r++) {
    const v = str(rows[r]?.[i]);
    if (v && !vals.some((x) => norm(x) === norm(v))) vals.push(v);
  }
  return vals;
}

function parsePeople(rows, errors) {
  const people = [];
  if (!rows || !rows.length) return people;
  const idx = headerIndex(rows[0]);
  if (idx[norm('AD SOYAD')] === undefined) return people;
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

// Kişi adı eşlemesi: tam ad veya tek eşleşen ilk ad ("Hakan", "Gamze")
export function personMatcher(names) {
  const full = new Set(names.map(norm));
  const first = new Map();
  names.forEach((n) => { const f = norm(n).split(' ')[0]; first.set(f, (first.get(f) || 0) + 1); });
  return (name) => full.has(norm(name)) || first.get(norm(name)) === 1;
}

/**
 * Çalışma kitabını okuyup doğrular. Biçimi kendisi tanır.
 * existingPeople: veritabanındaki kişilerin adları (sorumlu eşlemesi için)
 */
export function parseWorkbook(XLSX, wb, opts = {}) {
  if (findSheet(wb, SHEETS.era)) return parseEra(XLSX, wb, opts);
  if (findSheet(wb, SHEETS.tasks)) return parseLegacy(XLSX, wb, opts);
  return { fatal: 'err.no_tasks_sheet' };
}

// ----- ERA biçimi -----
function parseEra(XLSX, wb, { existingPeople = [], fileName = '' } = {}) {
  const errors = [];
  const warnings = [];
  const rows = sheetRows(XLSX, wb, SHEETS.era);
  // Başlık satırı: "ID" hücresi olan ilk satır (ilk 15 satır içinde)
  const hr = rows.slice(0, 15).findIndex((row) => (row || []).some((c) => norm(c) === norm('ID')));
  if (hr < 0) return { fatal: 'err.missing_columns', fatalValue: 'ID' };
  const idx = headerIndex(rows[hr]);
  const missing = ['ID', 'Direktörlük / Birim', 'Alt Birim', 'Görev Detayı / Açıklama'].filter((c) => idx[norm(c)] === undefined);
  if (missing.length) return { fatal: 'err.missing_columns', fatalValue: missing.join(', ') };
  const has = (h) => idx[norm(h)] !== undefined;
  const g = (row, h) => { const i = idx[norm(h)]; return i === undefined ? null : row?.[i]; };

  const listRows = sheetRows(XLSX, wb, SHEETS.lists);
  const lists = {
    directorates: listColumn(listRows, 'Direktörlük / Birim', 'Direktörlük'),
    sections: listColumn(listRows, 'Alt Birim'),
    categories: listColumn(listRows, 'Görev / Fonksiyon'),
    projects: listColumn(listRows, 'Proje'),
    people: listColumn(listRows, 'Sorumlu Personel (doldurun)', 'Sorumlu Personel', 'Sorumlu'),
  };
  const knows = personMatcher(existingPeople);

  const tasks = [];
  const seen = new Map();
  const unknownPeople = new Set();
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r];
    const code = str(g(row, 'ID'));
    if (!code) continue;                         // formül satırları ve boş satırlar atlanır
    const excelRow = r + 1;
    const fail = (reason, value) => errors.push({ sheet: SHEETS.era, row: excelRow, no: code, reason, value });
    if (seen.has(norm(code))) { fail('err.no_duplicate', seen.get(norm(code))); continue; }

    const directorate = str(g(row, 'Direktörlük / Birim'));
    const section = str(g(row, 'Alt Birim'));
    const title = str(g(row, 'Görev Detayı / Açıklama'));
    if (!title) { fail('err.title_empty'); continue; }
    if (!directorate) { fail('err.directorate_empty'); continue; }
    if (!section) { fail('err.section_empty'); continue; }

    const status = str(g(row, 'Durum')) ? toCode('status', g(row, 'Durum')) : DEFAULTS.status;
    if (!status) { fail('err.status', str(g(row, 'Durum'))); continue; }
    const priority = str(g(row, 'Öncelik')) ? toCode('priority', g(row, 'Öncelik')) : DEFAULTS.priority;
    if (!priority) { fail('err.priority', str(g(row, 'Öncelik'))); continue; }
    const recurrence = str(g(row, 'Tekrar Tipi')) ? toCode('recurrence', g(row, 'Tekrar Tipi')) : DEFAULTS.recurrence;
    if (!recurrence) { fail('err.recurrence', str(g(row, 'Tekrar Tipi'))); continue; }

    const start = parseDateCell(g(row, 'Başlangıç'));
    if (start === undefined) { fail('err.start_date', str(g(row, 'Başlangıç'))); continue; }
    const due = parseDateCell(g(row, 'Termin'));
    if (due === undefined) { fail('err.due_date', str(g(row, 'Termin'))); continue; }
    if (start && due && due.date < start.date) { fail('err.due_before_start'); continue; }
    const doneAt = parseDateCell(g(row, 'Bitiş (Gerçekleşen)'));
    if (doneAt === undefined) { fail('err.done_date', str(g(row, 'Bitiş (Gerçekleşen)'))); continue; }

    const num = (h, { min = 0, int = true } = {}) => {
      const raw = g(row, h);
      if (str(raw) === '') return null;
      const n = Number(raw);
      if (!isFinite(n) || n < min) return undefined;
      return int ? Math.round(n) : n;
    };
    const estimate = num('Süre (dk)');
    if (estimate === undefined) { fail('err.estimate', str(g(row, 'Süre (dk)'))); continue; }
    const quantity = num('Adet', { min: 1 });
    if (quantity === undefined) { fail('err.quantity', str(g(row, 'Adet'))); continue; }
    const freqCol = { daily: 'Günde', weekdays: 'Günde', weekly: 'Haftada', monthly: 'Ayda', yearly: 'Yılda' }[recurrence];
    let freq = freqCol ? num(freqCol) : null;
    if (freq === undefined) { fail('err.freq', str(g(row, freqCol))); continue; }
    if (freqCol && freq === null && has(freqCol)) freq = 0;   // Excel boş sıklığı 0 sayar (Yıllık Tekrar = 0)

    let progress = num('İlerleme %', { int: false });
    if (progress === undefined) { fail('err.progress', str(g(row, 'İlerleme %'))); continue; }
    if (progress !== null) progress = Math.round(progress <= 1 ? progress * 100 : progress);
    progress = Math.max(0, Math.min(100, progress || 0));

    const notes = str(g(row, 'Notlar'));
    let recurrence_day = null;
    if (recurrence !== 'once' && recurrence !== 'daily' && recurrence !== 'weekdays') {
      if (has('Tekrar Günü') && str(g(row, 'Tekrar Günü'))) {
        recurrence_day = parseRecurrenceDay(recurrence, g(row, 'Tekrar Günü'));
        if (recurrence_day === undefined) { fail('err.recurrence_day', str(g(row, 'Tekrar Günü'))); continue; }
      } else {
        recurrence_day = dayFromNotes(recurrence, notes) || defaultRecurrenceDay(recurrence, freq, start?.date || due?.date);
      }
    }

    const assignee = str(g(row, 'Sorumlu'));
    if (assignee && !knows(assignee)) unknownPeople.add(assignee);

    const task = {
      _row: excelRow,
      code, directorate, section,
      project: str(g(row, 'Proje')) || BIRIM_PROJECT,
      category: str(g(row, 'Görev / Fonksiyon')),
      title,
      description: notes,
      status, priority, progress,
      assignee,
      start_date: start ? start.date : null,
      due_date: due ? due.date : null,
      due_time: due && due.time ? due.time : null,
      completed_at: status === 'done' && doneAt ? `${doneAt.date}T12:00:00+03:00` : null,
      estimate_minutes: estimate,
      quantity: quantity || 1,
      recurrence, freq_count: freq, recurrence_day,
    };
    if (has('Hatırlatma')) {
      const rem = str(g(row, 'Hatırlatma')) ? toCode('reminder', g(row, 'Hatırlatma')) : 'none';
      if (!rem) { fail('err.reminder', str(g(row, 'Hatırlatma'))); continue; }
      task.reminder = rem;
    }
    if (has('Etiketler')) task.tags = splitList(g(row, 'Etiketler'));
    if (has('Referans')) task.reference_links = splitRefs(g(row, 'Referans'));
    if (has('Kontrol Listesi')) {
      task.checklist = parseDescription(g(row, 'Kontrol Listesi')).checklist;
      if (status === 'done') task.checklist.forEach((it) => { it.done = true; });
    }
    if (!has('Tekrar Günü') && recurrence_day === null) delete task.recurrence_day;

    seen.set(norm(code), excelRow);
    tasks.push(task);
  }
  unknownPeople.forEach((n) => warnings.push({ row: '—', no: '—', reason: 'warn.assignee_unknown', value: n }));

  return finishParsed({ format: 'era', fileName, tasks, people: [], lists, errors, warnings });
}

// ----- Eski 18 sütunlu biçim -----
function parseLegacy(XLSX, wb, { existingPeople = [], fileName = '' } = {}) {
  const errors = [];
  const warnings = [];
  const taskRows = sheetRows(XLSX, wb, SHEETS.tasks);
  const idx = headerIndex(taskRows[0]);
  const missingCols = ['NO', 'BÖLÜM', 'YAPILMASI GEREKEN'].filter((c) => idx[norm(c)] === undefined);
  if (missingCols.length) return { fatal: 'err.missing_columns', fatalValue: missingCols.join(', ') };

  const listRows = sheetRows(XLSX, wb, SHEETS.lists);
  const lists = {
    directorates: [], categories: listColumn(listRows, 'KATEGORİ'),
    sections: listColumn(listRows, 'BÖLÜM'), projects: listColumn(listRows, 'PROJE'), people: [],
  };
  const people = parsePeople(sheetRows(XLSX, wb, SHEETS.people), errors);
  const knows = personMatcher([...people.map((p) => p.full_name), ...existingPeople]);

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
    if (rdRaw && ['weekly', 'monthly', 'yearly'].includes(coded.recurrence)) {
      recurrence_day = parseRecurrenceDay(coded.recurrence, rdRaw);
      if (recurrence_day === undefined) { fail(coded.recurrence === 'weekly' ? 'err.weekday' : 'err.monthday', rdRaw); continue; }
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
    if (assignee && !knows(assignee)) { fail('err.assignee', assignee); continue; }

    const parsed = parseDescription(g(row, 'AÇIKLAMA'));
    if (coded.status === 'done') parsed.checklist.forEach((it) => { it.done = true; });

    if (coded.recurrence === 'once' && coded.reminder !== 'none' && !due && coded.status !== 'done' && coded.status !== 'cancelled') {
      warnings.push({ row: excelRow, no, reason: 'warn.reminder_no_due' });
    }

    seenNo.set(no, excelRow);
    tasks.push({
      _row: excelRow,
      code: `#${no}`, project, section,
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
  return finishParsed({ format: 'legacy', fileName, tasks, people, lists, errors, warnings });
}

// Proje, liste ve şablon çıkarımı (iki biçim için ortak)
function finishParsed({ format, fileName, tasks, people, lists, errors, warnings }) {
  const projectNames = [...lists.projects];
  for (const tk of tasks) if (!projectNames.some((p) => norm(p) === norm(tk.project))) projectNames.push(tk.project);
  for (const tk of tasks) tk.project = projectNames.find((p) => norm(p) === norm(tk.project));
  const projects = projectNames.map((name, i) => {
    const type = projectTypeFromName(name);
    // Kod öneki: projedeki görev kodlarının ortak öneki (ör. GTP-001 -> GTP)
    const prefixes = new Set(tasks.filter((x) => x.project === name)
      .map((x) => (x.code.match(/^([A-Za-zÇĞİÖŞÜçğıöşü]{2,4})-\d+$/) || [])[1]?.toLocaleUpperCase('tr')));
    let code_prefix = prefixes.size === 1 ? [...prefixes][0] || null : null;
    if (type === 'birim') code_prefix = BIRIM_PREFIX;
    return { name, type, sort_order: i + 1, code_prefix };
  });

  const lookups = [];
  const addLookups = (kind, values, parentOf) => {
    const seen = new Set();
    values.forEach((v) => {
      if (v && !seen.has(norm(v))) {
        seen.add(norm(v));
        lookups.push({ kind, value: v, sort_order: seen.size, parent: parentOf ? parentOf(v) : null });
      }
    });
  };
  // Alt birimin direktörlüğü: o alt birimdeki görevlerde en sık geçen direktörlük
  const parentOf = (section) => {
    const c = new Map();
    tasks.filter((x) => norm(x.section) === norm(section) && x.directorate)
      .forEach((x) => c.set(x.directorate, (c.get(x.directorate) || 0) + 1));
    return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  };
  addLookups('directorate', [...lists.directorates, ...tasks.map((x) => x.directorate)]);
  addLookups('section', [...lists.sections, ...tasks.map((x) => x.section)], parentOf);
  addLookups('category', [...lists.categories, ...tasks.map((x) => x.category)]);
  addLookups('tag', tasks.flatMap((x) => x.tags || []));

  return {
    format, fileName, tasks, people, projects, lookups, listPeople: lists.people,
    templates: buildTemplates(tasks, projects),
    errors, warnings,
  };
}

/**
 * Şablon: aynı türdeki TÜM projelerde bulunan adımlar (Görev / Fonksiyon + başlık eşlemesi).
 * Kategorisinde/fonksiyonunda "Özel" geçen adımlar şablona girmez. Yalnızca Web, Panel, İş Planı.
 */
export function buildTemplates(tasks, projects) {
  const out = [];
  for (const type of ['web', 'panel', 'is_plani']) {
    const typeProjects = projects.filter((p) => p.type === type && tasks.some((x) => x.project === p.name));
    if (typeProjects.length < 2) continue;
    const byProject = typeProjects.map((p) => tasks.filter((x) => x.project === p.name).sort((a, b) => compareCode(a.code, b.code)));
    const key = (x) => `${norm(x.category)}|${norm(x.title)}`;
    const counts = new Map();
    byProject.forEach((list) => new Set(list.map(key)).forEach((k) => counts.set(k, (counts.get(k) || 0) + 1)));

    let order = 0;
    const used = new Set();
    for (const x of byProject[0]) {
      const k = key(x);
      if (counts.get(k) !== typeProjects.length || used.has(k)) continue;
      if (norm(x.category).includes('özel')) continue;
      used.add(k);
      const instances = byProject.map((list) => list.find((y) => key(y) === k));
      const itemKey = (it) => norm(it.note ? `${it.text} – ${it.note}` : it.text);
      const common = (x.checklist || []).filter((it) => instances.every((inst) => (inst.checklist || []).some((y) => itemKey(y) === itemKey(it))));
      const sameDesc = instances.every((inst) => norm(inst.description) === norm(x.description));
      out.push({
        project_type: type, sort_order: ++order,
        directorate: x.directorate || null, section: x.section, category: x.category, title: x.title,
        description: buildDescription(sameDesc ? x.description : '', common.map((it) => ({ ...it, done: false }))),
        estimate_minutes: x.estimate_minutes, quantity: x.quantity || 1, recurrence: x.recurrence,
        freq_count: x.freq_count ?? null, recurrence_day: x.recurrence_day ?? null,
        reminder: x.reminder || 'none', priority: x.priority, tags: x.tags || [],
      });
    }
  }
  return out;
}

// ---------- Önizleme: veritabanındaki görevlerle karşılaştırma ----------
const COMPARE_FIELDS = ['project', 'directorate', 'section', 'category', 'title', 'description', 'tags', 'status',
  'priority', 'progress', 'assignee', 'start_date', 'due_date', 'estimate_minutes', 'quantity', 'recurrence',
  'freq_count', 'recurrence_day', 'reminder', 'reference_links', 'checklist'];

function comparable(t, field) {
  const v = t[field];
  if (field === 'checklist') return JSON.stringify((v || []).map((i) => [norm(i.text), norm(i.note), !!i.done]));
  if (Array.isArray(v)) return JSON.stringify(v.map(norm));
  if (field === 'quantity') return String(v || 1);
  return norm(v ?? '');
}

/**
 * existing: [{ code, project, section, ..., assignee (ad), checklist:[{text,note,done}], deleted }]
 * matchesPerson(excelName, existingFullName): sorumlu karşılaştırması (ilk ad eşlemesi)
 */
export function diffWithExisting(parsed, existing, matchesPerson = (a, b) => norm(a) === norm(b)) {
  const byCode = new Map(existing.map((e) => [norm(e.code), e]));
  const toInsert = []; const toUpdate = []; const unchanged = [];
  const fileCodes = new Set(parsed.tasks.map((x) => norm(x.code)));
  for (const tk of parsed.tasks) {
    const e = byCode.get(norm(tk.code));
    if (!e) { toInsert.push(tk); continue; }
    const changed = COMPARE_FIELDS.filter((f) => {
      if (!(f in tk)) return false;                       // dosyada olmayan sütun: panel değeri korunur
      if (f === 'due_date' && !tk.due_date && tk.recurrence !== 'once') return false;
      if (f === 'progress' && !['in_progress', 'waiting'].includes(tk.status)) return false;
      if (f === 'assignee') return !(tk.assignee ? matchesPerson(tk.assignee, e.assignee) : !e.assignee);
      return comparable(tk, f) !== comparable(e, f);
    });
    if (e.deleted) changed.push('restore');
    if (changed.length) toUpdate.push({ task: tk, changed }); else unchanged.push(tk);
  }
  const missing = existing.filter((e) => !e.deleted && !fileCodes.has(norm(e.code)));
  return { toInsert, toUpdate, unchanged, notInFile: missing.length, missingCodes: missing.map((e) => e.code) };
}

// RPC'ye gidecek veri, parçalara bölünmüş (her parça en fazla `size` görev)
export function buildPayloadChunks(parsed, diff, size = 500) {
  const strip = ({ _row, ...rest }) => rest;
  const tasks = [...diff.toInsert, ...diff.toUpdate.map((u) => u.task)].map(strip);
  const chunks = [];
  for (let i = 0; i < Math.max(tasks.length, 1); i += size) {
    chunks.push({
      file_name: parsed.fileName,
      projects: i === 0 ? parsed.projects : [],
      lookups: i === 0 ? parsed.lookups : [],
      people: i === 0 ? parsed.people : [],
      tasks: tasks.slice(i, i + size),
    });
  }
  return chunks;
}

// ---------- Dışa aktarma: ERA biçimi (25 sütun + ek sütunlar, Listeler, Özet Panel) ----------
// data = { tasks, projects, profiles, checklist: Map(taskId -> [madde]), lookups }
export const DATE_COLS = [8, 9, 10];       // Başlangıç, Termin, Bitiş (0 tabanlı)
export const PERCENT_COL = 12;              // İlerleme %
export const HEADER_ROW = 3;                // 0 tabanlı: 4. satır

export function buildExportSheets(data, { today = todayIso() } = {}) {
  const projects = new Map(data.projects.map((p) => [p.id, p]));
  const people = new Map(data.profiles.map((p) => [p.id, p]));
  const tasks = [...data.tasks].sort((a, b) => compareCode(a.code, b.code));
  const freqCols = { daily: 0, weekdays: 0, weekly: 1, monthly: 2, yearly: 3 };

  const rows = tasks.map((tk) => {
    const items = data.checklist.get(tk.id) || [];
    const freq = [null, null, null, null];
    if (tk.recurrence in freqCols) freq[freqCols[tk.recurrence]] = tk.freq_count ?? 1;
    const ds = dueState(tk, today);
    const prj = projects.get(tk.project_id)?.name || '';
    return [
      tk.code, tk.directorate || '', tk.section || '', prj === BIRIM_PROJECT ? '' : prj, tk.category || '', tk.title,
      people.get(tk.assignee_id)?.full_name || '', label('priority', tk.priority),
      isoToSerial(tk.start_date), isoToSerial(tk.due_date),
      tk.status === 'done' && tk.completed_at ? isoToSerial(new Date(tk.completed_at).toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' })) : null,
      label('status', tk.status), (tk.progress || 0) / 100,
      tk.due_date ? daysLeft(tk, today) : null,
      ds ? DUE_STATE_LABELS[ds][0] : '-',
      label('recurrence', tk.recurrence), tk.estimate_minutes ?? null, tk.quantity || 1, ...freq,
      Math.round(yearlyRepeat(tk) * 10) / 10, totalHours(tk), tk.description || '',
      label('reminder', tk.reminder), formatRecurrenceDay(tk.recurrence, tk.recurrence_day),
      (tk.tags || []).join(', '), (tk.reference_links || []).join('\n'), buildDescription('', items),
    ];
  });

  const counts = summarize(tasks, { today });
  const head = [
    ['Evodak Gayrimenkul Yönetimi — Görev Takip'],
    [`Panelden dışa aktarıldı: ${formatDateTR(today)} · ${tasks.length} görev. Gri sütunlar (Kalan Gün, Termin Durumu, Yıllık Tekrar, Toplam Saat) paneldeki hesaplamadır. Z–AD sütunları panelin ek bilgileridir; dosya panele geri yüklenebilir.`],
    [`Toplam ${tasks.length} · Devam eden ${counts.totals.in_progress} · Tamamlanan ${counts.totals.done} · Gecikmiş ${counts.totals.overdue} · Termini yaklaşan ${counts.totals.soon}`],
    [...ERA_COLUMNS, ...EXTRA_COLUMNS],
  ];

  const dirs = data.lookups.filter((x) => x.kind === 'directorate').map((x) => x.value);
  const secs = data.lookups.filter((x) => x.kind === 'section').map((x) => x.value);
  const cats = data.lookups.filter((x) => x.kind === 'category').map((x) => x.value);
  const prjs = [...data.projects].sort((a, b) => a.sort_order - b.sort_order).map((p) => p.name);
  const st = Object.keys(VALUE_LABELS.status).map((c) => label('status', c));
  const pr = Object.keys(VALUE_LABELS.priority).map((c) => label('priority', c));
  const ppl = data.profiles.filter((p) => p.active !== false).map((p) => p.full_name);
  const n = Math.max(dirs.length, secs.length, cats.length, prjs.length, st.length, pr.length, ppl.length);
  const listRows = [['Direktörlük / Birim', 'Alt Birim', 'Durum', 'Öncelik', 'Sorumlu Personel', 'Proje', 'Görev / Fonksiyon'],
    ...Array.from({ length: n }, (_, i) => [dirs[i] || '', secs[i] || '', st[i] || '', pr[i] || '', ppl[i] || '', prjs[i] || '', cats[i] || ''])];

  return {
    [SHEETS.era]: [...head, ...rows],
    [SHEETS.lists]: listRows,
    [SHEETS.summary]: summarySheet(counts, today),
  };
}

// ---------- Özet (panelin Özet ekranı ve Excel'in Özet Panel sayfası) ----------
export function summarize(tasks, { today = todayIso(), key = (tk) => tk.directorate || '—', order = [] } = {}) {
  const blank = () => ({ total: 0, todo: 0, in_progress: 0, waiting: 0, done: 0, cancelled: 0, overdue: 0, soon: 0,
    progressSum: 0, once_h: 0, rec_h: 0 });
  const groups = new Map(order.map((k) => [k, blank()]));
  const totals = blank();
  const prio = new Map(Object.keys(VALUE_LABELS.priority).map((k) => [k, { open: 0, overdue: 0 }]));
  for (const tk of tasks) {
    const k = key(tk);
    if (!groups.has(k)) groups.set(k, blank());
    const ds = dueState(tk, today);
    const hours = totalHours(tk);
    for (const g of [groups.get(k), totals]) {
      g.total++; g[tk.status] = (g[tk.status] || 0) + 1;
      if (ds === 'overdue') g.overdue++;
      if (ds === 'soon') g.soon++;
      g.progressSum += tk.progress || 0;
      if (tk.recurrence === 'once') g.once_h += hours; else g.rec_h += hours;
    }
    if (tk.status !== 'done' && tk.status !== 'cancelled' && prio.has(tk.priority)) {
      prio.get(tk.priority).open++;
      if (ds === 'overdue') prio.get(tk.priority).overdue++;
    }
  }
  const fin = (g) => ({ ...g, avgProgress: g.total ? g.progressSum / g.total : 0, donePct: g.total ? (g.done * 100) / g.total : 0,
    once_h: Math.round(g.once_h * 10) / 10, rec_h: Math.round(g.rec_h * 10) / 10,
    total_h: Math.round((g.once_h + g.rec_h) * 10) / 10, rec_week_h: Math.round((g.rec_h / 50.4) * 10) / 10 });
  return {
    groups: [...groups.entries()].filter(([, g]) => g.total).map(([name, g]) => ({ name, ...fin(g) })),
    totals: fin(totals),
    priorities: [...prio.entries()].map(([code, v]) => ({ code, ...v })),
  };
}

function summarySheet(s, today) {
  const pct = (v) => Math.round(v * 10) / 10;
  return [
    ['Görev Takip — Özet Panel'],
    [`Rapor tarihi: ${formatDateTR(today)} · Panelden hesaplanmıştır.`],
    [],
    ['Toplam Görev', 'Devam Eden', 'Tamamlanan', 'Gecikmiş', 'Termini Yaklaşan', 'Genel Tamamlanma %'],
    [s.totals.total, s.totals.in_progress, s.totals.done, s.totals.overdue, s.totals.soon, pct(s.totals.donePct)],
    [],
    ['Direktörlük / Birim', 'Toplam', 'Başlamadı', 'Devam Ediyor', 'Beklemede', 'Tamamlandı', 'İptal', 'Gecikmiş', 'Yaklaşan', 'Ort. İlerleme %', 'Tamamlanma %'],
    ...s.groups.map((g) => [g.name, g.total, g.todo, g.in_progress, g.waiting, g.done, g.cancelled, g.overdue, g.soon, pct(g.avgProgress), pct(g.donePct)]),
    ['TOPLAM', s.totals.total, s.totals.todo, s.totals.in_progress, s.totals.waiting, s.totals.done, s.totals.cancelled, s.totals.overdue, s.totals.soon, pct(s.totals.avgProgress), pct(s.totals.donePct)],
    [],
    ['Öncelik', 'Açık Görev', 'Gecikmiş'],
    ...s.priorities.map((p) => [label('priority', p.code), p.open, p.overdue]),
    [],
    ['Direktörlük / Birim', 'Görev', 'Tek Seferlik İş (saat)', 'Tekrarlı İşler (saat/yıl)', 'Toplam (saat)', 'Tekrarlı (saat/hafta)'],
    ...s.groups.map((g) => [g.name, g.total, g.once_h, g.rec_h, g.total_h, g.rec_week_h]),
    ['TOPLAM', s.totals.total, s.totals.once_h, s.totals.rec_h, s.totals.total_h, s.totals.rec_week_h],
  ];
}
