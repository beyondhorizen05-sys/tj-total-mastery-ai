export const THEMES = [
  { id: 'portal', name: 'Portal', description: 'Electric cyan · deep space', colors: ['#050914', '#00f2fe', '#2563eb'] },
  { id: 'obsidian', name: 'Obsidian', description: 'Soft silver · quiet dark', colors: ['#0c0e13', '#d7e0eb', '#67758f'] },
  { id: 'aurora', name: 'Aurora', description: 'Mint · violet horizon', colors: ['#071315', '#68f4d3', '#7d69ff'] },
  { id: 'ember', name: 'Ember', description: 'Amber · warm carbon', colors: ['#170e0c', '#ffbd69', '#e36a4a'] },
  { id: 'royal', name: 'Royal', description: 'Amethyst · indigo', colors: ['#0c0920', '#c6a6ff', '#7564ed'] },
  { id: 'ocean', name: 'Ocean', description: 'Ice blue · navy', colors: ['#061421', '#77d9ff', '#2e7bc8'] },
  { id: 'forest', name: 'Forest', description: 'Emerald · charcoal', colors: ['#07150f', '#83efb0', '#23895d'] },
  { id: 'rose', name: 'Rose', description: 'Rose gold · plum', colors: ['#1a0c19', '#ffc2d1', '#bb648b'] },
  { id: 'daybreak', name: 'Daybreak', description: 'Warm ivory · bronze', colors: ['#29251f', '#ffe0a0', '#d28a50'] },
  { id: 'arctic', name: 'Arctic', description: 'Frost · slate', colors: ['#12232d', '#b9f4f5', '#5cacc2'] },
] as const;

export type ThemeId = typeof THEMES[number]['id'];
export function setTheme(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem('tj-theme', id); } catch { /* private browsing */ }
}
export function loadTheme(): ThemeId {
  let saved: string | null = null;
  try { saved = localStorage.getItem('tj-theme'); } catch { /* private browsing */ }
  return THEMES.find((theme) => theme.id === saved)?.id ?? 'portal';
}
