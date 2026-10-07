/**
 * Minimal `{{path.to.value}}` interpolation over { inputs, steps.<id>.output }.
 * Whole-string templates keep their original type; embedded ones are stringified.
 */
export function lookup(scope: any, path: string): unknown {
  let cur = scope;
  for (const part of path.trim().split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function interpolate(value: unknown, scope: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const whole = value.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
    if (whole) return lookup(scope, whole[1]);
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, p) => {
      const v = lookup(scope, p);
      return v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    });
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, scope));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolate(v, scope);
    return out;
  }
  return value;
}

/** Safe condition evaluation: supports `a == b`, `!=`, `>`, `<`, truthiness of a path. No eval. */
export function evalCondition(expr: string, scope: Record<string, unknown>): boolean {
  const m = expr.match(/^\s*(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/);
  const val = (s: string): unknown => {
    const t = s.trim();
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (t === 'null') return null;
    if (/^(['"]).*\1$/.test(t)) return t.slice(1, -1);
    return lookup(scope, t.replace(/^\{\{|\}\}$/g, ''));
  };
  if (!m) return !!val(expr);
  const a: any = val(m[1]), b: any = val(m[3]);
  switch (m[2]) {
    case '==': return a == b; // eslint-disable-line eqeqeq
    case '!=': return a != b; // eslint-disable-line eqeqeq
    case '>': return a > b;
    case '<': return a < b;
    case '>=': return a >= b;
    default: return a <= b;
  }
}
