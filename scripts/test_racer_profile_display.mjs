// racer_profile_display.mjs の単体検証。
import { pickAssumedCourse, fmtPct, fmtSt, formatRacerLine } from '../logic/racer_profile_display.mjs';

let failed = 0;
function assertEq(actual, expected, label) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log((ok ? 'OK  ' : 'NG  ') + label + ': got=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected));
}

assertEq(pickAssumedCourse(3, 5), 5, 'pickAssumedCourse: previewあり');
assertEq(pickAssumedCourse(3, null), 3, 'pickAssumedCourse: previewなし→艇番');
assertEq(pickAssumedCourse(3, undefined), 3, 'pickAssumedCourse: preview未定義→艇番');

assertEq(fmtPct(33.333), '33%', 'fmtPct: 四捨五入');
assertEq(fmtPct(null), '-', 'fmtPct: null');

assertEq(fmtSt(0.16), '.16', 'fmtSt: 0.16');
assertEq(fmtSt(0.135), (0.135).toFixed(2).replace(/^0/, ''), 'fmtSt: toFixed(2)基準の丸め一致');
assertEq(fmtSt(null), 'なし', 'fmtSt: null');
assertEq(fmtSt(-0.05), '-.05', 'fmtSt: 負値');

assertEq(
  formatRacerLine(null, 3),
  '戸田初参戦(直近1年)',
  '戸田初参戦: profile null'
);
assertEq(
  formatRacerLine({ starts: 0, win1Pct: null, avgSt: null, fCount: 0, byCourse: {} }, 3),
  '戸田初参戦(直近1年)',
  '戸田初参戦: starts=0'
);

const richProfile = {
  starts: 34,
  win1Pct: 14.705882352941178,
  avgSt: 0.135,
  fCount: 0,
  byCourse: {
    3: { starts: 3, top2Pct: 66.66666666666666, top3Pct: 100 },
  },
};
assertEq(
  formatRacerLine(richProfile, 3),
  '戸田34走 1着15% / 3コース時 2連率67% 3連率100% / 平均ST ' + fmtSt(0.135) + ' / F0(戸田実績)',
  '通常フォーマット: コース実績十分'
);

const sparseProfile = {
  starts: 10,
  win1Pct: 10,
  avgSt: 0.187,
  fCount: 2,
  byCourse: {
    1: { starts: 1, top2Pct: 0, top3Pct: 0 },
  },
};
assertEq(
  formatRacerLine(sparseProfile, 1),
  '戸田10走 1着10% / 1コース時 データ僅少(1走) / 平均ST .19 / F2(戸田実績)',
  '通常フォーマット: コース実績僅少(1走<3)'
);
assertEq(
  formatRacerLine(sparseProfile, 5),
  '戸田10走 1着10% / 5コース時 データ僅少(0走) / 平均ST .19 / F2(戸田実績)',
  '通常フォーマット: コース実績データなし(0走)'
);

console.log(failed === 0 ? '\nALL OK' : '\nNG: ' + failed + '件失敗');
process.exit(failed === 0 ? 0 : 1);
