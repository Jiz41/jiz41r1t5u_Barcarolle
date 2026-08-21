#!/usr/bin/env node
// P3: 戸田係数解剖
// data/fixtures/toda_races.json (train分, 時系列先頭70%) を対象に
// コース別成績・単変数生死判定・風速×1号艇の交互作用を計測し docs/anatomy.md に出力する。
// train/testの分割はここで確定させ、replay/run.mjs と同一ロジックを使う（時系列: date→race昇順で先頭70%=train）。

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { splitTrainTest, isCleanRace } from './lib/common.mjs';

const FIXTURES_PATH = path.resolve('data/fixtures/toda_races.json');
const OUT_PATH = path.resolve('docs/anatomy.md');

const NATIONAL_COURSE1_WIN = 55.0; // 与件: 全国平均1コース1着率 約55%

function loadRaces() {
  return readFile(FIXTURES_PATH, 'utf8').then((t) => JSON.parse(t));
}

function pct(n, d) {
  if (d === 0) return null;
  return (n / d) * 100;
}

function fmtPct(v, digits = 1) {
  return v == null ? 'N/A' : v.toFixed(digits) + '%';
}

// ── セクション1: コース別（艇番別）成績 ──────────────────────
function boatCourseStats(cleanRaces) {
  // 艇番ベース（予測時に既知の情報）
  const boatAgg = {};
  // 実進入コースベース（真の物理的結果、枠なり率検証用）
  const courseAgg = {};
  for (let b = 1; b <= 6; b++) {
    boatAgg[b] = { n: 0, first: 0, second: 0, third: 0, top3: 0 };
    courseAgg[b] = { n: 0, first: 0, second: 0, third: 0, top3: 0 };
  }
  let sameCourseCount = 0;
  let courseKnownCount = 0;

  for (const r of cleanRaces) {
    for (const e of r.entries) {
      const agg = boatAgg[e.boat];
      agg.n++;
      if (e.finish === 1) agg.first++;
      if (e.finish === 2) agg.second++;
      if (e.finish === 3) agg.third++;
      if (e.finish <= 3) agg.top3++;

      if (Number.isInteger(e.course) && e.course >= 1 && e.course <= 6) {
        courseKnownCount++;
        if (e.course === e.boat) sameCourseCount++;
        const cagg = courseAgg[e.course];
        cagg.n++;
        if (e.finish === 1) cagg.first++;
        if (e.finish === 2) cagg.second++;
        if (e.finish === 3) cagg.third++;
        if (e.finish <= 3) cagg.top3++;
      }
    }
  }

  const wakunariRate = pct(sameCourseCount, courseKnownCount);

  const rows = [];
  for (let b = 1; b <= 6; b++) {
    const ba = boatAgg[b];
    const ca = courseAgg[b];
    rows.push({
      boat: b,
      boat_n: ba.n,
      boat_1st: pct(ba.first, ba.n),
      boat_2nd: pct(ba.second, ba.n),
      boat_3rd: pct(ba.third, ba.n),
      boat_top3: pct(ba.top3, ba.n),
      course_n: ca.n,
      course_1st: pct(ca.first, ca.n),
      course_2nd: pct(ca.second, ca.n),
      course_3rd: pct(ca.third, ca.n),
      course_top3: pct(ca.top3, ca.n),
    });
  }
  return { rows, wakunariRate, sameCourseCount, courseKnownCount };
}

// ── セクション2: 単変数生死判定 ──────────────────────────────
// 各変数についてレース内順位(1〜6, 1=最良)を計算し、順位別1着率・3連対率を集計する。
// 変数がレース内で全艇分揃わない場合はそのレースをその変数の集計から除外する。

function computeRanks(entries, getValue, higherIsBetter) {
  // entries: 6件想定。値が欠損(null/undefined)の艇が1件でもあれば null を返し当レース除外。
  const vals = entries.map((e) => ({ boat: e.boat, v: getValue(e) }));
  if (vals.some((x) => x.v == null || Number.isNaN(x.v))) return null;
  const sorted = [...vals].sort((a, b) =>
    higherIsBetter ? b.v - a.v || a.boat - b.boat : a.v - b.v || a.boat - b.boat
  );
  const rankByBoat = {};
  sorted.forEach((x, i) => {
    rankByBoat[x.boat] = i + 1;
  });
  return rankByBoat;
}

function classToLevel(cls) {
  const map = { B2: 1, B1: 2, A2: 3, A1: 4 };
  return map[cls] ?? null;
}

const VARIABLES = [
  { key: 'loc_win', label: '当地勝率', get: (e) => e.loc_win, higherIsBetter: true },
  { key: 'nat_win', label: '全国勝率', get: (e) => e.nat_win, higherIsBetter: true },
  {
    key: 'loc_nat_diff',
    label: '当地-全国勝率差',
    get: (e) => (e.loc_win == null || e.nat_win == null ? null : e.loc_win - e.nat_win),
    higherIsBetter: true,
  },
  { key: 'motor_2r', label: 'モーター2連率', get: (e) => e.motor_2r, higherIsBetter: true },
  { key: 'boat_2r', label: 'ボート2連率', get: (e) => e.boat_2r, higherIsBetter: true },
  { key: 'exhibition', label: '展示タイム順位', get: (e) => e.exhibition, higherIsBetter: false },
  { key: 'class', label: '級別', get: (e) => classToLevel(e.class), higherIsBetter: true },
  { key: 'weight', label: '体重', get: () => null, higherIsBetter: true, unavailable: true },
];

function variableRankStats(cleanRaces, variable) {
  const buckets = {};
  for (let rk = 1; rk <= 6; rk++) buckets[rk] = { n: 0, first: 0, top3: 0 };
  let usedRaces = 0;

  if (variable.unavailable) {
    return { buckets, usedRaces: 0, unavailable: true };
  }

  for (const r of cleanRaces) {
    const rankByBoat = computeRanks(r.entries, variable.get, variable.higherIsBetter);
    if (!rankByBoat) continue;
    usedRaces++;
    for (const e of r.entries) {
      const rk = rankByBoat[e.boat];
      const b = buckets[rk];
      b.n++;
      if (e.finish === 1) b.first++;
      if (e.finish <= 3) b.top3++;
    }
  }

  const rows = [];
  for (let rk = 1; rk <= 6; rk++) {
    const b = buckets[rk];
    rows.push({ rank: rk, n: b.n, first: pct(b.first, b.n), top3: pct(b.top3, b.n) });
  }
  return { rows, usedRaces };
}

function isMonotonicDecreasing(values, maxViolations = 1) {
  let violations = 0;
  for (let i = 0; i < values.length - 1; i++) {
    if (values[i] == null || values[i + 1] == null) continue;
    if (values[i] < values[i + 1]) violations++;
  }
  return violations <= maxViolations;
}

function judgeVariable(stats) {
  if (stats.unavailable) return { verdict: '判定不能（データ欠如）', spread: null };
  const firstVals = stats.rows.map((r) => r.first);
  const spread = Math.max(...firstVals.filter((v) => v != null)) - Math.min(...firstVals.filter((v) => v != null));
  const monotonic = isMonotonicDecreasing(firstVals, 1);
  const alive = monotonic && spread >= 5;
  return { verdict: alive ? '生存' : '死亡', spread, monotonic };
}

// ── セクション3: 風速×1号艇1着率 ──────────────────────────────
function windCourse1Interaction(cleanRaces) {
  const bins = [
    { label: '0-1m', test: (w) => w <= 1 },
    { label: '2-3m', test: (w) => w >= 2 && w <= 3 },
    { label: '4-5m', test: (w) => w >= 4 && w <= 5 },
    { label: '6m+', test: (w) => w >= 6 },
  ];
  const agg = bins.map(() => ({ n: 0, first: 0 }));

  for (const r of cleanRaces) {
    if (r.wind_speed == null) continue;
    const boat1 = r.entries.find((e) => e.boat === 1);
    if (!boat1) continue;
    const idx = bins.findIndex((b) => b.test(r.wind_speed));
    if (idx === -1) continue;
    agg[idx].n++;
    if (boat1.finish === 1) agg[idx].first++;
  }

  return bins.map((b, i) => ({
    label: b.label,
    n: agg[i].n,
    first: pct(agg[i].first, agg[i].n),
  }));
}

// ── main ────────────────────────────────────────────────────
async function main() {
  const races = await loadRaces();
  const { train, test, trainN, testN } = splitTrainTest(races);
  const trainClean = train.filter(isCleanRace);
  const trainDirty = train.length - trainClean.length;

  const courseStats = boatCourseStats(trainClean);
  const windInteraction = windCourse1Interaction(trainClean);

  const varResults = VARIABLES.map((v) => {
    const stats = variableRankStats(trainClean, v);
    const judge = judgeVariable(stats);
    return { variable: v, stats, judge };
  });

  const alive = varResults.filter((r) => r.judge.verdict === '生存');
  const dead = varResults.filter((r) => r.judge.verdict === '死亡');
  const unavail = varResults.filter((r) => r.judge.verdict.startsWith('判定不能'));

  let md = '';
  md += '# 戸田係数解剖 (P3)\n\n';
  md += `対象: data/fixtures/toda_races.json 全${races.length}レース中、時系列先頭70%をtrainとして使用（本ファイルの全数値はtrainのみに基づく。testは一切参照していない）。\n\n`;
  md += `- train: ${trainN}レース（${train[0].date} 〜 ${train[trainN - 1].date}）、うちクリーン（6艇全員1〜6着で確定、フライング/欠場/失格なし）${trainClean.length}レース、非クリーン${trainDirty}レース\n`;
  md += `- test: ${testN}レース（${test[0].date} 〜 ${test[testN - 1].date}）※本ファイルでは未使用、P4バックテストでのみ使用\n`;
  md += `- 本セクションのコース別・変数順位別の統計は**クリーンレースのみ**（${trainClean.length}件）で計測した（6艇全員の着順が確定していないと順位1〜6の集計バケツが揃わないため）。P4のバックテスト回収率計算は非クリーンレースも含む全train/test対象で行う（別ファイル replay/results.md）。\n\n`;

  md += '## 1. コース別（艇番別）成績\n\n';
  md += `枠なり率（進入コース＝艇番の一致率、コース情報が確定しているエントリ${courseStats.courseKnownCount}件中）: **${fmtPct(courseStats.wakunariRate)}**\n\n`;
  md += '### 1a. 艇番ベース（＝予測時に既知の情報。実運用ではこちらを使う）\n\n';
  md += '| 艇番 | n | 1着率 | 2着率 | 3着率 | 3連対率 |\n|---|---|---|---|---|---|\n';
  for (const row of courseStats.rows) {
    md += `| ${row.boat} | ${row.boat_n} | ${fmtPct(row.boat_1st)} | ${fmtPct(row.boat_2nd)} | ${fmtPct(row.boat_3rd)} | ${fmtPct(row.boat_top3)} |\n`;
  }
  md += '\n';
  md += '### 1b. 実進入コースベース（結果論。艇番ベースとの差は枠なり率の裏付け）\n\n';
  md += '| コース | n | 1着率 | 2着率 | 3着率 | 3連対率 | 全国1着率との差(1コースのみ) |\n|---|---|---|---|---|---|---|\n';
  for (const row of courseStats.rows) {
    const diff = row.course === 1 && row.course_1st != null ? (row.course_1st - NATIONAL_COURSE1_WIN).toFixed(1) + 'pt' : '-';
    md += `| ${row.boat} | ${row.course_n} | ${fmtPct(row.course_1st)} | ${fmtPct(row.course_2nd)} | ${fmtPct(row.course_3rd)} | ${fmtPct(row.course_top3)} | ${diff} |\n`;
  }
  md += `\n戸田1コース1着率 ${fmtPct(courseStats.rows[0].course_1st)} は全国平均目安${NATIONAL_COURSE1_WIN}%と比較して${
    courseStats.rows[0].course_1st != null
      ? (courseStats.rows[0].course_1st - NATIONAL_COURSE1_WIN >= 0 ? '高い' : '低い')
      : '比較不能'
  }（戸田＝淡水・直線が長くまくりが決まりやすい水面として知られ、イン受難傾向が定性的に一致するか要確認）。\n\n`;

  md += '## 2. 単変数の生死判定\n\n';
  md += '判定基準: レース内順位1〜6ごとの1着率が「単調非増加（隣接逆転を1回まで許容）」かつ「1位バケツと6位バケツの1着率差が5pt以上」を満たせば生存、満たさなければ死亡。判定不能はデータ欠如。\n\n';
  for (const r of varResults) {
    md += `### ${r.variable.label} (${r.variable.key}) — ${r.judge.verdict}\n\n`;
    if (r.judge.verdict.startsWith('判定不能')) {
      md += 'data/fixtures/toda_races.json のスキーマに体重が独立フィールドとして存在しない（class_weightから級別のみ抽出済み、体重は未パース）ため判定不能。将来的にパーサー側で体重フィールドを追加すれば判定可能。\n\n';
      continue;
    }
    md += `対象レース数（全艇分値が揃ったクリーンレース）: ${r.stats.usedRaces}\n\n`;
    md += '| 順位 | n | 1着率 | 3連対率 |\n|---|---|---|---|\n';
    for (const row of r.stats.rows) {
      md += `| ${row.rank} | ${row.n} | ${fmtPct(row.first)} | ${fmtPct(row.top3)} |\n`;
    }
    md += `\n1位バケツ-6位バケツ差: ${r.judge.spread != null ? r.judge.spread.toFixed(1) + 'pt' : 'N/A'} / 単調性: ${r.judge.monotonic ? '満たす' : '満たさない'}\n\n`;
  }

  md += '## 3. 交互作用: 風速×1号艇1着率\n\n';
  md += '戸田のイン受難仮説（強風時に1号艇の1着率が下がるか）の検証。1号艇の艇番ベース1着率を風速帯別に集計（クリーンレースのみ）。\n\n';
  md += '| 風速帯 | n | 1号艇1着率 |\n|---|---|---|\n';
  for (const row of windInteraction) {
    md += `| ${row.label} | ${row.n} | ${fmtPct(row.first)} |\n`;
  }
  const validBins = windInteraction.filter((b) => b.first != null);
  const trendNote =
    validBins.length >= 2
      ? validBins[0].first - validBins[validBins.length - 1].first >= 5
        ? '風速が上がるほど1号艇1着率が明確に低下しており、イン受難仮説を支持する結果。'
        : '風速帯間で明確な単調低下は確認できず、イン受難仮説を強く支持する結果ではない。'
      : 'サンプル不足で判定不能。';
  md += `\n${trendNote}\n\n`;

  md += '## 4. 判定サマリー\n\n';
  md += `生存変数: ${alive.length > 0 ? alive.map((r) => r.variable.label).join('、') : 'なし'}\n\n`;
  md += `死亡変数: ${dead.length > 0 ? dead.map((r) => r.variable.label).join('、') : 'なし'}\n\n`;
  md += `判定不能: ${unavail.length > 0 ? unavail.map((r) => r.variable.label).join('、') : 'なし'}\n\n`;
  md += '風速・風向はレース単位の変数であり「艇の変数順位」という形での単調性判定になじまないため、上記の生死判定表からは除外し、セクション3の交互作用分析で別途扱った。風向はサンプル中「無風」が大半を占め水面別の追い風/向かい風分類の妥当性を確認できなかったため本解剖では対象外とした（今後の課題として明記）。\n\n';

  md += '### 採用重み初期案（P4のグリッドサーチの出発点。最終値は replay/results.md 参照）\n\n';
  md += '| 変数 | 初期重み案 |\n|---|---|\n';
  md += '| 艇番ベース1着率（コース事前分布） | 1.5 |\n';
  for (const r of alive) {
    md += `| ${r.variable.label} | 1.0 |\n`;
  }
  md += '\n初期案は「生存確認された変数は等しく重み1.0、コース事前分布のみやや重め」という素朴な出発点であり、P4のグリッドサーチ（0/0.5/1/1.5/2の総当たり、train回収率で選定）で確定値に置き換える。\n';

  await writeFile(OUT_PATH, md, 'utf8');
  console.log(`wrote ${OUT_PATH}`);
  console.log(`train ${trainN} (clean ${trainClean.length}), test ${testN}`);
  console.log(`alive: ${alive.map((r) => r.variable.key).join(',')}`);
  console.log(`dead: ${dead.map((r) => r.variable.key).join(',')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
