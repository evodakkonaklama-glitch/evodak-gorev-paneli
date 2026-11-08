// Tarih yardımcıları – tüm hesaplar Europe/Istanbul saatine göre
import { t } from './i18n.js';

export const TZ = 'Europe/Istanbul';
const pad = (n) => String(n).padStart(2, '0');

// İstanbul'da şu anki tarih: 'YYYY-MM-DD'
export function todayIso(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// 'YYYY-MM-DD' -> 'GG.AA.YYYY'
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

// timestamptz -> 'GG.AA.YYYY SS:DD' (İstanbul)
export function fmtDateTime(ts) {
  if (!ts) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

export function fmtTime(time) { return time ? String(time).slice(0, 5) : ''; }

// İstanbul yerel tarih+saatini gerçek zamana çevirir (Türkiye yaz saati uygulamaz: UTC+3)
export function istanbulToDate(isoDate, time = '09:00') {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [hh, mm] = String(time || '09:00').split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 3, mm));
}

/**
 * Bitişe göre durum etiketi: { text, tone: 'overdue' | 'soon' | 'normal' }
 * Tamamlanan/iptal edilen görevde null döner.
 */
export function dueInfo(task, now = new Date()) {
  if (!task.due_date || task.status === 'done' || task.status === 'cancelled') return null;
  const due = istanbulToDate(task.due_date, task.due_time);
  const diffMs = due - now;
  const hours = Math.round(Math.abs(diffMs) / 3600000);
  const today = todayIso(now);
  if (diffMs < 0) {
    const days = daysBetween(task.due_date, today);
    return { text: days >= 1 ? t('due.overdue_days', { n: days }) : t('due.overdue_hours', { n: Math.max(1, hours) }), tone: 'overdue' };
  }
  if (task.due_date === today) return { text: hours < 1 ? t('due.today') : t('due.left_hours', { n: hours }), tone: 'soon' };
  const days = daysBetween(today, task.due_date);
  if (days === 1) return { text: t('due.tomorrow'), tone: 'soon' };
  return { text: t('due.left_days', { n: days }), tone: days <= 3 ? 'soon' : 'normal' };
}

function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export { pad };
