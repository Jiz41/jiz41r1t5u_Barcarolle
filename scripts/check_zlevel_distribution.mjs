// z-score記号化（◎○△✕）の閾値が、fixtures上で極端に偏らないかを確認する。
// 表示専用の記号分布チェック。予想ロジックには関与しない。
import fs from 'node:fs';
import { computeZScoreTable, zLevelSymbol } from '../logic/toda_logic.mjs';

const races = JSON.parse(fs.readFileSync(new URL('../data/fixtures/toda_races.json', import.meta.url)));

const DISPLAY_KEYS = ['loc_win', 'nat_win', 'motor_2r', 'boat_2r', 'exhibition', 'class'];

function toInput(entries) {
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

const thresholdsToCheck = [
  { high: 0.5, low: -0.5 },
  { high: 0.8, low: -0.8 },
  { high: 1.0, low: -1.0 },
];

for (const th of thresholdsToCheck) {
  const counts = { '◎': 0, '○': 0, '△': 0, '✕': 0, '－': 0 };
  let total = 0;
  for (const r of races) {
    if (!Array.isArray(r.entries) || r.entries.length !== 6) continue;
    const table = computeZScoreTable(toInput(r.entries));
    for (const boat of Object.keys(table)) {
      for (const key of DISPLAY_KEYS) {
        const sym = zLevelSymbol(table[boat][key], th);
        counts[sym] += 1;
        total += 1;
      }
    }
  }
  console.log(`\n=== 閾値 ±${th.high} （記号総数 ${total}）===`);
  for (const sym of ['◎', '○', '△', '✕', '－']) {
    const pct = ((counts[sym] / total) * 100).toFixed(1);
    console.log(`  ${sym}: ${counts[sym]} (${pct}%)`);
  }
}
