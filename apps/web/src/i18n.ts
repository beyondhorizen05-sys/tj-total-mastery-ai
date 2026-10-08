export type UiLanguage = 'en' | 'ur' | 'roman-ur';

export function uiLanguage(locale: string): UiLanguage {
  if (/^ur-Latn(?:-|$)/i.test(locale)) return 'roman-ur';
  if (/^ur(?:-|$)/i.test(locale)) return 'ur';
  return 'en';
}

const labels: Record<string, { ur: string; roman: string }> = {
  command: { ur: 'کمانڈ مرکز', roman: 'Command Markaz' },
  chat: { ur: 'چیٹ اور مقصد', roman: 'Chat aur Maqsad' },
  vision: { ur: 'تصویر کی سمجھ', roman: 'Tasveer ki Samajh' },
  data: { ur: 'ڈیٹا تجزیہ', roman: 'Data Tajziya' },
  education: { ur: 'تعلیم', roman: 'Taleem' },
  business: { ur: 'کاروبار', roman: 'Karobar' },
  media: { ur: 'میڈیا اسٹوڈیو', roman: 'Media Studio' },
  wellness: { ur: 'صحت کا جائزہ', roman: 'Sehat ka Jaiza' },
  finance: { ur: 'ذاتی مالیات', roman: 'Zati Maliat' },
  paper: { ur: 'فرضی تجارت', roman: 'Farzi Tijarat' },
  tasks: { ur: 'کام', roman: 'Kaam' },
  activity: { ur: 'سرگرمی', roman: 'Sargarmi' },
  agents: { ur: 'ایجنٹس', roman: 'Agents' },
  workflows: { ur: 'ورک فلوز', roman: 'Workflows' },
  capabilities: { ur: 'صلاحیتیں', roman: 'Salahiyatein' },
  skills: { ur: 'مقامی اسکلز', roman: 'Local Skills' },
  learning: { ur: 'بہتری کا جائزہ', roman: 'Behtari ka Jaiza' },
  connectors: { ur: 'کنیکٹرز', roman: 'Connectors' },
  workbench: { ur: 'اے پی آئی ورک بینچ', roman: 'API Workbench' },
  approvals: { ur: 'منظوریاں', roman: 'Manzooriyan' },
  memory: { ur: 'یادداشت', roman: 'Yaad-dasht' },
  graph: { ur: 'علمی گراف', roman: 'Ilmi Graph' },
  models: { ur: 'ماڈلز', roman: 'Models' },
  settings: { ur: 'ترتیبات', roman: 'Tarteebat' },
};

export function navLabel(id: string, fallback: string, language: UiLanguage) {
  return language === 'en' ? fallback : labels[id]?.[language === 'ur' ? 'ur' : 'roman'] ?? fallback;
}
