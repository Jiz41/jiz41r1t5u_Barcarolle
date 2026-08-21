// 風×コース補正の事前計測（keirin-coeff-change同様の手順）。
// trainのみで(k1,k2)の粗グリッドサーチを行い、現行(k1=0,k2=0相当)を上回る組み合わせが
// あるかを確認する。trainで現行を上回った最良構成のみ、testで一度だけ計測する。
// 出力は標準出力とreplay/results.mdへの追記用テキスト（このスクリプトはresults.mdを
// 直接編集しない。結果を見てから手動で追記する）。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { splitTrainTest } from './lib/common.mjs';
import { predictRace, predictRaceWithWindExperimental } from '../logic/toda_logic.mjs';

const FIXTURES_PATH = path.resolve('data/fixtures/toda_races.json');

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

function evaluateBaseline(races) {
  let races_n = 0, hit_n = 0, stake = 0, ret = 0, excludedSpecial = 0;
  for (const r of races) {
    if (r.entries.length !== 6) continue;
    const trifecta = r.payouts.trifecta;
    const input = toPredictionInput(r.entries);
    const { bets } = predictRace(input);
    if (trifecta.special) { excludedSpecial++; continue; }
    if (!trifecta.comb) continue;
    races_n++;
    stake += bets.length * 100;
    if (bets.includes(trifecta.comb)) { hit_n++; ret += trifecta.amount; }
  }
  return {
    races_n, hit_n,
    hitRate: races_n === 0 ? null : (hit_n / races_n) * 100,
    stake, ret,
    returnRate: stake === 0 ? null : (ret / stake) * 100,
  };
}

function evaluateWithWind(races, k1, k2) {
  let races_n = 0, hit_n = 0, stake = 0, ret = 0, excludedSpecial = 0;
  for (const r of races) {
    if (r.entries.length !== 6) continue;
    const trifecta = r.payouts.trifecta;
    const input = toPredictionInput(r.entries);
    const windSpeed = typeof r.wind_speed === 'number' ? r.wind_speed : null;
    const { bets } = predictRaceWithWindExperimental(input, windSpeed, k1, k2);
    if (trifecta.special) { excludedSpecial++; continue; }
    if (!trifecta.comb) continue;
    races_n++;
    stake += bets.length * 100;
    if (bets.includes(trifecta.comb)) { hit_n++; ret += trifecta.amount; }
  }
  return {
    races_n, hit_n,
    hitRate: races_n === 0 ? null : (hit_n / races_n) * 100,
    stake, ret,
    returnRate: stake === 0 ? null : (ret / stake) * 100,
  };
}

function fmt(r) {
  return `n=${r.races_n} 的中=${r.hit_n} 的中率=${r.hitRate.toFixed(2)}% 回収率=${r.returnRate.toFixed(2)}%`;
}

async function main() {
  const races = JSON.parse(await readFile(FIXTURES_PATH, 'utf8'));
  const { train, test } = splitTrainTest(races);

  console.log('=== train: null/欠損wind_speedの件数確認 ===');
  const nullWindTrain = train.filter((r) => typeof r.wind_speed !== 'number').length;
  console.log(`train ${train.length}件中、wind_speedがnull/欠損: ${nullWindTrain}件（補正0として扱う）`);

  console.log('\n=== 現行(補正なし)ベースライン: train ===');
  const baselineTrain = evaluateBaseline(train);
  console.log(fmt(baselineTrain));

  const candidates = [0, 0.02, 0.05, 0.1];
  const results = [];
  console.log('\n=== 風補正グリッドサーチ (train) ===');
  for (const k1 of candidates) {
    for (const k2 of candidates) {
      const r = evaluateWithWind(train, k1, k2);
      results.push({ k1, k2, ...r });
      console.log(`k1=${k1} k2=${k2}: ${fmt(r)}`);
    }
  }

  // 現行を的中率・回収率の両方で上回る組み合わせのみ候補とする
  const improved = results.filter(
    (r) => r.hitRate >= baselineTrain.hitRate && r.returnRate >= baselineTrain.returnRate && !(r.k1 === 0 && r.k2 === 0)
  );
  improved.sort((a, b) => b.returnRate - a.returnRate);

  console.log('\n=== trainで現行以上だった候補 ===');
  if (improved.length === 0) {
    console.log('該当なし。風補正はtrain時点で不採用。');
    return;
  }
  improved.forEach((r) => console.log(`k1=${r.k1} k2=${r.k2}: ${fmt(r)}`));

  const best = improved[0];
  console.log(`\n=== train最良構成 k1=${best.k1} k2=${best.k2} をtestで一度だけ計測 ===`);
  const baselineTest = evaluateBaseline(test);
  const windTest = evaluateWithWind(test, best.k1, best.k2);
  console.log('現行(test):', fmt(baselineTest));
  console.log(`風補正k1=${best.k1} k2=${best.k2}(test):`, fmt(windTest));

  const adopt = windTest.hitRate >= baselineTest.hitRate && windTest.returnRate >= baselineTest.returnRate;
  console.log(`\n判定: ${adopt ? '採用' : '不採用'}（testの的中率・回収率の両方で現行以上か）`);
}

main();
