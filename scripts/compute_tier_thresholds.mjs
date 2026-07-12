#!/usr/bin/env node
// P4.5: confidence()の三分位境界をtrain専用データで算出する。
// 出力は標準出力のみ（人が読んでlogic/toda_logic.mjsのTIER_THRESHOLDSに書き写す）。
// testは一切参照しない。

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { splitTrainTest } from './lib/common.mjs';
import { confidence } from '../logic/toda_logic.mjs';

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

function percentile(sortedVals, p) {
  // 線形補間による百分位数（p=0..100）
  const idx = (p / 100) * (sortedVals.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedVals[lo];
  const frac = idx - lo;
  return sortedVals[lo] + (sortedVals[hi] - sortedVals[lo]) * frac;
}

async function main() {
  const races = JSON.parse(await readFile(FIXTURES_PATH, 'utf8'));
  const { train } = splitTrainTest(races);

  const confs = [];
  for (const r of train) {
    if (r.entries.length !== 6) continue;
    const input = toPredictionInput(r.entries);
    confs.push(confidence(input));
  }
  confs.sort((a, b) => a - b);

  const q33 = percentile(confs, 33.33);
  const q67 = percentile(confs, 66.67);

  console.log('train confidence n =', confs.length);
  console.log('min =', confs[0], 'max =', confs[confs.length - 1]);
  console.log('q33 =', q33);
  console.log('q67 =', q67);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
