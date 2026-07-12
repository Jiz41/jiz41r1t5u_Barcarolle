// 根拠サマリーの検証。index.htmlインラインの buildBasis を同ロジックで再現し、
// fixtures 3レース18艇について:
//  (a) 根拠行の上位項目（⬆上位2・⬇最大1）が、mjs computeContributions の寄与実順位と一致
//  (b) 数値内訳の各値が寄与値と一致し、合計＝スコア（既存不変条件）
// を機械照合する。表示専用（買い目・スコアには不使用）。
import fs from 'node:fs';
import { predictRace, computeContributions, WEIGHTS } from '../logic/toda_logic.mjs';

const races = JSON.parse(fs.readFileSync(new URL('../data/fixtures/toda_races.json', import.meta.url)));

const VAR_LABELS = {
  course_prior: '艇番', loc_win: '当地', nat_win: '全国',
  motor_2r: 'モーター', boat_2r: 'ボート', exhibition: '展示', class: '級別',
};
const VARIABLE_KEYS = ['course_prior', 'loc_win', 'nat_win', 'motor_2r', 'boat_2r', 'exhibition', 'class'];
const BASIS_FLAT_THRESHOLD = 1.0;

// ---- index.html インライン buildBasis の移植（一字一句そろえること） ----
function buildBasis(contribOfBoat, score) {
  var entries = [];
  VARIABLE_KEYS.forEach(function (key) {
    if (!(WEIGHTS[key] > 0)) return;
    var c = contribOfBoat[key] || 0;
    entries.push({ key: key, label: VAR_LABELS[key] || key, c: c });
  });
  var maxAbs = 0;
  entries.forEach(function (e) { if (Math.abs(e.c) > maxAbs) maxAbs = Math.abs(e.c); });
  var summary;
  if (maxAbs < BASIS_FLAT_THRESHOLD) {
    summary = '突出項目なし（総合力）';
  } else {
    var positives = entries.filter(function (e) { return e.c > 0; }).sort(function (a, b) { return b.c - a.c; });
    var negatives = entries.filter(function (e) { return e.c < 0; }).sort(function (a, b) { return a.c - b.c; });
    var parts = [];
    if (positives.length) parts.push('⬆ ' + positives.slice(0, 2).map(function (e) { return e.label; }).join('・') + 'が押し上げ');
    if (negatives.length) parts.push('⬇ ' + negatives[0].label + 'が重荷');
    summary = parts.join(' ／ ');
  }
  var nonZero = entries.filter(function (e) { return e.c !== 0; }).sort(function (a, b) { return b.c - a.c; });
  var breakdown = nonZero.map(function (e) {
    var sign = e.c >= 0 ? '+' : '-';
    return e.label + ' ' + sign + Math.abs(e.c).toFixed(1);
  }).join(' ／ ') + ' ＝ スコア ' + score.toFixed(1);
  return { summary: summary, breakdown: breakdown };
}
// ---- ここまで移植 ----

function toInput(entries) {
  return entries.map((e) => ({
    boat: e.boat, loc_win: e.loc_win, nat_win: e.nat_win,
    motor_2r: e.motor_2r, boat_2r: e.boat_2r, exhibition: e.exhibition, class: e.class,
  }));
}

// 完全データのレースを3件選ぶ（全変数の寄与が出るように）
function isComplete(entries) {
  return entries.every((e) =>
    typeof e.loc_win === 'number' && typeof e.nat_win === 'number' &&
    typeof e.motor_2r === 'number' && typeof e.boat_2r === 'number' &&
    typeof e.exhibition === 'number' && typeof e.class === 'string');
}
const picked = [];
for (const r of races) {
  if (Array.isArray(r.entries) && r.entries.length === 6 && isComplete(r.entries)) {
    picked.push(r);
    if (picked.length >= 3) break;
  }
}
if (picked.length < 3) { console.error('完全データ3レース未満'); process.exit(1); }

let failed = 0;
let checks = 0;
for (const r of picked) {
  const input = toInput(r.entries);
  const pred = predictRace(input);
  const contrib = computeContributions(input);
  console.log(`\n${r.date} R${r.race}`);
  for (const boat of pred.ranked) {
    const c = contrib[boat];
    const score = pred.scores[boat];
    const basis = buildBasis(c, score);

    // 独立に寄与実順位を算出（weight>0のみ）
    const entries = VARIABLE_KEYS.filter((k) => WEIGHTS[k] > 0).map((k) => ({ key: k, label: VAR_LABELS[k], c: c[k] || 0 }));
    const maxAbs = Math.max(...entries.map((e) => Math.abs(e.c)));
    const posSorted = entries.filter((e) => e.c > 0).sort((a, b) => b.c - a.c);
    const negSorted = entries.filter((e) => e.c < 0).sort((a, b) => a.c - b.c);

    // (a) summaryの上位項目一致検証
    if (maxAbs < BASIS_FLAT_THRESHOLD) {
      checks++;
      if (basis.summary !== '突出項目なし（総合力）') { failed++; console.log(`  NG boat${boat}: 総合力のはずが「${basis.summary}」`); }
    } else {
      const expPos = posSorted.slice(0, 2).map((e) => e.label);
      const expNeg = negSorted.length ? negSorted[0].label : null;
      let exp = [];
      if (expPos.length) exp.push('⬆ ' + expPos.join('・') + 'が押し上げ');
      if (expNeg) exp.push('⬇ ' + expNeg + 'が重荷');
      const expSummary = exp.join(' ／ ');
      checks++;
      if (basis.summary !== expSummary) { failed++; console.log(`  NG boat${boat}: summary不一致\n     got=${basis.summary}\n     exp=${expSummary}`); }
    }

    // (b) 数値内訳の合計＝スコア（0.1丸め誤差の範囲で確認）
    const sumShown = entries.filter((e) => e.c !== 0).reduce((s, e) => s + e.c, 0);
    checks++;
    if (Math.abs(sumShown - score) > 1e-9) { failed++; console.log(`  NG boat${boat}: 寄与合計 ${sumShown} != score ${score}`); }

    console.log(`  boat${boat}(${pred.scores[boat].toFixed(1)}): ${basis.summary}`);
    console.log(`      内訳: ${basis.breakdown}`);
  }
}

console.log(`\n照合数: ${checks} / 不一致: ${failed}`);
console.log(failed === 0 ? 'ALL OK: 根拠の上位項目・合計が寄与実順位/スコアと一致' : 'NG: 不一致あり');
process.exit(failed === 0 ? 0 : 1);
