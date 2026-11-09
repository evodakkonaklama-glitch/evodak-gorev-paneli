// Excel'e aktarma: içe aktarma ekranıyla aynı biçim (18 sütun + Kişiler + Listeler)
import { toast } from './ui.js';
import { t } from './i18n.js';
import { buildExportSheets } from './excel-format.js';
import { store } from './store.js';

const WIDTHS = [6, 26, 18, 16, 40, 60, 18, 14, 10, 10, 18, 14, 18, 10, 16, 12, 16, 30];

// Dosya adı: Evodak_Gorevler_GG.AA.YYYY.xlsx. Telefonda paylaşım menüsü açılır (WhatsApp, Drive, Dosyalar…).
export async function exportTasks(tasks, fileBase = 'Evodak_Gorevler') {
  const XLSX = window.XLSX;
  if (!XLSX) { toast(t('export.no_lib'), { type: 'error' }); return; }
  const sheets = buildExportSheets({
    tasks, projects: store.projects, profiles: store.profiles, lookups: store.lookups, checklist: store.checklist,
  });
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (aoa === Object.values(sheets)[0]) {
      ws['!cols'] = WIDTHS.map((w) => ({ wch: w }));
      ws['!autofilter'] = { ref: `A1:R${aoa.length}` };
      ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    }
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
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
