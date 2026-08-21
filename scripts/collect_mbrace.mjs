#!/usr/bin/env node
// P1: mbrace.or.jp K/B ファイル収集スクリプト
// 対象: 2025-07-01〜2026-07-10 の毎日、競走成績(K)と番組表(B)
// 憲章厳守: 各リクエスト間2000ms待機、並列禁止

import { mkdir, access, writeFile } from 'node:fs/promises';
import { constants as FS_CONST } from 'node:fs';
import path from 'node:path';

const START_DATE = '2025-07-01';
const END_DATE = '2026-07-10';
const WAIT_MS = 2000;
const RAW_DIR = path.resolve('data/raw');

function* dateRange(startStr, endStr) {
  const start = new Date(startStr + 'T00:00:00Z');
  const end = new Date(endStr + 'T00:00:00Z');
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    yield d;
  }
}

function fmtYYMMDD(d) {
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

function fmtYYYYMM(d) {
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}${mm}`;
}

async function fileExists(p) {
  try {
    await access(p, FS_CONST.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadOne(url, destPath) {
  if (await fileExists(destPath)) {
    return { status: 'skipped' };
  }
  let res;
  try {
    res = await fetch(url, { redirect: 'follow' });
  } catch (err) {
    return { status: 'error', detail: String(err) };
  }
  if (!res.ok) {
    return { status: 'http_error', code: res.status };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
  return { status: 'ok', bytes: buf.length };
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });

  const targets = [];
  for (const d of dateRange(START_DATE, END_DATE)) {
    const yymmdd = fmtYYMMDD(d);
    const yyyymm = fmtYYYYMM(d);
    targets.push({
      kind: 'K',
      url: `https://www1.mbrace.or.jp/od2/K/${yyyymm}/k${yymmdd}.lzh`,
      dest: path.join(RAW_DIR, `k${yymmdd}.lzh`),
    });
    targets.push({
      kind: 'B',
      url: `https://www1.mbrace.or.jp/od2/B/${yyyymm}/b${yymmdd}.lzh`,
      dest: path.join(RAW_DIR, `b${yymmdd}.lzh`),
    });
  }

  console.log(`収集対象: ${targets.length}件 (${START_DATE}〜${END_DATE})`);

  const summary = { ok: 0, skipped: 0, http_error: 0, error: 0 };
  const failures = [];
  let processed = 0;

  for (const t of targets) {
    const result = await downloadOne(t.url, t.dest);
    summary[result.status] = (summary[result.status] ?? 0) + 1;
    if (result.status === 'http_error' || result.status === 'error') {
      failures.push({ url: t.url, ...result });
    }
    processed += 1;
    if (processed % 50 === 0) {
      console.log(
        `進捗 ${processed}/${targets.length} ok=${summary.ok} skipped=${summary.skipped} http_error=${summary.http_error} error=${summary.error}`
      );
    }
    // ダウンロードを実行した場合のみウェイト（スキップ時は待たない）
    if (result.status === 'ok' || result.status === 'http_error' || result.status === 'error') {
      await sleep(WAIT_MS);
    }
  }

  console.log('=== 収集完了 ===');
  console.log(`成功: ${summary.ok}`);
  console.log(`スキップ(既存): ${summary.skipped}`);
  console.log(`HTTPエラー: ${summary.http_error}`);
  console.log(`その他エラー: ${summary.error}`);

  if (failures.length > 0) {
    const logPath = path.resolve('data/collect_failures.log');
    const lines = failures.map((f) => `${f.status} ${f.code ?? ''} ${f.url} ${f.detail ?? ''}`);
    await writeFile(logPath, lines.join('\n') + '\n');
    console.log(`失敗詳細を記録: ${logPath}`);
  }
}

main().catch((err) => {
  console.error('致命的エラー:', err);
  process.exit(1);
});
