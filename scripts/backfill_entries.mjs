#!/usr/bin/env node
// 一時用途: entries未保持の既存shadowレコードにentriesフィールドのみを後付けする。
// finish/hit_bets/stake/payout/recovery/ranked/bets/tier/confidence等の既存値は一切書き換えない。
// no_toda(センチネル)レコードは対象外。

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TODA_STADIUM = 2;
const BASE = 'https://boatraceopenapi.github.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHADOW_DIR = process.env.SHADOW_DIR
  ? path.resolve(process.env.SHADOW_DIR)
  : path.resolve(__dirname, '..', 'data', 'shadow');

const CLASS_NUMBER_TO_LABEL = { 1: 'A1', 2: 'A2', 3: 'B1', 4: 'B2' };

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

function extractForDate(data, kind, dashDate) {
  let pools = [];
  if (data && Array.isArray(data[kind])) pools = pools.concat(data[kind]);
  if (data && data.today && Array.isArray(data.today[kind])) pools = pools.concat(data.today[kind]);
  if (data && data.yesterday && Array.isArray(data.yesterday[kind])) pools = pools.concat(data.yesterday[kind]);
  return pools.filter((p) => p.date === dashDate && p.stadium_number === TODA_STADIUM);
}

function programBoatToInput(pb) {
  return {
    boat: pb.racer_boat_number,
    loc_win: typeof pb.racer_local_top_1_percent === 'number' ? pb.racer_local_top_1_percent : null,
    nat_win: typeof pb.racer_national_top_1_percent === 'number' ? pb.racer_national_top_1_percent : null,
    motor_2r: typeof pb.racer_assigned_motor_top_2_percent === 'number' ? pb.racer_assigned_motor_top_2_percent : null,
    boat_2r: typeof pb.racer_assigned_boat_top_2_percent === 'number' ? pb.racer_assigned_boat_top_2_percent : null,
    exhibition: null,
    class: Object.prototype.hasOwnProperty.call(CLASS_NUMBER_TO_LABEL, pb.racer_class_number)
      ? CLASS_NUMBER_TO_LABEL[pb.racer_class_number]
      : null,
  };
}

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

async function main() {
  const stats = { updated: 0, alreadyHad: 0, sentinelSkipped: 0, notFoundInArchive: 0 };
  const programsCache = new Map(); // compact -> { programRaces, previewRaces }

  for (const fn of readdirSync(SHADOW_DIR)) {
    if (!/^\d{6}\.jsonl$/.test(fn)) continue;
    const fp = path.join(SHADOW_DIR, fn);
    const text = readFileSync(fp, 'utf8');
    const lines = text.split('\n').filter((l) => l.trim());
    const outLines = [];

    for (const line of lines) {
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        outLines.push(line);
        continue;
      }
      if (!rec || !rec.date) {
        outLines.push(JSON.stringify(rec));
        continue;
      }
      if (rec.no_toda) {
        stats.sentinelSkipped++;
        outLines.push(JSON.stringify(rec));
        continue;
      }
      if (rec.entries) {
        stats.alreadyHad++;
        outLines.push(JSON.stringify(rec));
        continue;
      }

      const compact = rec.date.replace(/-/g, '');
      if (!programsCache.has(compact)) {
        const dash = rec.date;
        const [programsRes, previewsRes] = await Promise.all([
          fetchJson(apiUrl('programs', compact)),
          fetchJson(apiUrl('previews', compact)),
        ]);
        const programRaces = programsRes.ok ? extractForDate(programsRes.data, 'programs', dash) : [];
        const previewRaces = previewsRes.ok ? extractForDate(previewsRes.data, 'previews', dash) : [];
        programsCache.set(compact, { programRaces, previewRaces });
      }
      const { programRaces, previewRaces } = programsCache.get(compact);
      const programRace = programRaces.find((r) => r.number === rec.race);
      if (!programRace) {
        stats.notFoundInArchive++;
        outLines.push(JSON.stringify(rec));
        continue;
      }
      const previewRace = previewRaces.find((r) => r.number === rec.race) || null;
      const inputs = (programRace.boats || []).map(programBoatToInput);
      inputs.sort((a, b) => a.boat - b.boat);
      applyExhibition(inputs, previewRace);

      const updated = { ...rec, entries: inputs };
      stats.updated++;
      outLines.push(JSON.stringify(updated));
    }

    writeFileSync(fp, outLines.join('\n') + '\n');
  }

  console.log('backfill_entries 完了:', JSON.stringify(stats));
}

main().catch((err) => {
  console.error('致命的エラー:', err);
  process.exit(1);
});
