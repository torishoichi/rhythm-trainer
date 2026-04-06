// パターンデータモデル
// 3 トラック × 16 ステップ（4/4, 16 分）
// すべてのモジュール間で共有する定数＆ヘルパ

const STEPS_PER_BEAT = 4;
const BEATS_PER_BAR  = 4;
const STEPS          = STEPS_PER_BEAT * BEATS_PER_BAR; // 16
// c4 は「連続 ON で 1 つの長音になる」持続トラック。音価を耳で感じるための鍵盤音。
const TRACKS         = ['bass', 'snare', 'hat', 'c4'];
const TRACK_LABELS   = { bass: 'バス', snare: 'スネア', hat: 'ハイハット', c4: 'C4' };
const TRACK_ICONS    = {
  bass:  '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="10" r="2.5" fill="currentColor"/></svg>',
  snare: '<svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="3.5" y1="8" x2="16.5" y2="8" stroke="currentColor" stroke-width="0.8"/><line x1="3.5" y1="12" x2="16.5" y2="12" stroke="currentColor" stroke-width="0.8"/></svg>',
  hat:   '<svg width="20" height="20" viewBox="0 0 20 20"><line x1="4" y1="4" x2="16" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="16" y1="4" x2="4" y2="16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  c4:    '<svg width="20" height="20" viewBox="0 0 20 20"><ellipse cx="8" cy="14" rx="4" ry="3" fill="currentColor" transform="rotate(-20 8 14)"/><line x1="11.5" y1="4" x2="11.5" y2="13" stroke="currentColor" stroke-width="1.8"/></svg>',
};

// c4 トラックは 3 値モデル:
//   0 = off
//   1 = hit（新しい音の開始点）
//   2 = hold（前の音の継続／タイ）
// これで「連続クリック＝複数の単発 16 分」と「ドラッグ＝1 つの持続音」を区別できる。

function createEmptyPattern() {
  return {
    bass:  new Array(STEPS).fill(false),
    snare: new Array(STEPS).fill(false),
    hat:   new Array(STEPS).fill(false),
    c4:    new Array(STEPS).fill(0),
  };
}

function clonePattern(p) {
  return {
    bass:  p.bass.slice(),
    snare: p.snare.slice(),
    hat:   p.hat.slice(),
    c4:    (p.c4 || new Array(STEPS).fill(0)).slice(),
  };
}

function isStepEmpty(p, step) {
  return !p.bass[step] && !p.snare[step] && !p.hat[step] && !p.c4[step];
}

function isC4RunStart(p, step) {
  return !!p.c4 && p.c4[step] === 1;
}

// step が hit のとき、その音の長さ（hit + 後続 hold の数）を返す
function c4RunLength(p, step) {
  if (!p.c4 || p.c4[step] !== 1) return 0;
  let len = 1;
  while (step + len < STEPS && p.c4[step + len] === 2) len++;
  return len;
}

// c4 の run リストを抽出：[{ start, length }, ...]
function c4Runs(p) {
  const runs = [];
  if (!p.c4) return runs;
  for (let i = 0; i < STEPS; i++) {
    if (p.c4[i] === 1) {
      let len = 1;
      while (i + len < STEPS && p.c4[i + len] === 2) len++;
      runs.push({ start: i, length: len });
      i += len - 1;
    }
  }
  return runs;
}

// 16 分音符単位のステップ数 → 音価名
// 16 = 全音符、8 = 2分、4 = 4分、2 = 8分、1 = 16分、3 = 付点8分、6 = 付点4分、12 = 付点2分
const NOTE_VALUE_NAMES = {
  1:  '16分',
  2:  '8分',
  3:  '付点8分',
  4:  '4分',
  6:  '付点4分',
  8:  '2分',
  12: '付点2分',
  16: '全音符',
};
function noteValueName(steps) {
  return NOTE_VALUE_NAMES[steps] || `${steps}/16`;
}

// --- Swing ----------------------------------------------------------
// type: 'straight' | 'eighth' | 'sixteenth'
// ratio: 0.5 = 均等（ストレート）/ 0.667 = 3連符スイング / 0.75 = 重いスイング
// getStepDurations(swing) → 長さ 16 の配列、各要素は「ストレート 16 分」を単位 1 とした相対長さ
//  - straight:             [1,1,1,1,  1,1,1,1,  ...]
//  - eighth   S=2/3:       [1.33,1.33,0.67,0.67] × 4
//  - sixteenth S=2/3:      [1.33,0.67,1.33,0.67] × 4
// どのモードでも 1 拍 = 合計 4 単位、1 小節 = 合計 16 単位になる。

const DEFAULT_SWING = { type: 'straight', ratio: 0.5 };

function getStepDurations(swing) {
  const type = swing && swing.type ? swing.type : 'straight';
  const S = swing && typeof swing.ratio === 'number' ? swing.ratio : 0.5;
  let perBeat;
  if (type === 'eighth') {
    perBeat = [2 * S, 2 * S, 2 * (1 - S), 2 * (1 - S)];
  } else if (type === 'sixteenth') {
    perBeat = [2 * S, 2 * (1 - S), 2 * S, 2 * (1 - S)];
  } else {
    perBeat = [1, 1, 1, 1];
  }
  const out = [];
  for (let b = 0; b < BEATS_PER_BAR; b++) out.push(...perBeat);
  return out;
}

// お題パターン（Train モード用のプリセット）
const PRESETS = {
  'quarter-bass': (() => {
    const p = createEmptyPattern();
    [0, 4, 8, 12].forEach(i => { p.bass[i] = true; });
    return p;
  })(),
  'eighth-hat': (() => {
    const p = createEmptyPattern();
    for (let i = 0; i < STEPS; i += 2) p.hat[i] = true;
    return p;
  })(),
  'backbeat': (() => {
    const p = createEmptyPattern();
    p.snare[4] = true;
    p.snare[12] = true;
    return p;
  })(),
  'basic-rock': (() => {
    const p = createEmptyPattern();
    [0, 4, 8, 12].forEach(i => { p.hat[i] = true; });
    [2, 6, 10, 14].forEach(i => { p.hat[i] = true; });
    p.bass[0] = true;
    p.bass[8] = true;
    p.snare[4] = true;
    p.snare[12] = true;
    return p;
  })(),
};
