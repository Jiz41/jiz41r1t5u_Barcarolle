#!/usr/bin/env node
// P4-A: train専用の重み・買い目型サーチ。
// docs/anatomy.md で「生存」判定された変数 + 艇番ベースのコース事前分布をz-score化し、
// 重みの粗い座標降下グリッドサーチ（各次元 0/0.5/1/1.5/2）で train の3連単的中セット精度を最大化する。
// 最後に、確定した重みのもとで買い目型(a)(b)(c)をtrainのみで比較し、回収率最良のものを採用する。
// 出力は標準出力のみ（人が読んでlogic/toda_logic.mjsに定数を書き写す。このスクリプト自体はロジックに組み込まない）。
// testは一切参照しない。

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { splitTrainTest, isCleanRace } from './lib/common.mjs';

const FIXTURES_PATH = path.resolve('data/fixtures/toda_races.json');
const WEIGHT_GRID = [0, 0.5, 1, 1.5, 2];

function classToLevel(cls) {
  const map = { B2: 1, B1: 2, A2: 3, A1: 4 };
  return map[cls] ?? null;
}

// 艇番ベース事前分布（train全体、クリーンレースのみで計測。anatomy.mdの1aと同一の考え方）
function computeCoursePrior(trainClean) {
  const agg = {};
  for (let b = 1; b <= 6; b++) agg[b] = { n: 0, first: 0 };
  for (const r of trainClean) {
    for (const e of r.entries) {
      agg[e.boat].n++;
      if (e.finish === 1) agg[e.boat].first++;
    }
  }
  const prior = {};
  for (let b = 1; b <= 6; b++) prior[b] = (agg[b].first / agg[b].n) * 100;
  return prior;
}

// 変数定義（生存確認済みのみ。高いほど良い向きに統一した値を返す）
function buildVariableGetters(coursePrior) {
  return [
    { key: 'course_prior', get: (e) => coursePrior[e.boat] },
    { key: 'loc_win', get: (e) => e.loc_win },
    { key: 'nat_win', get: (e) => e.nat_win },
    { key: 'motor_2r', get: (e) => e.motor_2r },
    { key: 'boat_2r', get: (e) => e.boat_2r },
    { key: 'exhibition', get: (e) => (e.exhibition == null ? null : -e.exhibition) }, // 反転して「高いほど良い」に統一
    { key: 'class', get: (e) => classToLevel(e.class) },
  ];
}

// レースごと・艇ごとのz-scoreを事前計算する。値が全艇揃わない変数はそのレースでz=0(寄与なし)。
function precomputeZ(races, variables) {
  // 戻り値: races と同じ長さの配列。各要素は { boats: [1..6], z: {varKey: {boat: z}} }
  return races.map((r) => {
    const z = {};
    for (const v of variables) {
      const vals = r.entries.map((e) => ({ boat: e.boat, v: v.get(e) }));
      if (vals.some((x) => x.v == null || Number.isNaN(x.v))) {
        z[v.key] = null; // 寄与なし
        continue;
      }
      const mean = vals.reduce((s, x) => s + x.v, 0) / vals.length;
      const variance = vals.reduce((s, x) => s + (x.v - mean) ** 2, 0) / vals.length;
      const std = Math.sqrt(variance);
      const zz = {};
      for (const x of vals) zz[x.boat] = std === 0 ? 0 : (x.v - mean) / std;
      z[v.key] = zz;
    }
    return { race: r, z };
  });
}

function scoreBoats(precomputed, variables, weights) {
  // weights: { varKey: number }
  const scores = {};
  for (let b = 1; b <= 6; b++) {
    let s = 0;
    for (const v of variables) {
      const zz = precomputed.z[v.key];
      if (zz == null) continue;
      s += (weights[v.key] || 0) * zz[b];
    }
    scores[b] = s;
  }
  return scores;
}

function rankedBoats(scores) {
  return [1, 2, 3, 4, 5, 6].sort((a, b) => scores[b] - scores[a] || a - b);
}

// trio(3連複的な集合)一致率: 実際の1-2-3着の艇番集合と、スコア上位3艇の集合が一致するか
function trioSetAccuracy(precomputedList, variables, weights) {
  let n = 0;
  let hit = 0;
  for (const p of precomputedList) {
    const r = p.race;
    if (!isCleanRace(r)) continue;
    n++;
    const scores = scoreBoats(p, variables, weights);
    const ranked = rankedBoats(scores);
    const predictedTop3 = new Set(ranked.slice(0, 3));
    const actualTop3 = new Set(r.entries.filter((e) => e.finish <= 3).map((e) => e.boat));
    const match = [...predictedTop3].every((b) => actualTop3.has(b));
    if (match) hit++;
  }
  return { n, hit, rate: (hit / n) * 100 };
}

// ── 買い目型 ────────────────────────────────────────────────
// ranked: スコア降順の艇番配列 [rank1boat, rank2boat, ..., rank6boat]
function betsTypeA(ranked) {
  // 1着固定(rank1) + 2着{rank2,rank3} + 3着{rank2,rank3,rank4,rank5}\2着
  const [r1, r2, r3, r4, r5] = ranked;
  const combos = [];
  for (const second of [r2, r3]) {
    const thirdCandidates = [r2, r3, r4, r5].filter((x) => x !== second);
    for (const third of thirdCandidates) combos.push([r1, second, third]);
  }
  return combos;
}

function betsTypeB(ranked) {
  // 上位3艇BOX(6点) + rank1固定で2着rank2/3着rank4、2着rank4/3着rank2 の2点
  const [r1, r2, r3, r4] = ranked;
  const top3 = [r1, r2, r3];
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
  permute(top3);
  return [...perms, [r1, r2, r4], [r1, r4, r2]];
}

function betsTypeC(ranked) {
  // 1-2位box(rank1,rank2) x 3着{rank3,rank4,rank5,rank6}
  const [r1, r2, r3, r4, r5, r6] = ranked;
  const combos = [];
  for (const [a, b] of [
    [r1, r2],
    [r2, r1],
  ]) {
    for (const third of [r3, r4, r5, r6]) combos.push([a, b, third]);
  }
  return combos;
}

const BET_TYPES = {
  a: { label: '1着固定流し(2着2点×3着4点)', fn: betsTypeA },
  b: { label: '上位3艇BOX+rank4フレックス2点', fn: betsTypeB },
  c: { label: '1-2位box×3着4点流し', fn: betsTypeC },
};

function evaluateBetType(precomputedList, variables, weights, betFn) {
  let races_n = 0;
  let hit_n = 0;
  let stake = 0;
  let ret = 0;
  for (const p of precomputedList) {
    const r = p.race;
    const trifecta = r.payouts.trifecta;
    if (trifecta.special) continue; // 特払い等は集計から除外(返還=ニュートラルのため回収率計算上は無視、別途件数報告)
    if (!trifecta.comb) continue;
    races_n++;
    const scores = scoreBoats(p, variables, weights);
    const ranked = rankedBoats(scores);
    const combos = betFn(ranked);
    stake += combos.length * 100;
    const hitCombo = combos.some((c) => c.join('-') === trifecta.comb);
    if (hitCombo) {
      hit_n++;
      ret += trifecta.amount;
    }
  }
  return {
    races_n,
    hit_n,
    hitRate: (hit_n / races_n) * 100,
    stake,
    ret,
    returnRate: (ret / stake) * 100,
  };
}

// 座標降下グリッドサーチ(2周)。目的関数: trio集合一致率(train)
function coordinateAscent(precomputedTrain, variables, initialWeights) {
  let weights = { ...initialWeights };
  let bestScore = trioSetAccuracy(precomputedTrain, variables, weights).rate;
  for (let pass = 0; pass < 2; pass++) {
    for (const v of variables) {
      let bestVal = weights[v.key];
      for (const g of WEIGHT_GRID) {
        const trial = { ...weights, [v.key]: g };
        const s = trioSetAccuracy(precomputedTrain, variables, trial).rate;
        if (s > bestScore) {
          bestScore = s;
          bestVal = g;
        }
      }
      weights[v.key] = bestVal;
    }
  }
  return { weights, trioAccuracy: bestScore };
}

async function main() {
  const races = JSON.parse(await readFile(FIXTURES_PATH, 'utf8'));
  const { train } = splitTrainTest(races);
  const trainClean = train.filter(isCleanRace);

  const coursePrior = computeCoursePrior(trainClean);
  console.log('course_prior(win% by boat, train clean):', coursePrior);

  const variables = buildVariableGetters(coursePrior);
  const precomputedTrain = precomputeZ(train, variables);

  const initialWeights = {
    course_prior: 1.5,
    loc_win: 1,
    nat_win: 1,
    motor_2r: 1,
    boat_2r: 1,
    exhibition: 1,
    class: 1,
  };

  console.log('\n--- coordinate-ascent weight search (objective: train trio-set accuracy) ---');
  const { weights: finalWeights, trioAccuracy } = coordinateAscent(precomputedTrain, variables, initialWeights);
  console.log('final weights:', finalWeights);
  console.log('train trio-set accuracy:', trioAccuracy.toFixed(2) + '%');

  console.log('\n--- bet type comparison (train, using final weights) ---');
  for (const [key, bt] of Object.entries(BET_TYPES)) {
    const res = evaluateBetType(precomputedTrain, variables, finalWeights, bt.fn);
    console.log(
      `${key} (${bt.label}): n=${res.races_n} hit=${res.hit_n} hitRate=${res.hitRate.toFixed(2)}% stake=${res.stake} return=${res.ret} returnRate=${res.returnRate.toFixed(2)}%`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
