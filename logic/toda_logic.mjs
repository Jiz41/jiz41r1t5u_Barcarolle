// 戸田専用予想ロジック (P4確定版)
// 依存ゼロの純粋ESM。UIから直接 import { predictRace } できる。
//
// 係数・買い目型は scripts/train_search.mjs による train専用グリッドサーチ（時系列先頭70%、
// 目的関数=trio集合一致率）で決定した。決定過程は docs/anatomy.md（生死判定）と
// replay/results.md（最終数値・比較表）を参照。
//
// 使用する変数は data/fixtures/toda_races.json のスキーマのうち、予測時点で既知の情報のみ
// （艇番／勝率系／モーター・ボート2連率／展示タイム／級別）。course(進入コース)・st(実スタート)・
// finish・racetimeは結果情報のためロジック内では一切参照しない。

// 艇番ベースのコース事前分布（1着率%、train全クリークレースで計測）
export const COURSE_PRIOR_WIN_PCT = {
  1: 43.88297872340425,
  2: 17.154255319148938,
  3: 15.89095744680851,
  4: 12.367021276595745,
  5: 6.914893617021277,
  6: 3.789893617021277,
};

// train座標降下グリッドサーチで確定した重み
export const WEIGHTS = {
  course_prior: 2,
  loc_win: 1,
  nat_win: 1.5,
  motor_2r: 1,
  boat_2r: 0,
  exhibition: 1,
  class: 2,
};

const CLASS_LEVEL = { B2: 1, B1: 2, A2: 3, A1: 4 };

function classToLevel(cls) {
  return CLASS_LEVEL[cls] ?? null;
}

// 変数取得関数。全て「値が高いほど1着に近い」向きに統一する（展示タイムは符号反転）。
const VARIABLE_GETTERS = [
  { key: 'course_prior', get: (e) => COURSE_PRIOR_WIN_PCT[e.boat] ?? null },
  { key: 'loc_win', get: (e) => (typeof e.loc_win === 'number' ? e.loc_win : null) },
  { key: 'nat_win', get: (e) => (typeof e.nat_win === 'number' ? e.nat_win : null) },
  { key: 'motor_2r', get: (e) => (typeof e.motor_2r === 'number' ? e.motor_2r : null) },
  { key: 'boat_2r', get: (e) => (typeof e.boat_2r === 'number' ? e.boat_2r : null) },
  { key: 'exhibition', get: (e) => (typeof e.exhibition === 'number' ? -e.exhibition : null) },
  { key: 'class', get: (e) => classToLevel(e.class) },
];

/**
 * 6艇分のz-scoreを計算する。1艇でも値が欠損している変数はそのレース全体で寄与0とする
 * （train側 scripts/train_search.mjs の precomputeZ と同一ルール）。
 */
function computeZScores(boats) {
  const z = {};
  for (const v of VARIABLE_GETTERS) {
    const vals = boats.map((b) => ({ boat: b.boat, v: v.get(b) }));
    if (vals.some((x) => x.v == null || Number.isNaN(x.v))) {
      z[v.key] = null;
      continue;
    }
    const mean = vals.reduce((s, x) => s + x.v, 0) / vals.length;
    const variance = vals.reduce((s, x) => s + (x.v - mean) ** 2, 0) / vals.length;
    const std = Math.sqrt(variance);
    const zz = {};
    for (const x of vals) zz[x.boat] = std === 0 ? 0 : (x.v - mean) / std;
    z[v.key] = zz;
  }
  return z;
}

function computeScores(boats) {
  const z = computeZScores(boats);
  const scores = {};
  for (const b of boats) {
    let s = 0;
    for (const v of VARIABLE_GETTERS) {
      const zz = z[v.key];
      if (zz == null) continue;
      s += (WEIGHTS[v.key] || 0) * zz[b.boat];
    }
    scores[b.boat] = s;
  }
  return scores;
}

function rankBoats(scores) {
  return Object.keys(scores)
    .map(Number)
    .sort((a, b) => scores[b] - scores[a] || a - b);
}

/**
 * 表示専用: 各艇のスコアを変数ごとの寄与（weight × z-score）に分解して返す。
 * computeScores と同一の z-score・重みを使うため、寄与の合計は必ずスコアと一致する
 * （欠損により寄与0の変数は0として含む）。計算結果・買い目には一切影響しない。
 * @returns {Record<number, Record<string, number>>} boat -> { variableKey: contribution }
 */
export function computeContributions(boats) {
  const z = computeZScores(boats);
  const contributions = {};
  for (const b of boats) {
    const c = {};
    for (const v of VARIABLE_GETTERS) {
      const zz = z[v.key];
      c[v.key] = zz == null ? 0 : (WEIGHTS[v.key] || 0) * zz[b.boat];
    }
    contributions[b.boat] = c;
  }
  return contributions;
}

/**
 * 表示専用: 各艇の変数ごとの「レース内z-score（生値）」を返す。
 * 全変数は「値が高いほど1着に近い」向きに統一済み（展示タイムは符号反転済み）なので、
 * z-scoreが高い=そのレースの中で強い、と読める。1艇でも欠損がある変数はレース全体でnull。
 * computeScores と同じ computeZScores を使うため、計算結果・買い目には一切影響しない。
 * @returns {Record<number, Record<string, number|null>>} boat -> { variableKey: z|null }
 */
export function computeZScoreTable(boats) {
  const z = computeZScores(boats);
  const table = {};
  for (const b of boats) {
    const row = {};
    for (const v of VARIABLE_GETTERS) {
      const zz = z[v.key];
      row[v.key] = zz == null ? null : zz[b.boat];
    }
    table[b.boat] = row;
  }
  return table;
}

// 表示専用: z-scoreの4段階記号化の閾値（±0.8を採用。scripts/check_zlevel_distribution.mjsで
// fixtures上の分布が◎～✕に極端偏りしないことを確認済み）。
export const Z_LEVEL_THRESHOLDS = { high: 0.8, low: -0.8 };

/**
 * z-scoreを ◎○△✕ の4段階記号に変換する（表示専用）。
 * z>=high → ◎（レース内で強い） / 0<=z<high → ○ / low<=z<0 → △ / z<low → ✕（弱い）。
 * データ欠損（null/NaN）は '－' を返す。
 */
export function zLevelSymbol(z, thresholds = Z_LEVEL_THRESHOLDS) {
  if (z == null || Number.isNaN(z)) return '－';
  if (z >= thresholds.high) return '◎';
  if (z >= 0) return '○';
  if (z >= thresholds.low) return '△';
  return '✕';
}

// P4.5: 選別層（自信度ティア）
// 「買いやすさ」指標＝(1位スコア-2位スコア) + (上位3艇平均-下位3艇平均)。
// 前者は「1位が抜けているか」、後者は「上位集団と下位集団が分離しているか」を表す。
// どちらも高いほど「決着が読みやすいレース」とみなす。
function computeConfidence(scores, ranked) {
  const s = ranked.map((b) => scores[b]);
  const top1Minus2 = s[0] - s[1];
  const top3Mean = (s[0] + s[1] + s[2]) / 3;
  const bottom3Mean = (s[3] + s[4] + s[5]) / 3;
  const separation = top3Mean - bottom3Mean;
  return top1Minus2 + separation;
}

// train専用データ(scripts/compute_tier_thresholds.mjs)で決定した confidence の三分位境界。
// C: confidence <= TIER_THRESHOLDS.q33 / B: q33 < confidence <= q67 / A: confidence > q67
// 値を変える時は scripts/compute_tier_thresholds.mjs を再実行してここを更新すること。
export const TIER_THRESHOLDS = {
  q33: 9.560521526721155,
  q67: 12.618367981334869,
};

export function tierFromConfidence(conf, thresholds = TIER_THRESHOLDS) {
  if (conf <= thresholds.q33) return 'C';
  if (conf <= thresholds.q67) return 'B';
  return 'A';
}

/**
 * レースの「買いやすさ」指標を返す（生の数値。ティア分類は tierFromConfidence を使う）。
 * @param {Array} boats predictRaceと同じ入力形式
 */
export function confidence(boats) {
  const scores = computeScores(boats);
  const ranked = rankBoats(scores);
  return computeConfidence(scores, ranked);
}

/**
 * 採用買い目型: 上位3艇BOX(6点) + rank1固定でrank4を絡める2点(計8点)。
 * train比較で最良の回収率・的中率だった型（scripts/train_search.mjs 参照）。
 */
function buildBets(ranked) {
  const [r1, r2, r3, r4] = ranked;
  const perms = [];
  const permute = (arr, prefix = []) => {
    if (arr.length === 0) {
      perms.push(prefix);
      return;
    }
    for (let i = 0; i < arr.length; i++) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
      permute(rest, [...prefix, arr[i]]);
    }
  };
  permute([r1, r2, r3]);
  return [...perms, [r1, r2, r4], [r1, r4, r2]];
}

/**
 * レース入力(6艇分の事前情報)からスコア・順位・3連単買い目8点を返す。
 * @param {Array<{boat:number, loc_win?:number, nat_win?:number, motor_2r?:number,
 *   boat_2r?:number, exhibition?:number, class?:string}>} boats 6艇分。boatは1〜6が揃っている必要がある。
 * @returns {{scores: Record<number, number>, ranked: number[], bets: string[], confidence: number, tier: string}}
 */
export function predictRace(boats) {
  if (!Array.isArray(boats) || boats.length !== 6) {
    throw new Error('predictRace: boats must be an array of exactly 6 entries');
  }
  const scores = computeScores(boats);
  const ranked = rankBoats(scores);
  const bets = buildBets(ranked).map((combo) => combo.join('-'));
  const conf = computeConfidence(scores, ranked);
  const tier = tierFromConfidence(conf);
  return { scores, ranked, bets, confidence: conf, tier };
}

// ============================================================
// 実験: 風×コース補正（採否未確定・デフォルトOFF）
// replay/results.md「風補正実験」セクションの計測結果次第で採用するかを判断する。
// 採用条件（train/testの両方でtest実測が現行以上）を満たさない限り、
// predictRace() の挙動には一切影響しない（下のフラグ・関数は predictRace から
// 呼ばれておらず、既存の計算結果・買い目は完全に不変）。
//
// 想定: 進入コース情報は予測時点で未知のため「艇番」をコースの近似として使う
// （data/fixtures/toda_races.json の course フィールドは結果情報のため使用不可）。
// 風向（追い風/向かい風）は fixtures の wind_dir が方位（北/南等）のみで、
// 戸田水面に対する相対的な追い風/向かい風の判定に必要なコース方位の対応表を
// 持たないため、今回は風速(wind_speed)のみを補正入力として使う。
// wind_speedがnull/欠損の場合は補正0として扱う（風の影響なしとみなす）。
// ============================================================

// 採用フラグ。scripts/wind_correction_experiment.mjs の計測でtestが現行以上になるまではfalseのまま。
export const WIND_CORRECTION_ENABLED = false;

// 採用時の係数（trainグリッドサーチで決定）。未採用の間は0のまま参考値として残す。
export const WIND_CORRECTION_K = { k1: 0, k2: 0 };

/**
 * 風速による艇番ベースのスコア補正を試験的に適用する（表示・本番ロジックには使用しない）。
 * 1号艇（インコース近似）に -k1*windSpeed、4〜6号艇（ダッシュ勢近似）に +k2*windSpeed を加える。
 */
function applyWindCorrectionExperimental(boats, scores, windSpeed, k1, k2) {
  const adjusted = { ...scores };
  const w = typeof windSpeed === 'number' && !Number.isNaN(windSpeed) ? windSpeed : 0;
  for (const b of boats) {
    if (b.boat === 1) {
      adjusted[b.boat] = adjusted[b.boat] - k1 * w;
    } else if (b.boat >= 4 && b.boat <= 6) {
      adjusted[b.boat] = adjusted[b.boat] + k2 * w;
    }
  }
  return adjusted;
}

/**
 * predictRace の風補正版（実験専用）。predictRace自体は呼ばず、独立して計算する。
 * @param {Array} boats predictRaceと同じ入力形式
 * @param {number|null|undefined} windSpeed レースの風速(m)。null/undefinedなら補正0。
 * @param {number} k1 1号艇への補正係数
 * @param {number} k2 4〜6号艇への補正係数
 */
export function predictRaceWithWindExperimental(boats, windSpeed, k1, k2) {
  if (!Array.isArray(boats) || boats.length !== 6) {
    throw new Error('predictRaceWithWindExperimental: boats must be an array of exactly 6 entries');
  }
  const baseScores = computeScores(boats);
  const scores = applyWindCorrectionExperimental(boats, baseScores, windSpeed, k1, k2);
  const ranked = rankBoats(scores);
  const bets = buildBets(ranked).map((combo) => combo.join('-'));
  const conf = computeConfidence(scores, ranked);
  const tier = tierFromConfidence(conf);
  return { scores, ranked, bets, confidence: conf, tier };
}
