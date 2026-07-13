// fold_bets.mjs の畳み表記アルゴリズムを、実際のfixtureレースで生成した8点買い目に対して検証する。
// 「畳み結果を再展開すると元の8点と完全一致する」ことを機械照合する。
import fs from 'node:fs';
import { predictRace } from '../logic/toda_logic.mjs';
import { foldBets, verifyFold } from '../logic/fold_bets.mjs';

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
  const boats = inputs.map((b) => b.boat);
  if (boats.join(',') !== '1,2,3,4,5,6') continue;
  if (!isComplete(inputs)) continue;
  candidates.push({ date: r.date, race: r.race, inputs });
  if (candidates.length >= 20) break;
}

if (candidates.length < 5) {
  console.error('検証用の完全データレースが5件未満:', candidates.length);
  process.exit(1);
}

let allOk = true;
const sample = candidates.slice(0, 8);
for (const c of sample) {
  const pred = predictRace(c.inputs);
  const folded = foldBets(pred.bets);
  const ok = verifyFold(pred.bets, folded);
  if (!ok) allOk = false;
  console.log(
    `${c.date} R${c.race}: bets=${pred.bets.length}件 -> groups=${folded.groups
      .map((g) => `${g.label}(${g.count}点)`)
      .join(', ')}${folded.leftover.length ? ' + leftover=' + folded.leftover.join(',') : ''} -> 一致=${ok}`
  );
  if (!ok) {
    console.error('  元buys :', pred.bets.join(' '));
    console.error('  展開後 :', [...folded.groups.flatMap((g) => g.combos), ...folded.leftover].join(' '));
  }
}

console.log(allOk ? '\nALL OK: 全サンプルで畳み展開が元の買い目集合と完全一致' : '\nNG: 不一致あり');
process.exit(allOk ? 0 : 1);
