#!/usr/bin/env node
// shadow-dataブランチの実運用シャドーログ(data/shadow/*.jsonl)を使ったリプレイ台。
// logic/toda_logic.mjs の predictRace に shadow log の entries(6艇分の生入力特徴量)を通し、
// 実際の finish(着順) との的中判定を独自に再計算する。
// shadow-dataブランチはmasterにマージせず、`git show shadow-data:<path>` で読み取り専用取得する。
// masterの作業ツリー・カレントブランチは一切変更しない。
// 出力: replay/results_shadow.md

import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { predictRace, WEIGHTS } from '../logic/toda_logic.mjs';

const OUT_PATH = path.resolve('replay/results_shadow.md');

// WEIGHTS_OVERRIDE環境変数で係数を一時的に上書きできる（例: WEIGHTS_OVERRIDE='{"exhibition":2}'）。
// logic/toda_logic.mjs のデフォルト値自体は変更しない。指定キーのみ上書きし、他は既定値のまま。
if (process.env.WEIGHTS_OVERRIDE) {
  const override = JSON.parse(process.env.WEIGHTS_OVERRIDE);
  Object.assign(WEIGHTS, override);
}

// shadow-dataブランチの data/shadow/ 配下の *.jsonl 一覧を取得する（git ls-tree、読み取り専用）。
function listShadowFiles() {
  const out = execFileSync('git', ['ls-tree', '-r', '--name-only', 'shadow-data', '--', 'data/shadow'], {
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^data\/shadow\/\d{6}\.jsonl$/.test(l));
}

// shadow-dataブランチの指定パスの内容を取得する（git show、作業ツリー非破壊）。
function showFile(gitPath) {
  return execFileSync('git', ['show', `shadow-data:${gitPath}`], { encoding: 'utf8' });
}

function loadShadowRecords() {
  const files = listShadowFiles();
  const records = [];
  for (const fp of files) {
    const text = showFile(fp);
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let rec;
      try {
        rec = JSON.parse(t);
      } catch {
        continue;
      }
      records.push(rec);
    }
  }
  return records;
}

// scripts/shadow_crawl.mjs の programBoatToInput / applyExhibition と同一形式の entries を
// predictRace の入力形式に変換する（replay/run.mjs の toPredictionInput と同じ考え方）。
function toPredictionInput(entries) {
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

function evaluate(records, tierFilter = null) {
  let races_n = 0;
  let excludedInvalidFinish = 0;
  let hit_n = 0;
  let stake = 0;
  let ret = 0;
  let retKnownRaces = 0; // 配当額が既知（recordedのhit_betsと一致）だったレース数
  let stakeKnown = 0; // 配当額が既知だったレースの投資額合計（回収率参考値の分母）
  // WEIGHTS_OVERRIDE未指定時、再計算した買い目が記録済みbetsと食い違う件数。
  // 0でないなら、そのレースのentriesが予想時点の実際の入力値と一致していない疑いがある
  // （バックフィル時点でOpenAPIアーカイブ側の統計値が事後更新されていた可能性）。
  let entriesDrift = 0;

  for (const r of records) {
    if (r.no_toda) continue; // 非開催センチネル
    if (!r.exhibition_ready) continue; // entries不完全でpredictRace対象外
    if (!Array.isArray(r.entries) || r.entries.length !== 6) continue; // entries欠損（旧レコード）

    const input = toPredictionInput(r.entries);
    const { bets, tier } = predictRace(input);
    if (!process.env.WEIGHTS_OVERRIDE && Array.isArray(r.bets) && JSON.stringify(bets) !== JSON.stringify(r.bets)) {
      entriesDrift++;
    }
    if (tierFilter && tier !== tierFilter) continue;

    const finishValid = Array.isArray(r.finish) && r.finish.length === 3 && r.finish.every((x) => Number.isInteger(x));
    if (!finishValid) {
      excludedInvalidFinish++;
      continue; // DNS/失格等で3連単が成立しないレースは的中判定不能なため除外
    }

    races_n++;
    const raceStake = bets.length * 100;
    stake += raceStake;
    const finishStr = r.finish.join('-');
    const hit = bets.includes(finishStr);
    if (hit) {
      hit_n++;
      // 配当額はshadow logに記録された「実際に張った買い目」の払戻のみ既知。
      // 再計算後の買い目が元の買い目(hit_bets)と同じ組み合わせで的中した場合のみ、
      // 同一の払戻額(r.payout)を参考値として計上できる（組み合わせが同じ=同じ払戻）。
      if (Array.isArray(r.hit_bets) && r.hit_bets.includes(finishStr) && typeof r.payout === 'number') {
        ret += r.payout;
        retKnownRaces++;
        stakeKnown += raceStake;
      }
    } else {
      // 外れレースは payout=0 が確実に既知（配当表がなくても外れは外れ）。
      retKnownRaces++;
      stakeKnown += raceStake;
    }
  }

  return {
    races_n,
    excludedInvalidFinish,
    hit_n,
    hitRate: races_n === 0 ? null : (hit_n / races_n) * 100,
    stake,
    ret,
    retKnownRaces,
    stakeKnown,
    entriesDrift,
    // 回収率は「配当額が判明しているレースのみ」を分母にした参考値。
    returnRateKnownOnly: stakeKnown === 0 ? null : (ret / stakeKnown) * 100,
  };
}

function fmtPct(v) {
  return v == null ? 'N/A' : v.toFixed(2) + '%';
}

async function main() {
  const records = loadShadowRecords();
  const overall = evaluate(records);

  console.log('overall:', overall);

  let md = '';
  md += '# shadow logリプレイ結果 (replay/run_shadow.mjs)\n\n';
  md += `対象: shadow-dataブランチ data/shadow/*.jsonl 全${records.length}行（git showで読み取り専用取得、masterへのマージ・ブランチ切替は行っていない）。\n\n`;
  md += 'no_toda(非開催センチネル)行・exhibition_ready:false(entries不完全)行・entries欠損の旧レコードは除外した。\n\n';
  md += '的中判定: shadow log記録時点の係数(v0.3.2)ではなく、logic/toda_logic.mjs の現行WEIGHTS（WEIGHTS_OVERRIDE指定時は上書き後）で predictRace を再計算し、実際の finish（1〜3着艇番）と3連単の組み合わせが一致するかで独自に判定している。DNS/失格等でfinishが3着まで確定していないレースは的中判定不能として除外した。\n\n';
  md += '払戻額（円）は shadow logに個々の組み合わせの配当表が保存されていないため、再計算後の買い目がshadow log記録時の実際の買い目(hit_bets)と同一の組み合わせで的中した場合の払戻額(payout)のみ参考値として合算できる。それ以外の的中（係数変更により新たに的中扱いとなった組み合わせ等）は配当額不明のため回収額に含めない。従って回収率は「的中率ほど信頼できない参考値」であり、的中率を主指標として扱うこと。\n\n';

  md += '## 全体成績\n\n';
  md += '| レース数 | finish不確定除外 | 的中数 | 的中率 | 投資額(判明分) | 回収額(判明分) | 回収率(参考値) | 配当判明レース数 |\n|---|---|---|---|---|---|---|---|\n';
  md += `| ${overall.races_n} | ${overall.excludedInvalidFinish} | ${overall.hit_n} | ${fmtPct(overall.hitRate)} | ${overall.stakeKnown} | ${overall.ret} | ${fmtPct(overall.returnRateKnownOnly)} | ${overall.retKnownRaces}/${overall.races_n} |\n\n`;

  md += '## ティア別成績（自信度: A/B/C）\n\n';
  md += '| ティア | レース数 | finish不確定除外 | 的中数 | 的中率 | 投資額(判明分) | 回収額(判明分) | 回収率(参考値) | 配当判明レース数 |\n|---|---|---|---|---|---|---|---|---|\n';
  const tiers = ['A', 'B', 'C'];
  const tierResults = {};
  for (const t of tiers) {
    const r = evaluate(records, t);
    tierResults[t] = r;
    md += `| ${t} | ${r.races_n} | ${r.excludedInvalidFinish} | ${r.hit_n} | ${fmtPct(r.hitRate)} | ${r.stakeKnown} | ${r.ret} | ${fmtPct(r.returnRateKnownOnly)} | ${r.retKnownRaces}/${r.races_n} |\n`;
  }
  md += '\n';

  md += '## 正直な評価\n\n';
  md += `全体的中率 ${fmtPct(overall.hitRate)}（n=${overall.races_n}）。回収額は配当判明分(${overall.retKnownRaces}レース)のみの参考値であり、正式な回収率算出には払戻表の全件保有が必要（未対応）。\n\n`;
  if (overall.entriesDrift > 0) {
    md += `**要注意**: 現行WEIGHTSのまま再計算した買い目が、記録済みbetsと一致しないレースが${overall.entriesDrift}件ありました。entriesが予想時点の実際の入力値と異なる（バックフィル時点でアーカイブ側の統計値が事後更新されていた等）疑いがあり、該当レースは係数比較の参考程度に留めること。\n\n`;
  }
  if (process.env.WEIGHTS_OVERRIDE) {
    md += `WEIGHTS_OVERRIDE適用中: ${process.env.WEIGHTS_OVERRIDE}\n`;
  } else {
    md += 'WEIGHTS_OVERRIDE未指定（logic/toda_logic.mjs の既定WEIGHTSで計測）。\n';
  }

  await writeFile(OUT_PATH, md, 'utf8');
  console.log(`wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
