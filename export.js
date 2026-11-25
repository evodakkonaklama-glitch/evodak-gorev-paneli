// Excel'e aktarma: ERA "Görev Takip" biçimi (25 sütun + panel ek sütunları) + Listeler + Özet Panel.
// Dosya tekrar içe aktarılabilir; hiçbir bilgi kaybolmaz.
import { toast } from './ui.js';
import { t } from './i18n.js';
import { buildExportSheets, SHEETS, DATE_COLS, PERCENT_COL, HEADER_ROW } from './excel-format.js';
import { store } from './store.js';

// ERA dosyasındaki sütun genişlikleri + ek sütunlar
const WIDTHS = [11, 22, 22, 30, 16, 20, 50, 16, 9, 11, 11, 11, 12, 9, 8, 16, 11, 8, 6, 6, 7, 6, 6, 9, 9, 40, 14, 18, 16, 30, 40];

export function buildWorkbook(XLSX, tasks) {
  const sheets = buildExportSheets({
    tasks, projects: store.projects, profiles: store.profiles, lookups: store.lookups, checklist: store.checklist,
  });
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (name === SHEETS.era) {
      const last = aoa.length - 1;
      const lastCol = XLSX.utils.encode_col(aoa[HEADER_ROW].length - 1);
      ws['!cols'] = WIDTHS.map((w) => ({ wch: w }));
      ws['!autofilter'] = { ref: `A${HEADER_ROW + 1}:${lastCol}${last + 1}` };
      ws['!freeze'] = { xSplit: 1, ySplit: HEADER_ROW + 1 };
      ws['!merges'] = [0, 1, 2].map((r) => ({ s: { r, c: 0 }, e: { r, c: 13 } }));
      for (let r = HEADER_ROW + 1; r <= last; r++) {
        for (const c of DATE_COLS) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell && cell.t === 'n') cell.z = 'dd.mm.yyyy';
        }
        const p = ws[XLSX.utils.encode_cell({ r, c: PERCENT_COL })];
        if (p && p.t === 'n') p.z = '0%';
      }
    } else if (name === SHEETS.summary) {
      ws['!cols'] = [{ wch: 28 }, ...Array(10).fill({ wch: 14 })];
    } else {
      ws['!cols'] = Array(7).fill({ wch: 28 });
    }
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return wb;
}

// Dosya adı: Evodak_Gorev_Takip_GG.AA.YYYY.xlsx. Telefonda paylaşım menüsü açılır (WhatsApp, Drive, Dosyalar…).
export async function exportTasks(tasks, fileBase = 'Evodak_Gorev_Takip') {
  const XLSX = window.XLSX;
  if (!XLSX) { toast(t('export.no_lib'), { type: 'error' }); return; }
  const wb = buildWorkbook(XLSX, tasks);
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const name = `${fileBase}_${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}.xlsx`;
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
  const type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  if (touch && typeof File === 'function' && navigator.canShare) {
    const file = new File([bytes], name, { type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        toast(t('export.done', { n: tasks.length }), { type: 'ok' });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;   // kullanıcı paylaşımı kapattı
      }
    }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(t('export.done', { n: tasks.length }), { type: 'ok' });
}
