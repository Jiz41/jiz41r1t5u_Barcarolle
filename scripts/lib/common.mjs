// P3/P4共通ユーティリティ: train/test分割・クリーン判定
// data/fixtures/toda_races.json を読み込む3つのスクリプト（anatomy.mjs, train_search.mjs, replay/run.mjs）で
// 分割ロジックが食い違うと係数決定とバックテストの前提がズレるため、ここに一本化する。

export function splitTrainTest(races) {
  const sorted = [...races].sort((a, b) =>
    a.date === b.date ? a.race - b.race : a.date.localeCompare(b.date)
  );
  const trainN = Math.floor(sorted.length * 0.7);
  return {
    train: sorted.slice(0, trainN),
    test: sorted.slice(trainN),
    trainN,
    testN: sorted.length - trainN,
  };
}

export function isCleanRace(r) {
  return (
    r.entries.length === 6 &&
    r.entries.every((e) => Number.isInteger(e.finish) && e.finish >= 1 && e.finish <= 6)
  );
}
