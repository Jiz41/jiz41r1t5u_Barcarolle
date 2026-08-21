// computeContributions が返す寄与内訳の合計が、predictRace の scores と完全一致することを
// 実fixtureデータで機械照合する（最低3レース）。
import fs from 'node:fs';
import { predictRace, computeContributions } from '../logic/toda_logic.mjs';

const races = JSON.parse(fs.readFileSync(new URL('../data/fixtures/toda_races.json', import.meta.url)));

function entryToInput(e) {
  return {
    boat: e.boat,
    loc_win: e.loc_win,
    nat_win: e.nat_win,
    motor_2r: e.motor_2r,
    boat_2r: e.boat_2r,
    exhibition: e.exhibition,
    class: e.class,
  };
}

function isComplete(inputs) {
  return inputs.every(
    (b) =>
      typeof b.loc_win === 'number' &&
      typeof b.nat_win === 'number' &&
      typeof b.motor_2r === 'number' &&
      typeof b.boat_2r === 'number' &&
      typeof b.exhibition === 'number' &&
      typeof b.class === 'string'
  );
}

const candidates = [];
for (const r of races) {
  if (!Array.isArray(r.entries) || r.entries.length !== 6) continue;
  const inputs = r.entries.map(entryToInput);
  inputs.sort((a, b) => a.boat - b.boat);
  if (inputs.map((b) => b.boat).join(',') !== '1,2,3,4,5,6') continue;
  if (!isComplete(inputs)) continue;
  candidates.push({ date: r.date, race: r.race, inputs });
  if (candidates.length >= 10) break;
}

if (candidates.length < 3) {
  console.error('検証用の完全データレースが3件未満:', candidates.length);
  process.exit(1);
}

let allOk = true;
for (const c of candidates) {
  const pred = predictRace(c.inputs);
  const contrib = computeContributions(c.inputs);
  for (const boat of pred.ranked) {
    const sum = Object.values(contrib[boat]).reduce((s, v) => s + v, 0);
    const score = pred.scores[boat];
    const diff = Math.abs(sum - score);
    const ok = diff < 1e-9;
    if (!ok) allOk = false;
    console.log(
      `${c.date} R${c.race} boat${boat}: score=${score.toFixed(6)} sum(contrib)=${sum.toFixed(6)} diff=${diff.toExponential(2)} 一致=${ok}`
    );
  }
}

console.log(allOk ? '\nALL OK: 全艇で寄与内訳の合計がスコアと完全一致' : '\nNG: 不一致あり');
process.exit(allOk ? 0 : 1);
