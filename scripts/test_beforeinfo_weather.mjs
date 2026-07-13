// index.htmlインラインの beforeInfoWindSummary / hasVal を同ロジックで再現し、
// /api/beforeinfo の weather モック（0値・null含む）で表示文字列を単体検証する。
// 表示専用（買い目・スコアには不使用）。index.html側の該当関数と一字一句そろえること。

// ---- index.html インライン移植（表示専用） ----
function hasVal(v) {
  return v !== null && v !== undefined;
}
function beforeInfoWindSummary(weather) {
  if (!weather) return null;
  var parts = [];
  parts.push('天候: ' + (hasVal(weather.weatherLabel) ? weather.weatherLabel : '不明'));
  parts.push('風速: ' + (hasVal(weather.windSpeed) ? weather.windSpeed + 'm' : '不明'));
  parts.push('波高: ' + (hasVal(weather.waveHeight) ? weather.waveHeight + 'cm' : '不明'));
  if (hasVal(weather.waterTemperature)) parts.push('水温: ' + weather.waterTemperature + '°');
  return parts.join(' ／ ');
}
// ---- ここまで移植 ----

let failed = 0;
function assertEq(actual, expected, label) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log((ok ? 'OK  ' : 'NG  ') + label + '\n     got=' + JSON.stringify(actual) + '\n     exp=' + JSON.stringify(expected));
}

// 1. 通常ケース
assertEq(
  beforeInfoWindSummary({ weatherLabel: '曇り', windSpeed: 3, waveHeight: 2, waterTemperature: 28, windDirectionLabel: null }),
  '天候: 曇り ／ 風速: 3m ／ 波高: 2cm ／ 水温: 28°',
  '通常ケース（曇り/3m/2cm/28°）'
);

// 2. windSpeed=0・waveHeight=0（無風・波なしは正常値。消してはいけない）
assertEq(
  beforeInfoWindSummary({ weatherLabel: '晴', windSpeed: 0, waveHeight: 0, waterTemperature: 25 }),
  '天候: 晴 ／ 風速: 0m ／ 波高: 0cm ／ 水温: 25°',
  '0値ケース（無風0m・波高0cm）を消さない'
);

// 3. waterTemperature=0（正常値として表示）
assertEq(
  beforeInfoWindSummary({ weatherLabel: '雪', windSpeed: 5, waveHeight: 4, waterTemperature: 0 }),
  '天候: 雪 ／ 風速: 5m ／ 波高: 4cm ／ 水温: 0°',
  '水温0°を表示（falsyで消さない）'
);

// 4. waterTemperature が null → 水温項目を出さない（不明表記もしない）
assertEq(
  beforeInfoWindSummary({ weatherLabel: '雨', windSpeed: 2, waveHeight: 1, waterTemperature: null }),
  '天候: 雨 ／ 風速: 2m ／ 波高: 1cm',
  '水温null → 水温項目を省略'
);

// 5. windSpeed/waveHeight が null → 「不明」表記
assertEq(
  beforeInfoWindSummary({ weatherLabel: '曇り', windSpeed: null, waveHeight: undefined, waterTemperature: 27 }),
  '天候: 曇り ／ 風速: 不明 ／ 波高: 不明 ／ 水温: 27°',
  'windSpeed=null / waveHeight=undefined → 不明'
);

// 6. weather自体が null → null を返す（wind-info側でフォールバック）
assertEq(beforeInfoWindSummary(null), null, 'weather=null → null');

// 7. weatherLabel が null → 「不明」（方角windDirectionLabelは常時nullで元々出さない）
assertEq(
  beforeInfoWindSummary({ weatherLabel: null, windSpeed: 1, waveHeight: 0, waterTemperature: 20 }),
  '天候: 不明 ／ 風速: 1m ／ 波高: 0cm ／ 水温: 20°',
  'weatherLabel=null → 天候:不明、波高0は表示'
);

console.log(failed === 0 ? '\nALL OK' : '\nNG: ' + failed + '件失敗');
process.exit(failed === 0 ? 0 : 1);
