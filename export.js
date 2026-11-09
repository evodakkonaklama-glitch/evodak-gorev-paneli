// Excel'e aktarma: içe aktarma ekranıyla aynı biçim (18 sütun + Kişiler + Listeler)
import { toast } from './ui.js';
import { t } from './i18n.js';
import { buildExportSheets } from './excel-format.js';
import { store } from './store.js';

const WIDTHS = [6, 26, 18, 16, 40, 60, 18, 14, 10, 10, 18, 14, 18, 10, 16, 12, 16, 30];

export function exportTasks(tasks, fileBase = 'evodak-gorevler') {
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
  XLSX.writeFile(wb, `${fileBase}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.xlsx`, { compression: true });
  toast(t('export.done', { n: tasks.length }), { type: 'ok' });
}
