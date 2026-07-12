#!/usr/bin/env node
// P4-B: リプレイ台。logic/toda_logic.mjs をtrain/test全件に通し、的中率・回収率を計測する。
// train/testの分割は scripts/lib/common.mjs の splitTrainTest と同一ロジック（時系列先頭70%=train）。
// 予測入力に course(進入コース)・st・finish・racetime は一切渡さない（結果情報のリーク禁止）。
// 出力: replay/results.md

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { splitTrainTest } from '../scripts/lib/common.mjs';
import { predictRace, TIER_THRESHOLDS } from '../logic/toda_logic.mjs';

const FIXTURES_PATH = path.resolve('data/fixtures/toda_races.json');
const OUT_PATH = path.resolve('replay/results.md');

function toPredictionInput(entries) {
  // 予測時に既知の情報のみ抽出。course/st/finish/racetimeは渡さない。
  return entries.map((e) => ({
    boat: e.boat,
    loc_win: e.loc_win,
    nat_win: e.nat_win,
    motor_2r: e.motor_2r,
    boat_2r: e.boat_2r,
    exhibition: e.exhibition,
    class: e.class,
  }));
}

function evaluate(races, tierFilter = null) {
  let races_n = 0;
  let excludedSpecial = 0;
  let hit_n = 0;
  let stake = 0;
  let ret = 0;

  for (const r of races) {
    if (r.entries.length !== 6) continue; // 6艇揃わないレースは予測不能としてスキップ
    const trifecta = r.payouts.trifecta;
    const input = toPredictionInput(r.entries);
    const { bets, tier } = predictRace(input);
    if (tierFilter && tier !== tierFilter) continue; // ティア別集計時は対象ティアのみ

    if (trifecta.special) {
      excludedSpecial++;
      continue; // 特払い・不成立は返還=投資と払戻が相殺されニュートラルなため回収率計算から除外
    }
    if (!trifecta.comb) continue;

    races_n++;
    stake += bets.length * 100;
    if (bets.includes(trifecta.comb)) {
      hit_n++;
      ret += trifecta.amount;
    }
  }

  return {
    races_n,
    excludedSpecial,
    hit_n,
    hitRate: races_n === 0 ? null : (hit_n / races_n) * 100,
    stake,
    ret,
    returnRate: stake === 0 ? null : (ret / stake) * 100,
  };
}

function fmtPct(v) {
  return v == null ? 'N/A' : v.toFixed(2) + '%';
}

async function main() {
  const races = JSON.parse(await readFile(FIXTURES_PATH, 'utf8'));
  const { train, test, trainN, testN } = splitTrainTest(races);

  const trainResult = evaluate(train);
  const testResult = evaluate(test);

  console.log('train:', trainResult);
  console.log('test:', testResult);

  let md = '';
  md += '# P4 バックテスト結果 (replay/run.mjs)\n\n';
  md += `対象: data/fixtures/toda_races.json 全${races.length}レース。時系列先頭70%をtrain(${trainN}レース)、残り30%をtest(${testN}レース)として分割（scripts/lib/common.mjs の splitTrainTest、anatomy.mjsと同一分割）。\n\n`;
  md += '係数・重み・買い目型は **train専用データで scripts/train_search.mjs により決定**し、testはこのバックテスト一回のみに使用した（testを見て再選択・再調整は行っていない）。\n\n';

  md += '## 採用ロジックの確定内容\n\n';
  md += '- 使用変数（生死判定=生存のもののみ。docs/anatomy.md参照）: 艇番ベースコース事前分布、当地勝率、全国勝率、モーター2連率、ボート2連率、展示タイム順位、級別\n';
  md += '- 重み（train座標降下グリッドサーチ、0/0.5/1/1.5/2の総当たりを1変数ずつ2周）:\n\n';
  md += '| 変数 | 重み |\n|---|---|\n';
  md += '| course_prior（艇番ベース1着率） | 2 |\n';
  md += '| 当地勝率 (loc_win) | 1 |\n';
  md += '| 全国勝率 (nat_win) | 1.5 |\n';
  md += '| モーター2連率 (motor_2r) | 1 |\n';
  md += '| ボート2連率 (boat_2r) | 0（グリッドサーチの結果、寄与なしが最良） |\n';
  md += '| 展示タイム順位 (exhibition) | 1 |\n';
  md += '| 級別 (class) | 2 |\n\n';
  md += '- 買い目型: 上位3艇BOX(6点) + 1位固定で4位を絡める2点（[1,2,4],[1,4,2]）＝計8点。train上で3型（1着固定流し／上位3艇BOX+α／1-2位box流し）を比較し最良だった型を採用（比較表は下記）。\n\n';

  md += '## 比較した買い目型（train、最終重み確定後の比較。scripts/train_search.mjsの出力）\n\n';
  md += '| 型 | n | 的中数 | 的中率 | 投資 | 回収 | 回収率 |\n|---|---|---|---|---|---|---|\n';
  md += '| a: 1着固定流し(2着2点×3着4点) | 1612 | 366 | 22.70% | 967,200 | 685,480 | 70.87% |\n';
  md += '| b: 上位3艇BOX+rank4フレックス2点（採用） | 1612 | 450 | 27.92% | 1,289,600 | 945,410 | 73.31% |\n';
  md += '| c: 1-2位box×3着4点流し | 1612 | 396 | 24.57% | 1,289,600 | 941,900 | 73.04% |\n\n';

  md += '## 最終計測（logic/toda_logic.mjs 確定版、train/test別）\n\n';
  md += '| 区分 | レース数 | 特払い等除外 | 的中数 | 的中率 | 投資額 | 回収額 | 回収率 |\n|---|---|---|---|---|---|---|---|\n';
  md += `| train | ${trainResult.races_n} | ${trainResult.excludedSpecial} | ${trainResult.hit_n} | ${fmtPct(trainResult.hitRate)} | ${trainResult.stake} | ${trainResult.ret} | ${fmtPct(trainResult.returnRate)} |\n`;
  md += `| test | ${testResult.races_n} | ${testResult.excludedSpecial} | ${testResult.hit_n} | ${fmtPct(testResult.hitRate)} | ${testResult.stake} | ${testResult.ret} | ${fmtPct(testResult.returnRate)} |\n\n`;

  md += '## 比較目標との対比\n\n';
  md += '| 指標 | 真自在律 | RONDE(BOX6) | 戸田ロジック train | 戸田ロジック test |\n|---|---|---|---|---|\n';
  md += `| 的中率 | 35.4% | 18.5% | ${fmtPct(trainResult.hitRate)} | ${fmtPct(testResult.hitRate)} |\n`;
  md += `| 回収率 | 78.5% | - | ${fmtPct(trainResult.returnRate)} | ${fmtPct(testResult.returnRate)} |\n\n`;

  const gapHit = trainResult.hitRate - testResult.hitRate;
  const gapRet = trainResult.returnRate - testResult.returnRate;
  md += '## 正直な評価\n\n';
  if (gapHit > 5 || gapRet > 10) {
    md += `testの成績はtrainよりそれぞれ的中率${gapHit.toFixed(2)}pt、回収率${gapRet.toFixed(2)}pt低下しており、**過学習の兆候がある**と判断する。時系列非i.i.d.データであるため、trainで機能した艇番・級別・展示タイム等の関係性がtest期間（直近水面傾向・出走選手層の変化等）で弱まった可能性がある。\n\n`;
  } else {
    md += `testとtrainの差は的中率${gapHit.toFixed(2)}pt、回収率${gapRet.toFixed(2)}ptに収まっており、過学習の明確な兆候は見られない。\n\n`;
  }
  md += 'testの数字を正とする。目標（真自在律35.4%/78.5%、RONDE18.5%）に対する到達状況は上表の通りであり、届いていない場合もそのまま報告する。\n\n';
  md += '特払い・不成立レースは投資と払戻が相殺されるニュートラル扱いとし、上記の的中率・回収率の分母（レース数）から除外した（件数は表の「特払い等除外」列に記載）。\n\n';

  // P4.5: 選別層（自信度ティア）
  md += '---\n\n';
  md += '# P4.5 選別層（自信度ティア）バックテスト\n\n';
  md += 'confidence(boats) = (1位スコア-2位スコア) + (上位3艇平均スコア-下位3艇平均スコア)。1位の抜け具合と上位/下位集団の分離度を合成した「買いやすさ」指標。\n\n';
  md += `ティア境界（**trainのみ**で算出した confidence の三分位点、scripts/compute_tier_thresholds.mjs）: q33=${TIER_THRESHOLDS.q33}, q67=${TIER_THRESHOLDS.q67}。C: confidence<=q33 / B: q33<confidence<=q67 / A: confidence>q67。\n\n`;

  const tiers = ['A', 'B', 'C'];
  md += '## ティア別成績（train/test）\n\n';
  md += '| 区分 | ティア | レース数 | 特払い等除外 | 的中数 | 的中率 | 投資額 | 回収額 | 回収率 |\n|---|---|---|---|---|---|---|---|---|\n';
  const tierResults = { train: {}, test: {} };
  for (const t of tiers) {
    const trR = evaluate(train, t);
    const teR = evaluate(test, t);
    tierResults.train[t] = trR;
    tierResults.test[t] = teR;
    md += `| train | ${t} | ${trR.races_n} | ${trR.excludedSpecial} | ${trR.hit_n} | ${fmtPct(trR.hitRate)} | ${trR.stake} | ${trR.ret} | ${fmtPct(trR.returnRate)} |\n`;
    md += `| test | ${t} | ${teR.races_n} | ${teR.excludedSpecial} | ${teR.hit_n} | ${fmtPct(teR.hitRate)} | ${teR.stake} | ${teR.ret} | ${fmtPct(teR.returnRate)} |\n`;
  }
  md += '\n';

  md += '## 「Aティアのみ買った場合」 vs 「全買い」（test基準）\n\n';
  md += '| | 的中率 | 回収率 | 対象レース数 |\n|---|---|---|---|\n';
  md += `| 全買い（test全体） | ${fmtPct(testResult.hitRate)} | ${fmtPct(testResult.returnRate)} | ${testResult.races_n} |\n`;
  md += `| Aティアのみ（test） | ${fmtPct(tierResults.test.A.hitRate)} | ${fmtPct(tierResults.test.A.returnRate)} | ${tierResults.test.A.races_n} |\n\n`;

  const aHitImproved = tierResults.test.A.hitRate != null && tierResults.test.A.hitRate > testResult.hitRate;
  const aRetImproved = tierResults.test.A.returnRate != null && tierResults.test.A.returnRate > testResult.returnRate;
  md += '## 正直な評価（P4.5）\n\n';
  if (aHitImproved && aRetImproved) {
    md += `Aティアのみに絞ったtest成績は的中率・回収率とも全買いを上回った（的中率${fmtPct(tierResults.test.A.hitRate)} vs ${fmtPct(testResult.hitRate)}、回収率${fmtPct(tierResults.test.A.returnRate)} vs ${fmtPct(testResult.returnRate)}）。選別層としての効果が確認できた。\n`;
  } else if (aHitImproved || aRetImproved) {
    md += `Aティアのみに絞ったtest成績は的中率・回収率の一方のみ全買いを上回った（的中率${fmtPct(tierResults.test.A.hitRate)} vs ${fmtPct(testResult.hitRate)}、回収率${fmtPct(tierResults.test.A.returnRate)} vs ${fmtPct(testResult.returnRate)}）。効果は限定的であり、**「改善した」と断定するのは誤り**。\n`;
  } else {
    md += `Aティアのみに絞ったtest成績は全買いを上回らなかった（的中率${fmtPct(tierResults.test.A.hitRate)} vs ${fmtPct(testResult.hitRate)}、回収率${fmtPct(tierResults.test.A.returnRate)} vs ${fmtPct(testResult.returnRate)}）。**confidence()による選別は現状のtestでは改善効果を示さなかった**。ティア閾値のtest後調整は行っていない（禁止事項のため）。ティアはUI上の表示情報（参考値）としてのみ残し、買い目のフィルタリングには使用しない。\n`;
  }
  md += '\ntest計測は1回のみ実施し、この結果を受けた閾値・confidence式の再調整は行っていない。\n';

  await writeFile(OUT_PATH, md, 'utf8');
  console.log(`wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
