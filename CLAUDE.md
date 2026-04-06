# リズム訓練 Web アプリ

## 概要
ドラムリズムの DTM ステップシーケンサと楽譜（VexFlow）を同時表示し、再生ヘッドが同期して走るリズム訓練用 Web アプリ。

## 技術スタック
- **バニラ HTML/CSS/JS**（ビルドツールなし）
- **VexFlow 5.0.0**（CDN: `https://cdn.jsdelivr.net/npm/vexflow@5.0.0/build/cjs/vexflow.js`）
  - グローバル `VexFlow`（`Vex.Flow` ではない）
  - API は camelCase（`stemDirection`, `numBeats` 等。snake_case ではない）
- **Web Audio API**（Chris Wilson "Two Clocks" パターンで lookahead スケジューリング）
- デプロイ先: **GitHub Pages**（静的配信、相対パスで動作）

## ファイル構成
```
リズム/
├── index.html         # HTML骨格、CDN読込、script読込
├── styles.css         # レイアウト・色・区切り線・C4行視覚
└── js/
    ├── pattern.js     # データモデル（定数、3値c4、スイング、プリセット）
    ├── audio.js       # AudioContext・シンセ・スケジューラ（DrumAudio）
    ├── ui-grid.js     # DTMグリッド描画・ドラッグ編集・ヘッドハイライト（UIGrid）
    ├── ui-score.js    # VexFlow譜面描画・C4単線譜・ヘッドオーバーレイ（UIScore）
    ├── train.js       # Train判定ロジック（Train）
    └── app.js         # エントリ・モード切替・描画ループ・アライン
```

## モジュールのグローバル名
`<script>` タグで順番に読むため全モジュールはグローバル。名前衝突に注意。
- `STEPS`, `STEPS_PER_BEAT`, `BEATS_PER_BAR`, `TRACKS`, `TRACK_LABELS` — pattern.js の定数
- `createEmptyPattern()`, `clonePattern()`, `isC4RunStart()`, `c4RunLength()`, `c4Runs()`, `getStepDurations()`, `noteValueName()` — pattern.js の関数
- `PRESETS` — Train用お題パターン辞書
- `DrumAudio` — audio.js（`Audio` は HTMLAudioElement と衝突するので使わない）
- `UIGrid` — ui-grid.js
- `UIScore` — ui-score.js
- `Train` — train.js

## データモデル
### パターン
```js
{ bass: [false × 16], snare: [false × 16], hat: [false × 16], c4: [0 × 16] }
```
- bass/snare/hat: boolean（on/off）
- c4: 3値（0=off, 1=hit=新しい音の開始, 2=hold=前の音の継続）

### スイング
```js
{ type: 'straight'|'eighth'|'sixteenth', ratio: 0.5〜0.75 }
```
`getStepDurations(swing)` が 16 要素の相対長さ配列を返す。

## 2 モード
- **Edit**: グリッドクリック/ドラッグでパターン編集 → 譜面即時反映 → 再生で同期
- **Train**: プリセットお題を表示 → メトロノーム再生 → スペース/タップで判定（Perfect ±40ms / Good ±90ms）

## オーディオスケジューラ
`setInterval(25ms)` で粗い tick → `audioContext.currentTime + 0.1s` まで先読み予約。
音は `osc.start(time)` / `src.start(time)` で予約。`setInterval` コールバック内で直接鳴らさない。
予約したイベントは `scheduledQueue[]` に積み、`requestAnimationFrame` の描画ループで drain → ヘッド更新。

## DTM↔譜面アライン
`UIScore.getAlignMetrics()` から各ステップの絶対 X を取り、
`UIGrid.alignToScore({ leftPx, widthPx })` で DTM セル領域を譜面のノート位置に一致させる。
`requestAnimationFrame` を 2 フレーム待って実行。

## ローカル開発
```sh
cd ~/Desktop/ARIA/リズム
python3 -m http.server 8000
# http://localhost:8000/
```

## 既知の課題・未実装（次セッションの作業候補）
- VexFlow `setNumLines(1)` が VexFlow 5 で未サポートの可能性あり（C4 単線譜）→ ブラウザ確認必要
- `Dot.buildAndAttach` の VexFlow 5 互換性未検証
- VexFlow 描画が例外を投げたとき init() が止まる問題 → try-catch 追加が望ましい
- 再生中の BPM 変更は次ループ頭から反映（途中追従は未実装）
- 小節数拡張（現在 1 小節固定）
- メトロノームクリック音
- お題プリセット追加
- ランレングス音価結合（ドラム譜側。現在は全ステップ 16 分ベタ描画）
- GitHub Pages デプロイ（git init 未実施）
- モバイル（タッチ）動作確認
