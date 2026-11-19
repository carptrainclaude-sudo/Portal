// Нормалізація назв товарів для пошуку та перевірки дублікатів:
// без урахування регістру, пробілів/розділових знаків та різниці між схожими латинськими й кириличними літерами.

const LATIN_TO_CYRILLIC: Record<string, string> = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', i: 'і', k: 'к', m: 'м',
  o: 'о', p: 'р', t: 'т', x: 'х', y: 'у',
};

function mapChars(s: string): string {
  let out = '';
  for (const ch of s) out += LATIN_TO_CYRILLIC[ch] ?? ch;
  return out;
}

/** Повна нормалізація: однакові для «Fairy  Лимон» і «fаirу лимон». */
export function normalizeName(s: string): string {
  return mapChars(s.normalize('NFKC').toLowerCase().replace(/ё/g, 'е'))
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Токени для пошуку (кожен нормалізований окремо). */
export function searchTokens(q: string): string[] {
  return q
    .split(/[\s,.;:()«»"'\/\\-]+/)
    .map(normalizeName)
    .filter((t) => t.length > 0);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Оцінка схожості 0..1 між двома нормалізованими назвами. */
export function similarity(normA: string, normB: string): number {
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;
  const longer = Math.max(normA.length, normB.length);
  const shorter = Math.min(normA.length, normB.length);
  let score = 1 - levenshtein(normA, normB) / longer;
  if (shorter >= 5 && (normA.includes(normB) || normB.includes(normA))) {
    score = Math.max(score, 0.75 + 0.25 * (shorter / longer));
  }
  return score;
}

/** Слова збігаються, якщо рівні або мають спільну основу (губка/губки, пакет/пакети). */
function tokensMatch(x: string, y: string): boolean {
  if (x === y) return true;
  const min = Math.min(x.length, y.length);
  if (min < 4) return false;
  let p = 0;
  while (p < min && x[p] === y[p]) p++;
  return p >= 4 && p >= 0.7 * min;
}

/** Схожість за словами (порядок слів і закінчення не важливі): середнє часток збігів з обох боків. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = [...new Set(searchTokens(a).filter((t) => t.length > 1))];
  const tb = [...new Set(searchTokens(b).filter((t) => t.length > 1))];
  if (!ta.length || !tb.length) return 0;
  const ma = ta.filter((x) => tb.some((y) => tokensMatch(x, y))).length;
  const mb = tb.filter((y) => ta.some((x) => tokensMatch(x, y))).length;
  return (ma / ta.length + mb / tb.length) / 2;
}
