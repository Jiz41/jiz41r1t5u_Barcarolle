# jzirtboat 進捗タイムライン（仮称・後日改名予定）

ボートレース戸田限定予想ツール。3連単8点、的中率の現実的な落としどころを探る。
比較目標: 真自在律（的中35.4%/回収78.5%）、RONDE（BOX6=18.5%）を超える数字。

## 憲章（厳守）
- データ取得は公式導線経由・低頻度（ウェイト2秒/件厳守）
- 生データの再配布・転載は永久禁止（公開時は独自指数のみ）
- 規約改定・警告文言を見たら即取得停止

## データ源
- mbrace.or.jp: `od2/K/YYYYMM/kYYMMDD.lzh`(競走成績) / `od2/B/YYYYMM/bYYMMDD.lzh`(番組表)。Shift-JIS固定長、LZH(7z解凍)
- BoatraceOpenAPI: programs/previews/results v3 JSON（UI実運用用）。previews/resultsは2026年春〜のみ
- 戸田=場番号2（公式表記「戸田」「ボートレース戸田」）

## フェーズ計画
- [x] P0 リポジトリ土台（2026-07-11深夜）
- [x] P1 収集: mbrace K+B 直近12ヶ月（2025-07〜2026-07、約730ファイル、~25分）
- [x] P2 パース: 戸田レースのみ抽出→ data/fixtures/toda_races.json（n>1000確保）
- [x] P3 解剖: 戸田係数の抽出（コース別・風・モーター・当地差分等）＋リプレイ台構築
- [x] P4 ロジック確定: スコア式＋3連単8点生成、バックテストで的中率/回収率計測
- [x] P4.5 選別層（自信度ティア）: confidence()追加、train三分位でA/B/C、testでAティアが全買いを上回る改善を確認
- [x] P5 UI: index.html（BoatraceOpenAPI programs/previews を実運用データ源に）v0.1.0
- [x] P6 朝の報告書 docs/report_20260712.md（2026-07-12完了）

## 進捗ログ
### 2026-07-11 深夜
- P0完了。リポジトリ /root/jzirtboat 作成、git init済み
- 規約ゲート通過済み（memory: project_jizairitsu_toda.md 参照）

### 2026-07-11 P1/P2完了
- P1完了。scripts/collect_mbrace.mjs で2025-07-01〜2026-07-10のK/B計750ファイルを収集（ウェイト2秒厳守）。成功750/失敗0。既存k250610含めdata/raw/に751ファイル
- P2完了。scripts/parse_toda.mjs で戸田(場コード02)のみ抽出→ data/fixtures/toda_races.json 生成
  - 戸田開催日数192日、出力レース数 **2304**（>1000達成）、全レース6艇
  - 検証: (a)ランダム3レース(2026-04-06R5/2026-02-02R12/2025-10-09R3)を元テキストと目視突合→着順・払戻・勝率すべて一致
  - (b)trifecta払戻存在比率 100.0%（2303/2304、残1は特払いレースでspecial記録）
  - (c)course分布 均等（各16.7%、course6のみ16.5%＝欠場等でnull23件）
  - パースエラー1件（2025-06-10、Bファイル未収集の既存サンプル日、K単独で処理済み）→ docs/parse_errors.log
- 形式仕様は docs/format_notes.md に記録。**f_count/l_count/avg_stはmbrace K/Bに該当フィールドが存在せず全null**（正直な報告）

### 2026-07-11 P3/P4完了
- P3完了。scripts/anatomy.mjs でtrain(1612レース、先頭70%)のみを対象に解剖 → docs/anatomy.md
  - コース別（艇番ベース）1着率: 1号艇43.9%（全国平均目安55%より低い）、6号艇3.8%。実進入コースベースとの枠なり率92.2%
  - 単変数生死判定: 生存=当地勝率/全国勝率/モーター2連率/ボート2連率/展示タイム順位/級別、死亡=当地-全国勝率差、判定不能=体重（本データソースに体重フィールド自体が存在しないため。パーサー未対応・正直な報告）
  - 風速×1号艇1着率: 0-1m 45.0%→6m+ 38.6%と単調低下、イン受難仮説を支持
- P4完了。scripts/train_search.mjs でtrain専用の重み座標降下グリッドサーチ（目的関数=trio集合一致率）＋買い目型3種比較（train上で最良=上位3艇BOX+rank4フレックス2点、的中率27.92%/回収率73.31%）
  - logic/toda_logic.mjs: 依存ゼロの純粋ESM。predictRace(boats)で6艇入力→スコア・順位・3連単8点を返す。node --check通過、サンプル出力はdocs/anatomy.md準拠の変数のみ使用（course/st/finish/racetimeは不使用、リークなし）
  - replay/run.mjs でtrain/test最終計測: **train 的中27.92%/回収73.31%、test 的中26.63%/回収69.57%**（差は的中1.29pt・回収3.74ptで過学習の明確な兆候なし）。比較目標の真自在律(35.4%/78.5%)には未到達、RONDE(18.5%)は上回った。詳細 replay/results.md
  - 1回のみのtest計測を厳守。再調整なし

### 2026-07-11 P4.5/P5完了
- P4.5完了。logic/toda_logic.mjs に confidence(boats)（(1位スコア-2位スコア)+(上位3艇平均-下位3艇平均)）と tierFromConfidence()を追加、predictRace()の返り値にconfidence/tierを含めた。TIER_THRESHOLDSはtrainのみ（scripts/compute_tier_thresholds.mjsで算出、q33=9.5605…, q67=12.6184…）の三分位、test後の閾値調整はなし
  - replay/run.mjs をtrain/test×A/B/C集計に拡張、replay/results.mjsに「P4.5 選別層」セクション追記
  - **test実測でAティアは全買いを上回った**（的中率34.66% vs 全買い26.63%、回収率83.37% vs 69.57%、対象251レース）。B/Cティアは全買いを下回る局面もあり、単調ではない。詳細 replay/results.md
- P5完了。index.html (v0.1.0) 作成。BoatraceOpenAPI programs/previews v3 をfetch、stadium_number===2(戸田)のみ抽出。previews取得不可時はexhibition=nullとし既存のnull処理でweight0扱いにフォールバック（実データ検証で確認済み）
  - logic/toda_logic.mjsのスコア計算をインライン移植（係数値は完全一致、双方に「値を変える時は両方更新」コメントあり）
  - 検証: (a)node --checkで構文OK (b)fixtures 200レースでインライン版とlogic/版のpredictRace出力が完全一致(mismatches=0) (c)実API当日データ(2026年7月)をprogramBoatToInput/applyExhibitionに通し6艇分のマッピング・スコア計算が動作することを確認 (d)previews未取得ケース(null)でもpredictRaceが動作することを確認
  - **未検証**: ブラウザでの実描画（DOM生成・クリック操作・レスポンシブ表示）は環境上ブラウザが無いため未確認。node上でのロジック単体検証のみ
  - 判明した注意点: 検証時点でprograms/previewsの「today」ラッパーが指す日付が1日ズレていた（programsのtodayは翌日相当、previewsのtodayは当日相当）。extractProgramsForDate/extractPreviewsForDateはtoday/yesterday両方をマージしてから日付一致でフィルタする実装のため、要求日付のレースがどちらのラッパーに入っていても拾える設計にしてあるが、両エンドポイントの更新タイミングが将来的にもズレる可能性はある（第三者APIの挙動のため当方では制御不可）

## 再開手順（トークン切れで停止した場合）
1. このファイルのフェーズ計画のチェック状態を見る
2. 進捗ログ末尾の「次の一手」に従う
3. data/raw/ に収集済みファイル、data/fixtures/ にパース済みJSONがあるか確認してから再収集を判断（再DLしない）

### 次の一手
P6 朝の報告書 docs/report_20260712.md の作成。index.htmlのブラウザ実機（Android）での動作確認も未実施のため、実機確認を先に行うことを推奨。

### 2026-07-12 直前情報ローカル中継サーバー（scripts/serve.mjs）追加
- BoatraceOpenAPI previews（約30分遅れ）では舟券締切に間に合わない懸念に対応。公式直前情報ページ（boatrace.jp beforeinfo）をレース単位・オンデマンドで取得する中継サーバーを追加。
- `scripts/serve.mjs`（Node標準httpのみ、依存ゼロ）: ポート8930で静的配信＋`/api/beforeinfo?date=YYYYMMDD&race=N`。同一(date,race)は10分キャッシュ、異なるレースへの連続アクセスは最低2秒間隔をキュー化で強制。UAは一般ブラウザ相当。
  - 起動手順は README.md に記載（既存python http.serverのkill含む）
- パーサー`parseBeforeInfoHtml()`は2026-07-12（本日・戸田開催中）R1/R2、および非開催日2026-07-02の**実ページ計3回のみ**fetchして構造確認・検証（それ以上のアクセスはしていない）。
  - **確認できたもの**: 6艇分の体重・調整重量・部品交換、水面気象情報（気温/天候/風速/水温/波高）は数値として正しく取得できることを実データで確認。「データがありません。」判定（非開催日）も実データで確認。
  - **確認できなかったもの（正直な報告）**: 展示タイム・チルト・プロペラ交換・スタート展示（進入予想/ST）は、fetchした2レースがいずれも展示走行前の時間帯だったため、構造（セレクタ）は特定できたが**実際の数値取得は未検証**。特に風向きは方角名のテキストが公式ページに存在せず（アイコンclass番号のみ）、方角名は取得不可と判明したため出力しない設計にした。
  - 詳細は docs/format_notes.md「公式直前情報ページ（boatrace.jp beforeinfo）HTML構造メモ」を参照。
- index.html (v0.1.5): レース詳細に「直前情報を取る」ボタンを追加。OpenAPI previewsで既に展示タイムが反映済み（previewApplied）の場合はボタン非表示・不要の旨を表示。押下時は`/api/beforeinfo`を1回叩き、展示タイムが取得できていれば`exhibition`を上書きして`renderDetail()`を再実行（既存の反映パス・寄与表示・買い目ロジックはそのまま再利用、無改変）。中継サーバー未起動・取得失敗・展示前で未公開の場合はエラー/警告メッセージのみ表示し、既存表示は壊れない。
- **未検証**: ブラウザでの実際のボタン押下動作・展示タイム反映後の再描画は環境上ブラウザが無いため未確認。ロジック部分（mergeBeforeInfoExhibition/beforeInfoWindSummary/dateToCompact/beforeInfoApiUrl）はnode単体テストで検証済み（scratchpadに一時テストスクリプト作成、通過確認後に削除）。scripts/serve.mjsのキャッシュ・キュー機構はfetchをモックしたnode単体テストで検証済み（同一キーは再fetch無し、異なるレースへは約2秒間隔）。
