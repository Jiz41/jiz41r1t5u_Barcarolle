#!/usr/bin/env node
// P2: 戸田(場コード02)限定パーサー
// data/raw/*.lzh (K/B) を解凍→Shift-JIS→UTF-8変換→戸田セクション抽出→統合
// 出力: data/fixtures/toda_races.json / docs/parse_errors.log

import { readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileP = promisify(execFile);

const RAW_DIR = path.resolve('data/raw');
const FIXTURES_DIR = path.resolve('data/fixtures');
const TMP_DIR = path.resolve('data/.parse_tmp');
const ERROR_LOG = path.resolve('docs/parse_errors.log');
const OUT_PATH = path.join(FIXTURES_DIR, 'toda_races.json');

const TODA_CODE = '02';

const PAYOUT_CATEGORIES = {
  '単勝': 'win',
  '２連単': 'exacta',
  '２連複': 'quinella',
  '３連単': 'trifecta',
  '３連複': 'trio',
};

const errors = [];

function logError(date, race, reason) {
  errors.push(`${date} R${race ?? '?'} ${reason}`);
}

async function sh7z(file, outDir) {
  await execFileP('7z', ['x', '-y', file, `-o${outDir}`]);
}

async function toUtf8(sjisPath) {
  const { stdout } = await execFileP('iconv', ['-f', 'SHIFT-JIS', '-t', 'UTF-8', sjisPath], {
    maxBuffer: 1024 * 1024 * 64,
    encoding: 'utf8',
  });
  return stdout;
}

function extractSection(text, code, suffix) {
  const beginMarker = `${code}${suffix}BGN`;
  const endMarker = `${code}${suffix}END`;
  const beginIdx = text.indexOf(beginMarker);
  if (beginIdx === -1) return null;
  const endIdx = text.indexOf(endMarker, beginIdx);
  if (endIdx === -1) return null;
  return text.slice(beginIdx + beginMarker.length, endIdx);
}

function toHalfWidthDigits(s) {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

// ---------- K file parsing ----------

function parseKSection(section, dateStr) {
  const lines = section.split(/\r?\n/);
  const races = [];
  let i = 0;
  const headerRe = /^\s*(\d{1,2})R\s+(.+?)\s+H(\d+)m\s+(\S+)\s+風\s+(\S+)\s+(\d+)m\s+波\s+(\d+)cm/;

  while (i < lines.length) {
    const line = lines[i];
    const m = headerRe.exec(line);
    if (!m) {
      i += 1;
      continue;
    }
    const raceNum = parseInt(m[1], 10);
    const title = m[2].trim();
    const distance = parseInt(m[3], 10);
    const weather = m[4].trim();
    const windDir = m[5].trim();
    const windSpeed = parseInt(m[6], 10);
    const wave = parseInt(m[7], 10);

    // decision: 次の行（着 艇 登番...ﾚｰｽﾀｲﾑ XXX）末尾
    const colHeaderLine = lines[i + 1] ?? '';
    const decMatch = /ﾚｰｽﾀｲﾑ\s*(\S*)/.exec(colHeaderLine);
    const decision = decMatch && decMatch[1] ? decMatch[1] : null;

    // 区切り線の次から結果行
    let j = i + 3;
    const entries = [];
    while (j < lines.length) {
      const rl = lines[j];
      if (rl.trim() === '') break;
      if (rl.length < 47) break; // 結果行でない
      const finishRaw = rl.slice(0, 4).trim();
      const boatRaw = rl.slice(4, 7).trim();
      const racerRaw = rl.slice(7, 13).trim();
      const nameRaw = rl.slice(13, 21).replace(/　+/g, ' ').trim();
      const motorRaw = rl.slice(21, 25).trim();
      const boatIdRaw = rl.slice(25, 29).trim();
      const exhRaw = rl.slice(29, 36).trim();
      const courseRaw = rl.slice(36, 39).trim();
      const stRaw = rl.slice(39, 47).trim();
      const rtRaw = rl.slice(47, 58).trim();

      if (!boatRaw || !/^\d$/.test(boatRaw)) {
        j += 1;
        continue;
      }

      let finish;
      if (/^\d+$/.test(finishRaw)) {
        finish = parseInt(finishRaw, 10);
      } else if (finishRaw === '') {
        finish = null;
      } else {
        finish = finishRaw;
      }

      entries.push({
        boat: parseInt(boatRaw, 10),
        racer: racerRaw ? parseInt(racerRaw, 10) : null,
        name: nameRaw,
        motor: /^\d+$/.test(motorRaw) ? parseInt(motorRaw, 10) : null,
        boat_id: /^\d+$/.test(boatIdRaw) ? parseInt(boatIdRaw, 10) : null,
        exhibition: /^[\d.]+$/.test(exhRaw) && exhRaw !== '' ? parseFloat(exhRaw) : null,
        course: /^\d$/.test(courseRaw) ? parseInt(courseRaw, 10) : null,
        st: (() => {
          const stClean = stRaw.replace(/^F/, '');
          return /^[\d.]+$/.test(stClean) && stClean !== '' ? parseFloat(stClean) : null;
        })(),
        finish,
      });
      j += 1;
    }

    if (entries.length === 0) {
      logError(dateStr, raceNum, 'K: 着順行が0件（パース失敗）');
    }

    // 払戻行探索（空行の後、次のレースヘッダまで）
    const payouts = {};
    let k = j;
    while (k < lines.length) {
      const pl = lines[k];
      if (headerRe.test(pl)) break; // 次のレースに到達
      const trimmed = pl.trim();
      if (trimmed === '') {
        k += 1;
        continue;
      }
      const tokens = trimmed.split(/\s+/);
      const catKey = tokens[0];
      if (PAYOUT_CATEGORIES[catKey]) {
        const field = PAYOUT_CATEGORIES[catKey];
        if (tokens[1] === '特払い') {
          const amt = tokens[2] ? parseInt(tokens[2].replace(/,/g, ''), 10) : null;
          payouts[field] = { comb: null, amount: Number.isFinite(amt) ? amt : null, special: 'tokubarai' };
        } else if (tokens[1] === '不成立') {
          payouts[field] = { comb: null, amount: null, special: 'fusei_ritsu' };
        } else {
          const comb = tokens[1] ?? null;
          const amt = tokens[2] ? parseInt(tokens[2].replace(/,/g, ''), 10) : null;
          payouts[field] = { comb, amount: Number.isFinite(amt) ? amt : null, special: null };
        }
      }
      k += 1;
      // 2連続空行 or 次レース見出しに到達したら終了想定。上限として60行で打ち切り
      if (k - j > 60) break;
    }

    for (const field of Object.values(PAYOUT_CATEGORIES)) {
      if (!payouts[field]) {
        logError(dateStr, raceNum, `K: 払戻[${field}]が見つからない`);
        payouts[field] = { comb: null, amount: null, special: null };
      }
    }

    races.push({
      race: raceNum,
      title,
      distance,
      weather,
      wind_dir: windDir,
      wind_speed: windSpeed,
      wave,
      decision,
      entries,
      payouts,
    });

    i = k;
  }

  return races;
}

// ---------- B file parsing ----------

function parseBSection(section) {
  const lines = section.split(/\r?\n/);
  const raceMap = new Map(); // raceNum -> Map(boat -> stats)
  const headerRe = /^\s*(\d{1,2})Ｒ/; // 全角数字＋全角Ｒ

  for (let i = 0; i < lines.length; i += 1) {
    const line = toHalfWidthDigits(lines[i]);
    const m = /^\s*(\d{1,2})[RＲ]/.exec(line);
    if (!m) continue;
    const raceNum = parseInt(m[1], 10);

    // 区切り線+ヘッダ2行+区切り線をスキップし、艇データ行(最大6行)を読む
    let j = i + 5;
    const boatMap = new Map();
    let count = 0;
    while (j < lines.length && count < 6) {
      const rl = lines[j];
      if (rl.length < 58) break;
      const boatRaw = rl.slice(0, 1).trim();
      if (!/^\d$/.test(boatRaw)) break;
      const racerRaw = rl.slice(2, 6).trim();
      const nameRaw = rl.slice(6, 10).trim();
      const ageRaw = rl.slice(10, 12).trim();
      const branchRaw = rl.slice(12, 14).trim();
      const wcRaw = rl.slice(14, 18).trim();
      const natWinRaw = rl.slice(19, 23).trim();
      const natTwoRaw = rl.slice(24, 29).trim();
      const locWinRaw = rl.slice(30, 34).trim();
      const locTwoRaw = rl.slice(35, 40).trim();
      const motorRaw = rl.slice(41, 43).trim();
      const motorTwoRaw = rl.slice(44, 49).trim();
      const boatNoRaw = rl.slice(50, 52).trim();
      const boatTwoRaw = rl.slice(53, 58).trim();

      const classMatch = /([A-B][12])$/.exec(wcRaw);

      boatMap.set(parseInt(boatRaw, 10), {
        racer: racerRaw ? parseInt(racerRaw, 10) : null,
        name: nameRaw,
        age: /^\d+$/.test(ageRaw) ? parseInt(ageRaw, 10) : null,
        branch: branchRaw || null,
        class: classMatch ? classMatch[1] : null,
        nat_win: /^[\d.]+$/.test(natWinRaw) && natWinRaw !== '' ? parseFloat(natWinRaw) : null,
        nat_2r: /^[\d.]+$/.test(natTwoRaw) && natTwoRaw !== '' ? parseFloat(natTwoRaw) : null,
        loc_win: /^[\d.]+$/.test(locWinRaw) && locWinRaw !== '' ? parseFloat(locWinRaw) : null,
        loc_2r: /^[\d.]+$/.test(locTwoRaw) && locTwoRaw !== '' ? parseFloat(locTwoRaw) : null,
        motor: /^\d+$/.test(motorRaw) ? parseInt(motorRaw, 10) : null,
        motor_2r: /^[\d.]+$/.test(motorTwoRaw) && motorTwoRaw !== '' ? parseFloat(motorTwoRaw) : null,
        boat_id: /^\d+$/.test(boatNoRaw) ? parseInt(boatNoRaw, 10) : null,
        boat_2r: /^[\d.]+$/.test(boatTwoRaw) && boatTwoRaw !== '' ? parseFloat(boatTwoRaw) : null,
      });
      j += 1;
      count += 1;
    }
    raceMap.set(raceNum, boatMap);
  }

  return raceMap;
}

// ---------- 統合 ----------

function mergeRace(dateStr, kRace, bBoatMap) {
  const entries = kRace.entries.map((e) => {
    const b = bBoatMap ? bBoatMap.get(e.boat) : null;
    if (!bBoatMap) {
      // B自体が無い日 or 戸田セクションが無い（軽微、エラーログには残さない）
    } else if (!b) {
      logError(dateStr, kRace.race, `B: 艇${e.boat}の番組表データなし`);
    }
    return {
      boat: e.boat,
      racer: e.racer ?? b?.racer ?? null,
      name: b?.name || e.name,
      class: b?.class ?? null,
      age: b?.age ?? null,
      branch: b?.branch ?? null,
      nat_win: b?.nat_win ?? null,
      nat_2r: b?.nat_2r ?? null,
      loc_win: b?.loc_win ?? null,
      loc_2r: b?.loc_2r ?? null,
      motor: e.motor,
      motor_2r: b?.motor_2r ?? null,
      boat_id: e.boat_id,
      boat_2r: b?.boat_2r ?? null,
      f_count: null,
      l_count: null,
      avg_st: null,
      exhibition: e.exhibition,
      course: e.course,
      st: e.st,
      finish: e.finish,
    };
  });

  return {
    date: dateStr,
    race: kRace.race,
    weather: kRace.weather,
    wind_dir: kRace.wind_dir,
    wind_speed: kRace.wind_speed,
    wave: kRace.wave,
    title: kRace.title,
    distance: kRace.distance,
    decision: kRace.decision,
    entries,
    payouts: kRace.payouts,
  };
}

// ---------- メイン処理 ----------

function dateFromFilename(name) {
  // kYYMMDD.lzh / bYYMMDD.lzh
  const m = /^[kb](\d{2})(\d{2})(\d{2})\.lzh$/.exec(name);
  if (!m) return null;
  const yy = parseInt(m[1], 10);
  const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
  return `${yyyy}-${m[2]}-${m[3]}`;
}

async function main() {
  await mkdir(FIXTURES_DIR, { recursive: true });
  await mkdir(TMP_DIR, { recursive: true });

  const files = await readdir(RAW_DIR);
  const kFiles = files.filter((f) => /^k\d{6}\.lzh$/.test(f)).sort();

  const allRaces = [];
  let processedDates = 0;
  let todaDaysFound = 0;

  for (const kFile of kFiles) {
    const yymmdd = kFile.slice(1, 7);
    const bFile = `b${yymmdd}.lzh`;
    const dateStr = dateFromFilename(kFile);
    processedDates += 1;

    // K展開
    let kText;
    try {
      const kExtractDir = path.join(TMP_DIR, `k${yymmdd}`);
      await mkdir(kExtractDir, { recursive: true });
      await sh7z(path.join(RAW_DIR, kFile), kExtractDir);
      const extracted = (await readdir(kExtractDir)).find((f) => /\.TXT$/i.test(f));
      if (!extracted) {
        logError(dateStr, null, 'K: 解凍後のTXTが見つからない');
        continue;
      }
      kText = await toUtf8(path.join(kExtractDir, extracted));
      await rm(kExtractDir, { recursive: true, force: true });
    } catch (err) {
      logError(dateStr, null, `K: 解凍/変換失敗 ${String(err)}`);
      continue;
    }

    const kSection = extractSection(kText, TODA_CODE, 'K');
    if (!kSection) {
      // この日は戸田開催なし
      continue;
    }
    todaDaysFound += 1;

    // B展開（あれば）
    let bBoatMapByRace = new Map();
    let bAvailable = false;
    try {
      const files2 = await readdir(RAW_DIR);
      if (files2.includes(bFile)) {
        const bExtractDir = path.join(TMP_DIR, `b${yymmdd}`);
        await mkdir(bExtractDir, { recursive: true });
        await sh7z(path.join(RAW_DIR, bFile), bExtractDir);
        const extractedB = (await readdir(bExtractDir)).find((f) => /\.TXT$/i.test(f));
        if (extractedB) {
          const bText = await toUtf8(path.join(bExtractDir, extractedB));
          const bSection = extractSection(bText, TODA_CODE, 'B');
          if (bSection) {
            bBoatMapByRace = parseBSection(bSection);
            bAvailable = true;
          } else {
            logError(dateStr, null, 'B: 戸田セクションが見つからない（Kにはある）');
          }
        }
        await rm(bExtractDir, { recursive: true, force: true });
      } else {
        logError(dateStr, null, 'B: 対応するbファイルが存在しない');
      }
    } catch (err) {
      logError(dateStr, null, `B: 解凍/変換失敗 ${String(err)}`);
    }

    let kRaces;
    try {
      kRaces = parseKSection(kSection, dateStr);
    } catch (err) {
      logError(dateStr, null, `K: セクション解析失敗 ${String(err)}`);
      continue;
    }

    for (const kRace of kRaces) {
      const bBoatMap = bAvailable ? bBoatMapByRace.get(kRace.race) : null;
      try {
        allRaces.push(mergeRace(dateStr, kRace, bBoatMap));
      } catch (err) {
        logError(dateStr, kRace.race, `統合失敗 ${String(err)}`);
      }
    }
  }

  await writeFile(OUT_PATH, JSON.stringify(allRaces, null, 2));
  await writeFile(ERROR_LOG, errors.join('\n') + (errors.length ? '\n' : ''));
  await rm(TMP_DIR, { recursive: true, force: true });

  console.log(`処理日数(Kファイル): ${processedDates}`);
  console.log(`戸田開催日数: ${todaDaysFound}`);
  console.log(`出力レース数: ${allRaces.length}`);
  console.log(`エラー件数: ${errors.length}`);
  console.log(`出力先: ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('致命的エラー:', err);
  process.exit(1);
});
