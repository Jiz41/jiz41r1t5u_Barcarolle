// 3連単買い目の畳み表記アルゴリズム（表示専用・汎用）。
// 買い目文字列の配列（例: ["1-2-3","1-2-4",...]）を受け取り、
// 「1着候補-2着候補-3着候補」のクロス積グループに分解する。
// 各グループを展開した結果が入力集合と完全一致することを前提とし、
// 過不足があるグループは絶対に採用しない（=より小さいグループへフォールバック）。
//
// アルゴリズム: 貪欲法。残っている買い目の中から「最大のクロス積グループ
// （pos1候補集合 × pos2候補集合 × pos3候補集合、同着重複を除く）」を
// 総当たりで探し、見つかった分だけ切り出して残りを再帰的に処理する。
// 2点未満のグループは畳む価値が無いため個別表記として残す。
// 最大3グループまで（要件）。それ以上畳めない分は leftover に残す。

function uniqueBoats(combos) {
  const set = new Set();
  combos.forEach((c) => c.forEach((b) => set.add(b)));
  return Array.from(set).sort((a, b) => a - b);
}

function allNonEmptySubsets(arr) {
  const result = [];
  const n = arr.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) subset.push(arr[i]);
    }
    result.push(subset);
  }
  return result;
}

function findBestCrossGroup(combos) {
  const boats = uniqueBoats(combos);
  const subsets = allNonEmptySubsets(boats);
  const setStr = new Set(combos.map((c) => c.join('-')));
  let best = null;

  for (const s1 of subsets) {
    for (const s2 of subsets) {
      for (const s3 of subsets) {
        const product = [];
        for (const a of s1) {
          for (const b of s2) {
            if (b === a) continue;
            for (const c of s3) {
              if (c === a || c === b) continue;
              product.push([a, b, c]);
            }
          }
        }
        if (product.length < 2) continue;
        const allPresent = product.every((p) => setStr.has(p.join('-')));
        if (!allPresent) continue;
        if (!best || product.length > best.combos.length) {
          best = { pos1: s1, pos2: s2, pos3: s3, combos: product };
        }
      }
    }
  }
  return best;
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function formatGroup(g) {
  const s1 = [...g.pos1].sort((a, b) => a - b);
  const s2 = [...g.pos2].sort((a, b) => a - b);
  const s3 = [...g.pos3].sort((a, b) => a - b);
  const count = g.combos.length;
  const isBox = arraysEqual(s1, s2) && arraysEqual(s2, s3) && s1.length === 3 && count === 6;
  const label = isBox ? s1.join('') + ' BOX' : s1.join('') + '-' + s2.join('') + '-' + s3.join('');
  return { label, count, combos: g.combos.map((c) => c.join('-')) };
}

/**
 * @param {string[]} bets "a-b-c" 形式の3連単買い目配列（重複なし前提）
 * @param {number} maxGroups 畳むグループ数の上限（デフォルト3）
 * @returns {{ groups: {label:string, count:number, combos:string[]}[], leftover: string[], total: number }}
 */
export function foldBets(bets, maxGroups = 3) {
  const combos = bets.map((s) => s.split('-').map(Number));
  let remaining = combos.slice();
  const groups = [];

  while (remaining.length > 1 && groups.length < maxGroups) {
    const found = findBestCrossGroup(remaining);
    if (!found || found.combos.length < 2) break;
    groups.push(found);
    const used = new Set(found.combos.map((c) => c.join('-')));
    remaining = remaining.filter((c) => !used.has(c.join('-')));
  }

  return {
    groups: groups.map(formatGroup),
    leftover: remaining.map((c) => c.join('-')),
    total: bets.length,
  };
}

/**
 * foldBets の結果を再展開し、元の買い目集合と完全一致するか検証する。
 * @returns {boolean}
 */
export function verifyFold(bets, folded) {
  const expanded = new Set();
  folded.groups.forEach((g) => g.combos.forEach((c) => expanded.add(c)));
  folded.leftover.forEach((c) => expanded.add(c));
  const original = new Set(bets);
  if (expanded.size !== original.size) return false;
  for (const c of original) if (!expanded.has(c)) return false;
  for (const c of expanded) if (!original.has(c)) return false;
  return true;
}
