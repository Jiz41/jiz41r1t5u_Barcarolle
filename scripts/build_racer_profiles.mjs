// 選手名鑑集計スクリプト。data/fixtures/toda_races.json（戸田競艇場の実績データ）から
// 登番（racer）ごとに戸田実績を集計し、data/fixtures/racer_profiles.json を生成する。
// 表示専用データの集計であり、predictRace 等の予想ロジックには一切関与しない。
//
// フィールドの扱い:
// - finish: 1〜6の数値のほか、S0/S1/S2（出走取消等）・K0/K1（機体変更等）・F（フライング）
//   という文字コードが混在する。出走数（分母）はこれら全てを含む「出走した回数」とし、
//   1着率・2連対率・3連対率の分子は finish が数値の 1/2/3 以内のものだけをカウントする。
// - course: 実際の進入コース（1〜6、まれにnull）。boat（艇番）とは別で、スタート順位変更を
//   反映した「実進入」を表す。コース別成績はこの course で集計する。
// - f_count は本データセットでは全件null（取得不能）のため使用しない。F回数は finish==='F'
//   （フライングによる出走取消）の発生回数を戸田実績から直接カウントする。これは「戸田での
//   通算F回数（本データセットの収録期間内）」であり、OpenAPI programsが返す「当期F数」とは
//   出所が異なる。UI側でその旨を注記すること。
// - avg_st は使わず、st（実測スタートタイミング、数値のみ）の単純平均を戸田平均STとする。
//   st が数値でない（F・欠場等）entryは平均計算から除外する。

import fs from 'node:fs';

const SRC = new URL('../data/fixtures/toda_races.json', import.meta.url);
const OUT = new URL('../data/fixtures/racer_profiles.json', import.meta.url);

const races = JSON.parse(fs.readFileSync(SRC));

const byRacer = new Map();

function ensure(racerId, name) {
  if (!byRacer.has(racerId)) {
    byRacer.set(racerId, {
      racer: racerId,
      name: name || null,
      starts: 0,
      win1: 0,
      top2: 0,
      top3: 0,
      fCount: 0,
      stSum: 0,
      stCount: 0,
      byCourse: new Map(), // course(1-6) -> { starts, top2, top3 }
    });
  }
  return byRacer.get(racerId);
}

for (const race of races) {
  if (!Array.isArray(race.entries)) continue;
  for (const e of race.entries) {
    if (e.racer == null) continue;
    const p = ensure(e.racer, e.name);
    if (e.name && !p.name) p.name = e.name;

    p.starts += 1;
    const finishNum = typeof e.finish === 'number' ? e.finish : null;
    if (finishNum === 1) p.win1 += 1;
    if (finishNum !== null && finishNum <= 2) p.top2 += 1;
    if (finishNum !== null && finishNum <= 3) p.top3 += 1;
    if (e.finish === 'F') p.fCount += 1;

    if (typeof e.st === 'number') {
      p.stSum += e.st;
      p.stCount += 1;
    }

    if (typeof e.course === 'number') {
      if (!p.byCourse.has(e.course)) {
        p.byCourse.set(e.course, { starts: 0, top2: 0, top3: 0 });
      }
      const c = p.byCourse.get(e.course);
      c.starts += 1;
      if (finishNum !== null && finishNum <= 2) c.top2 += 1;
      if (finishNum !== null && finishNum <= 3) c.top3 += 1;
    }
  }
}

function pct(n, d) {
  return d > 0 ? (n / d) * 100 : null;
}

const profiles = {};
for (const [racerId, p] of byRacer.entries()) {
  const courseStats = {};
  for (const [course, c] of p.byCourse.entries()) {
    courseStats[course] = {
      starts: c.starts,
      top2Pct: pct(c.top2, c.starts),
      top3Pct: pct(c.top3, c.starts),
    };
  }
  profiles[racerId] = {
    racer: racerId,
    name: p.name,
    starts: p.starts,
    win1Pct: pct(p.win1, p.starts),
    top2Pct: pct(p.top2, p.starts),
    top3Pct: pct(p.top3, p.starts),
    avgSt: p.stCount > 0 ? p.stSum / p.stCount : null,
    fCount: p.fCount,
    byCourse: courseStats,
  };
}

fs.writeFileSync(OUT, JSON.stringify(profiles));
console.log('選手数:', Object.keys(profiles).length);
console.log('出力先:', OUT.pathname);
