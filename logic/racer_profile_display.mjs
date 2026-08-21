// 選手名鑑の表示専用フォーマッタ。data/fixtures/racer_profiles.json の集計結果を
// 「戸田24走 1着33% / 3コース時 2連率50% 3連率67% / 平均ST .16 / F1(戸田実績)」の形式に整形する。
// predictRace・買い目ロジックには一切関与しない。

/**
 * 表示に使う「想定コース」を決める。previewsの実進入コースが取れればそれ、
 * 無ければ艇番をフォールバックとして使う。
 */
export function pickAssumedCourse(boatNumber, previewCourseNumber) {
  return typeof previewCourseNumber === 'number' ? previewCourseNumber : boatNumber;
}

export function fmtPct(v) {
  return v == null ? '-' : Math.round(v) + '%';
}

export function fmtSt(v) {
  if (v == null) return 'なし';
  var neg = v < 0;
  var abs = Math.abs(v).toFixed(2);
  var trimmed = abs.replace(/^0/, '');
  return (neg ? '-' : '') + trimmed;
}

/**
 * @param {object|null} profile racer_profiles.json の1エントリ（未取得ならnull）
 * @param {number} assumedCourse pickAssumedCourse() の結果
 * @param {number} courseSparseThreshold コース別成績を「僅少」扱いにする走数の閾値（デフォルト3未満）
 * @returns {string}
 */
export function formatRacerLine(profile, assumedCourse, courseSparseThreshold) {
  courseSparseThreshold = courseSparseThreshold == null ? 3 : courseSparseThreshold;
  if (!profile || !profile.starts || profile.starts === 0) {
    return '戸田初参戦(直近1年)';
  }
  var parts = [];
  parts.push('戸田' + profile.starts + '走 1着' + fmtPct(profile.win1Pct));

  var cs = profile.byCourse && profile.byCourse[String(assumedCourse)];
  if (cs && cs.starts >= courseSparseThreshold) {
    parts.push(assumedCourse + 'コース時 2連率' + fmtPct(cs.top2Pct) + ' 3連率' + fmtPct(cs.top3Pct));
  } else {
    parts.push(assumedCourse + 'コース時 データ僅少' + (cs ? '(' + cs.starts + '走)' : '(0走)'));
  }

  parts.push('平均ST ' + fmtSt(profile.avgSt));
  parts.push('F' + profile.fCount + '(戸田実績)');

  return parts.join(' / ');
}
