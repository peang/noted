export interface DiffLine {
  type: 'same' | 'add' | 'del';
  text: string;
}

// Above this the LCS table gets too big to build in the browser
const MAX_DIFF_CELLS = 4_000_000;

// Line-based diff (LCS). Returns null when the changed region is too large to diff cheaply.
export function diffLines(oldText: string, newText: string): DiffLine[] | null {
  const a = oldText.split('\n');
  const b = newText.split('\n');

  // Trim the common prefix/suffix so the table only covers the changed region
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if (n * m > MAX_DIFF_CELLS) return null;

  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = a.slice(0, start).map((text) => ({ type: 'same', text }));
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      out.push({ type: 'same', text: midA[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'del', text: midA[i++] });
    } else {
      out.push({ type: 'add', text: midB[j++] });
    }
  }
  while (i < n) out.push({ type: 'del', text: midA[i++] });
  while (j < m) out.push({ type: 'add', text: midB[j++] });
  for (const text of a.slice(endA)) out.push({ type: 'same', text });
  return out;
}
