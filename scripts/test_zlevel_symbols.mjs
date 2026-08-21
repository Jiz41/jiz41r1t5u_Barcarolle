// z-score記号化の対応検証。fixtures 3レース18艇×6変数について、
// 表示記号が zLevelSymbol(z) と、閾値定義（◎:z>=0.8 / ○:0<=z<0.8 / △:-0.8<=z<0 / ✕:z<-0.8 / －:欠損）
// の両方に一致することを機械照合する。
import fs from 'node:fs';
import { computeZScoreTable, zLevelSymbol, Z_LEVEL_THRESHOLDS } from '../logic/toda_logic.mjs';

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

// 独立した参照実装（zLevelSymbolと別ロジックで書き、両者の一致を確認する）
function expectedSymbol(z) {
  const h = Z_LEVEL_THRESHOLDS.high;
  const l = Z_LEVEL_THRESHOLDS.low;
  if (z === null || z === undefined || Number.isNaN(z)) return '－';
  if (z < l) return '✕';
  if (z < 0) return '△';
  if (z < h) return '○';
  return '◎';
}

// 全6変数の記号（◎○△✕）を検証できるよう、6艇かつ全変数が数値/級別文字で揃った
// 完全データのレースを先頭から3件選ぶ。
function isComplete(entries) {
  return entries.every(
    (e) =>
      typeof e.loc_win === 'number' &&
      typeof e.nat_win === 'number' &&
      typeof e.motor_2r === 'number' &&
      typeof e.boat_2r === 'number' &&
      typeof e.exhibition === 'number' &&
      typeof e.class === 'string'
  );
}
const picked = [];
for (const r of races) {
  if (Array.isArray(r.entries) && r.entries.length === 6 && isComplete(r.entries)) {
    picked.push(r);
    if (picked.length >= 3) break;
  }
}

if (picked.length < 3) {
  console.error('6艇揃ったレースが3件未満:', picked.length);
  process.exit(1);
}

let checks = 0;
let failed = 0;
for (const r of picked) {
  const table = computeZScoreTable(toInput(r.entries));
  console.log(`\n${r.date} R${r.race}`);
  for (const boat of Object.keys(table).map(Number).sort((a, b) => a - b)) {
    const parts = [];
    for (const key of DISPLAY_KEYS) {
      const z = table[boat][key];
      const sym = zLevelSymbol(z);
      const exp = expectedSymbol(z);
      checks += 1;
      if (sym !== exp) {
        failed += 1;
        console.log(`  NG boat${boat} ${key}: z=${z} sym=${sym} expected=${exp}`);
      }
      parts.push(key + '=' + (z == null ? 'null' : z.toFixed(2)) + sym);
    }
    console.log('  boat' + boat + ': ' + parts.join(' '));
  }
}

console.log(`\n照合数: ${checks} / 不一致: ${failed}`);
console.log(failed === 0 ? 'ALL OK: 全記号がz値と閾値定義に一致' : 'NG: 不一致あり');
process.exit(failed === 0 ? 0 : 1);
