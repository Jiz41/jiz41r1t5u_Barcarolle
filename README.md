# 華耀旋臨 自在律:Barcarolle

**TDM BtR** — Turn Dynamics Model, Built to Race

ボートレース戸田専用の予想演算システム（非公式・情報提供のみ）。
統計・係数・条件分岐による演算ロジックで、出走表と直前情報からスコア・ティア判定・買い目を導出する。

## 特徴

- **戸田専用設計**: 全国最低級の1コース1着率、風速増でのイン沈下など、戸田水面の実測傾向を係数に反映
- **展示ゲート**: 展示タイムが6艇揃うまで予想を表示しない（バックテストは展示込みデータで計測されているため、根拠のない予想を出さない設計）
- **ティア判定**: スコア分布からレースをA/B/Cに選別。閾値は過去データのtrain三分位で固定
- **単一HTML**: index.html ひとつで動作。ロジックの原本は `logic/toda_logic.mjs`（インライン移植版と同一）

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

## データ源

- 出走表・直前情報・結果: [BoatraceOpenAPI](https://boatraceopenapi.github.io/)（非公式・MIT）に感謝を込めて
- 選手名鑑（`data/fixtures/racer_profiles.json`）: 公式公表データからの自前集計値

計測用の生レースデータ（過去結果の原文写し）はこのリポジトリには含まれない。
データ取得スクリプトは低頻度・公式導線経由を前提に設計されている。取得先の規約・運営に支障を与える利用を禁ずる。

## ディレクトリ

| パス | 内容 |
|---|---|
| `index.html` | 予想UI本体（単一HTML） |
| `logic/` | 予想演算ロジックの原本（テスト対象） |
| `scripts/` | 配信サーバー・集計・検証スクリプト（`test_*.mjs` がテスト） |
| `replay/` | リプレイ台（係数変更時の事前計測。要ローカル計測データ） |
| `docs/` | 解析メモ・フォーマットノート |

## 免責

本システムは予想の参考情報を提供するのみであり、的中・収支を保証しない。
舟券の購入は自己責任で。データは非公式取得のため欠損・誤りを含みうる。

## License

[MIT](LICENSE)
