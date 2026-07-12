#!/usr/bin/env node
// GASレス・シャドーログ収集器。
// BoatraceOpenAPI (programs/previews/results v3) から戸田(stadium_number===2)の全レースを取り、
// logic/toda_logic.mjs の predictRace をそのまま使って予想を再構成し、結果・精算を JSONL で蓄積する。
//
// - 予想入力(programs/previews)のマッピングは index.html の programBoatToInput / applyExhibition と同一。
// - 買い目は predictRace が返す3連単("n-n-n")のみ。精算は results.payouts.trifecta の combination と突き合わせる
//   （replay/run.mjs の trifecta 精算と同一の考え方。predictRace は3連複を生成しないため trio は精算対象外）。
// - START_DATE〜本日(JST)のうち未記録の日/レースを埋める。欠測日は次回実行時に自動バックフィルされる。
// - 出力先は SHADOW_DIR 環境変数で差し替え可能（既定: このファイルから見た ../data/shadow）。

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { predictRace } from '../logic/toda_logic.mjs';

const START_DATE = '20260601'; // YYYYMMDD（この日を含む）
const STAKE_PER_POINT = 100;
const ENGINE_VERSION = 'v0.3.2'; // toda_logic にバージョン輸出が無いため定数で固定
const TODA_STADIUM = 2;
const RACES_PER_DAY = 12; // 戸田は常時12R。全レース記録済みの過去日は完了扱いにする
const BASE = 'https://boatraceopenapi.github.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHADOW_DIR = process.env.SHADOW_DIR
  ? path.resolve(process.env.SHADOW_DIR)
  : path.resolve(__dirname, '..', 'data', 'shadow');

// ---------- 日付ユーティリティ ----------

function todayJstCompact() {
  // デバイスTZに依らずJSTでの YYYYMMDD を返す（sv-SEロケール = YYYY-MM-DD）
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' });
  return fmt.format(new Date()).replace(/-/g, '');
}

function compactToDash(compact) {
  return compact.slice(0, 4) + '-' + compact.slice(4, 6) + '-' + compact.slice(6, 8);
}

function compactToMonth(compact) {
  return compact.slice(0, 6); // YYYYMM
}

// START(含む)〜end(含む)の YYYYMMDD 配列。UTC正午基準で日付を進めTZ境界のズレを避ける。
function enumerateDates(startCompact, endCompact) {
  const toDate = (c) =>
    new Date(Date.UTC(Number(c.slice(0, 4)), Number(c.slice(4, 6)) - 1, Number(c.slice(6, 8)), 12));
  const toCompact = (d) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return '' + y + m + day;
  };
  const out = [];
  let cur = toDate(startCompact);
  const end = toDate(endCompact);
  while (cur.getTime() <= end.getTime()) {
    out.push(toCompact(cur));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return out;
}

// ---------- 取得 ----------

function apiUrl(kind, compact) {
  const year = compact.slice(0, 4);
  return `${BASE}/${kind}/v3/${year}/${compact}.json`;
}

async function fetchJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, status: res.status, data: null };
    const data = await res.json();
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: String(err) };
  }
}

// programs/previews/results いずれも「フラット {kind:[...]}」と
// 「直近日 {today:{kind:[...]}, yesterday:{kind:[...]}}」の両形がある。
// index.html の extractProgramsForDate と同じく両対応で、date一致 かつ 戸田のみ抽出する。
function extractForDate(data, kind, dashDate) {
  let pools = [];
  if (data && Array.isArray(data[kind])) pools = pools.concat(data[kind]);
  if (data && data.today && Array.isArray(data.today[kind])) pools = pools.concat(data.today[kind]);
  if (data && data.yesterday && Array.isArray(data.yesterday[kind])) pools = pools.concat(data.yesterday[kind]);
  return pools.filter((p) => p.date === dashDate && p.stadium_number === TODA_STADIUM);
}

// ---------- マッピング（index.html と同一） ----------

const CLASS_NUMBER_TO_LABEL = { 1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2' };

function programBoatToInput(pb) {
  return {
    boat: pb.racer_boat_number,
    loc_win: typeof pb.racer_local_top_1_percent === 'number' ? pb.racer_local_top_1_percent : null,
    nat_win: typeof pb.racer_national_top_1_percent === 'number' ? pb.racer_national_top_1_percent : null,
    motor_2r: typeof pb.racer_assigned_motor_top_2_percent === 'number' ? pb.racer_assigned_motor_top_2_percent : null,
    boat_2r: typeof pb.racer_assigned_boat_top_2_percent === 'number' ? pb.racer_assigned_boat_top_2_percent : null,
    exhibition: null, // previews が取れたら後で上書き
    class: Object.prototype.hasOwnProperty.call(CLASS_NUMBER_TO_LABEL, pb.racer_class_number)
      ? CLASS_NUMBER_TO_LABEL[pb.racer_class_number]
      : null,
  };
}

// previews.boats はオブジェクト形（キー "0".."5" や "1".."6" のいずれもあり得る）。
// Object.values で走査し racer_boat_number で艇番一致させる（index.html は boats[String(boat)] だが
// 本器はキー体系の差異に頑健にするため値配列で照合する）。
function applyExhibition(inputs, previewRace) {
  if (!previewRace || !previewRace.boats) return false;
  const byBoat = {};
  Object.values(previewRace.boats).forEach((pb) => {
    if (pb && typeof pb.racer_boat_number === 'number') byBoat[pb.racer_boat_number] = pb;
  });
  let applied = false;
  inputs.forEach((inp) => {
    const pb = byBoat[inp.boat];
    if (pb && typeof pb.racer_exhibition_time === 'number') {
      inp.exhibition = pb.racer_exhibition_time;
      applied = true;
    }
  });
  return applied;
}

// ---------- 精算 ----------

// results.boats から着順(1〜3着)の艇番を返す。DNS/失格等で place が 1..3 に無い場合は null。
function extractFinish(resultRace) {
  const finish = [null, null, null];
  if (!resultRace || !Array.isArray(resultRace.boats)) return finish;
  resultRace.boats.forEach((b) => {
    const place = b.racer_place_number;
    if (place >= 1 && place <= 3) finish[place - 1] = b.racer_boat_number;
  });
  return finish;
}

// 3連単の払戻表 combination->amount。特払い/不成立等で trifecta が空配列/欠損の場合は空Map。
function trifectaPayoutMap(resultRace) {
  const map = new Map();
  const arr = resultRace && resultRace.payouts && Array.isArray(resultRace.payouts.trifecta)
    ? resultRace.payouts.trifecta
    : [];
  arr.forEach((p) => {
    if (p && typeof p.combination === 'string' && typeof p.amount === 'number') {
      map.set(p.combination, p.amount);
    }
  });
  return map;
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

// ---------- 既存レコードの読み込み ----------

function loadExisting() {
  const recordedRaceKeys = new Set(); // "YYYYMMDD|race"
  const sentinelDates = new Set(); // 非開催マーカーのある日
  const raceCountByDate = {}; // YYYYMMDD -> 記録済みレース数
  if (!existsSync(SHADOW_DIR)) return { recordedRaceKeys, sentinelDates, raceCountByDate };
  for (const fn of readdirSync(SHADOW_DIR)) {
    if (!/^\d{6}\.jsonl$/.test(fn)) continue;
    const text = readFileSync(path.join(SHADOW_DIR, fn), 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let rec;
      try {
        rec = JSON.parse(t);
      } catch {
        continue;
      }
      if (!rec || !rec.date) continue;
      const compact = rec.date.replace(/-/g, '');
      if (rec.no_toda) {
        sentinelDates.add(compact);
        continue;
      }
      if (rec.race != null) {
        recordedRaceKeys.add(compact + '|' + rec.race);
        raceCountByDate[compact] = (raceCountByDate[compact] || 0) + 1;
      }
    }
  }
  return { recordedRaceKeys, sentinelDates, raceCountByDate };
}

// ---------- レコード生成 ----------

function buildRaceRecord(dash, programRace, previewRace, resultRace, crawledAt) {
  const inputs = (programRace.boats || []).map(programBoatToInput);
  inputs.sort((a, b) => a.boat - b.boat);
  const a1Count = inputs.filter((i) => i.class === 'A1').length;
  applyExhibition(inputs, previewRace);
  const exhibitionReady = inputs.length === 6 && inputs.every((i) => typeof i.exhibition === 'number');

  const base = {
    schema: 1,
    date: dash,
    race: programRace.number,
    title: programRace.title ?? null,
    grade_number: typeof programRace.grade_number === 'number' ? programRace.grade_number : null,
    a1_count: a1Count,
    engine_version: ENGINE_VERSION,
  };

  const finish = extractFinish(resultRace);

  if (!exhibitionReady) {
    return {
      ...base,
      exhibition_ready: false,
      skipped: 'no_exhibition',
      finish,
      crawled_at: crawledAt,
    };
  }

  const { ranked, bets, confidence, tier } = predictRace(inputs);
  const payMap = trifectaPayoutMap(resultRace);
  const hitBets = bets.filter((b) => payMap.has(b));
  const stake = bets.length * STAKE_PER_POINT;
  const payout = hitBets.reduce((s, b) => s + payMap.get(b), 0);
  const recovery = stake > 0 ? round4(payout / stake) : null;

  return {
    ...base,
    exhibition_ready: true,
    tier,
    confidence: round4(confidence),
    ranked,
    bets,
    finish,
    hit_bets: hitBets,
    stake,
    payout,
    recovery,
    crawled_at: crawledAt,
  };
}

// ---------- メイン ----------

async function main() {
  mkdirSync(SHADOW_DIR, { recursive: true });
  const today = todayJstCompact();
  const { recordedRaceKeys, sentinelDates, raceCountByDate } = loadExisting();
  const dates = enumerateDates(START_DATE, today);

  // 月ごとに追記行を貯める
  const pending = {}; // YYYYMM -> [jsonl lines]
  const addLine = (compact, obj) => {
    const month = compactToMonth(compact);
    if (!pending[month]) pending[month] = [];
    pending[month].push(JSON.stringify(obj));
  };

  const stats = { daysFetched: 0, daysSkipped: 0, sentinels: 0, races: 0, skippedRaces: 0 };

  for (const compact of dates) {
    const isToday = compact === today;
    const complete =
      sentinelDates.has(compact) || (raceCountByDate[compact] || 0) >= RACES_PER_DAY;
    if (!isToday && complete) {
      stats.daysSkipped++;
      continue;
    }

    const dash = compactToDash(compact);
    const crawledAt = new Date().toISOString();

    const programsRes = await fetchJson(apiUrl('programs', compact));
    const programRaces = programsRes.ok ? extractForDate(programsRes.data, 'programs', dash) : [];

    if (programRaces.length === 0) {
      // 戸田非開催 or 未アーカイブ。過去日はセンチネルで確定させ再取得を防ぐ（本日は未確定なので残す）。
      if (!isToday) {
        addLine(compact, { schema: 1, date: dash, no_toda: true, crawled_at: crawledAt });
        sentinelDates.add(compact);
        stats.sentinels++;
      }
      continue;
    }

    stats.daysFetched++;
    const previewsRes = await fetchJson(apiUrl('previews', compact));
    const resultsRes = await fetchJson(apiUrl('results', compact));
    const previewRaces = previewsRes.ok ? extractForDate(previewsRes.data, 'previews', dash) : [];
    const resultRaces = resultsRes.ok ? extractForDate(resultsRes.data, 'results', dash) : [];

    for (const programRace of programRaces) {
      const raceNo = programRace.number;
      const key = compact + '|' + raceNo;
      if (recordedRaceKeys.has(key)) continue;

      const resultRace = resultRaces.find((r) => r.number === raceNo);
      if (!resultRace) continue; // 未確定（未発走）。次回以降にバックフィル。

      const previewRace = previewRaces.find((r) => r.number === raceNo) || null;
      const rec = buildRaceRecord(dash, programRace, previewRace, resultRace, crawledAt);
      addLine(compact, rec);
      recordedRaceKeys.add(key);
      raceCountByDate[compact] = (raceCountByDate[compact] || 0) + 1;
      if (rec.exhibition_ready) stats.races++;
      else stats.skippedRaces++;
    }
  }

  // 追記（既存内容の末尾に足す。ファイルは date の月で分ける）
  let writtenLines = 0;
  for (const month of Object.keys(pending)) {
    if (pending[month].length === 0) continue;
    const fp = path.join(SHADOW_DIR, month + '.jsonl');
    const prev = existsSync(fp) ? readFileSync(fp, 'utf8') : '';
    const prefix = prev && !prev.endsWith('\n') ? prev + '\n' : prev;
    writeFileSync(fp, prefix + pending[month].join('\n') + '\n');
    writtenLines += pending[month].length;
  }

  console.log('shadow_crawl 完了:', JSON.stringify(stats));
  console.log('新規追記行数:', writtenLines, '/ 出力先:', SHADOW_DIR);
}

main().catch((err) => {
  console.error('致命的エラー:', err);
  process.exit(1);
});
