# 華耀旋臨 自在律:Barcarolle

**TDM BtR** — Turn Dynamics Model, Built to Race

ボートレース戸田専用の予想演算システム（非公式・情報提供のみ）。
統計・係数・条件分岐による演算ロジックで、出走表と直前情報からスコア・ティア判定・買い目を導出する。

## 公開先

- 本番（GitHub Pages）: https://jiz41.github.io/jiz41r1t5u_Barcarolle/
- 成績ページ: https://jiz41.github.io/jiz41r1t5u_Barcarolle/gg_barcarolle.html
- リポジトリ: https://github.com/Jiz41/jiz41r1t5u_Barcarolle

公開mainブランチはスナップショット運用（開発履歴・計測用生データを含まない単一コミット）。ローカルのmasterブランチが開発本流で、公開のたびにmainへ作り直してpushする。

## 特徴

- **戸田専用設計**: 全国最低級の1コース1着率、風速増でのイン沈下など、戸田水面の実測傾向を係数に反映
- **展示ゲート**: 展示タイムが6艇揃うまで予想を表示しない（バックテストは展示込みデータで計測されているため、根拠のない予想を出さない設計）
- **ティア判定**: スコア分布からレースをA/B/Cに選別。閾値は過去データのtrain三分位で固定
- **単一HTML**: index.html ひとつで動作。ロジックの原本は `logic/toda_logic.mjs`（インライン移植版と同一）
- **Bento UI**: レース詳細を2列グリッドで表示。ティア判定マスは発光アニメ、スクロール出現・タップ擬似3D・ダーク/ライト切替つき
- **シャドーログ**: GitHub Actions夜間バッチが毎日戸田の全レースを自動予想・自動精算し、`shadow-data`ブランチに記録し続ける（下記「シャドーログ」節）

## 起動方法

ポート8930で配信する。旧来のPython http.serverが起動している場合は先にkillしてから起動すること（ポート競合のため）。

```bash
# 既存プロセスの停止（python http.server / node serve.mjs のどちらでも）
pkill -f "http.server 8930" 2>/dev/null
pkill -f "scripts/serve.mjs" 2>/dev/null

# 起動
node scripts/serve.mjs
```

`http://localhost:8930/` でindex.htmlが開く。

## 提供内容

- 静的配信: リポジトリ直下のファイル（index.html 等）
- `GET /api/beforeinfo?date=YYYYMMDD&race=N`: 戸田の公式直前情報（展示タイム・チルト・体重・気象等）を1回fetchしてJSON化して返す。
  - 同一(date,race)は10分間キャッシュ。異なるレースへの連続アクセスは最低2秒間隔を強制。
  - パーサーの構造依存箇所は `scripts/serve.mjs` の `parseBeforeInfoHtml()` に分離。壊れた場合は `docs/format_notes.md`「公式直前情報ページ」章のセレクタメモを参照して直す。
  - **GitHub Pages配信時**: ローカル中継が存在しないため、index.htmlは失敗時に外部中継（ar-proxy、`https://ar-proxy.onrender.com/boat/beforeinfo`）へ自動フォールバックする。パーサー・キャッシュ規則は同一ロジックを `ar-proxy` リポジトリの `boat_beforeinfo.js` へ移植済み。無料枠の目覚めで初回応答が遅いことがある。

## シャドーログ

GitHub Actionsが毎日23:30（JST）に戸田の全レースをOpenAPIアーカイブから再構成し、`logic/toda_logic.mjs` の `predictRace` でその場の予想を組み、結果確定後に自動精算する。記録先はシートではなく `shadow-data` ブランチの `data/shadow/YYYYMM.jsonl`（1行1レース、gitで管理）。

- 定義: `.github/workflows/shadow.yml`（cron + `workflow_dispatch`）、`scripts/shadow_crawl.mjs`
- 台帳は実運用開始日（2026-07-11）以降のみを記録する。稼働前の過去データを遡って追加することはしない（バックフィルはcronが止まっていた日の欠測回収専用）
- 成績ページ（`gg_barcarolle.html`）が `shadow-data` の生JSONLを直接fetchして集計・表示する

## データ源

- 出走表・直前情報・結果: [BoatraceOpenAPI](https://github.com/boatraceopenapi/api)（非公式・MIT）に感謝を込めて
- 選手名鑑（`data/fixtures/racer_profiles.json`）: 公式公表データからの自前集計値

計測用の生レースデータ（過去結果の原文写し）はこのリポジトリには含まれない。
データ取得スクリプトは低頻度・公式導線経由を前提に設計されている。取得先の規約・運営に支障を与える利用を禁ずる。

## ディレクトリ

| パス | 内容 |
|---|---|
| `index.html` | 予想UI本体（単一HTML、Bento UI） |
| `gg_barcarolle.html` | 成績ページ（shadow-dataブランチのJSONLを集計表示） |
| `logic/` | 予想演算ロジックの原本（テスト対象） |
| `scripts/` | 配信サーバー・集計・検証・シャドー収集スクリプト（`test_*.mjs` がテスト、`shadow_crawl.mjs` がシャドーログ収集器） |
| `.github/workflows/shadow.yml` | シャドーログの夜間バッチ定義 |
| `replay/` | リプレイ台（係数変更時の事前計測。要ローカル計測データ） |
| `docs/` | 解析メモ・フォーマットノート |

## 免責

本システムは予想の参考情報を提供するのみであり、的中・収支を保証しない。
舟券の購入は自己責任で。データは非公式取得のため欠損・誤りを含みうる。

## License

[MIT](LICENSE)

---

### 開発者コラム: なぜ戸田なのか

このツールを戸田限定で作ったのには、データの都合以上に個人的な思い入れがある。

送迎バスに乗ってぶーんと町中を進むと、忽然とあの堂々たる建て構えが現れる。あの橋を渡る瞬間が、毎回すごくウキウキして楽しい。

そして戸田といえば外せないのが、"しぶき"のモツ煮とオムライス、"レストラン ワールドII"のフワ串。正直、あれを食べるために戸田に行ってると言っても過言ではない。スタート線側にある"ブラジル"のアイスコーヒーをザブザブ飲みながら、声を出して選手を応援する——ボートレース自体の知識が深くない自分でも、それで十二分に楽しめてしまう。

戸田には、そういうアットホームでインタラクティブな現地本来の面白みが詰まっている。このツールを見てくれたあなたにも、よかったら一度、現地へ行ってみてほしい。
