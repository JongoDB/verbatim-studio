export interface DiffToken {
  type: 'same' | 'added' | 'removed';
  text: string;
}

/**
 * Compute a word-level diff between two strings using Myers-like LCS.
 * Returns an array of tokens indicating same/added/removed words.
 */
export function wordDiff(original: string, corrected: string): DiffToken[] {
  const oldWords = tokenize(original);
  const newWords = tokenize(corrected);

  // Build LCS table
  const m = oldWords.length;
  const n = newWords.length;

  const lcs: number[][] = [];

  for (let i = 0; i <= m; i++) {
    lcs[i] = new Array(n + 1).fill(0);
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack to build diff
  const tokens: DiffToken[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      tokens.push({ type: 'same', text: oldWords[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      tokens.push({ type: 'added', text: newWords[j - 1] });
      j--;
    } else {
      tokens.push({ type: 'removed', text: oldWords[i - 1] });
      i--;
    }
  }

  tokens.reverse();

  // Merge consecutive tokens of the same type for cleaner output
  return mergeTokens(tokens);
}

function tokenize(text: string): string[] {
  // Split on whitespace boundaries but keep punctuation attached to words
  return text.split(/(\s+)/).filter(t => t.length > 0);
}

function mergeTokens(tokens: DiffToken[]): DiffToken[] {
  if (tokens.length === 0) return tokens;

  const merged: DiffToken[] = [tokens[0]];
  for (let i = 1; i < tokens.length; i++) {
    const last = merged[merged.length - 1];
    if (last.type === tokens[i].type) {
      last.text += tokens[i].text;
    } else {
      merged.push({ ...tokens[i] });
    }
  }
  return merged;
}
