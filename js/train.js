// Train モード：お題パターンの「叩くべき時刻リスト」を構築し、
// ユーザーのタップ時刻と付き合わせて Perfect / Good / Miss を判定する。
//
// MVP: トラック区別なし（どれか 1 つ叩くと OK）。
//
// 外部から呼ぶもの:
//   Train.rebuild(pattern, barStartTime, barSeconds, barCount)
//     → 指定された小節開始時刻から barCount 小節分の期待時刻を生成
//   Train.onTap(nowSec) → { result: 'perfect'|'good'|'miss'|null }
//   Train.sweepMissed(nowSec)
//   Train.reset()
//   Train.getCounts() → { perfect, good, miss }
//   Train.onJudge = (result) => {}   // 判定ごとのコールバック

const Train = (() => {
  const PERFECT_MS = 40;
  const GOOD_MS    = 90;

  let expected = [];    // [{ t, judged: false }]
  let counts = { perfect: 0, good: 0, miss: 0 };
  let onJudge = null;

  function setOnJudge(cb) { onJudge = cb; }

  function reset() {
    expected = [];
    counts = { perfect: 0, good: 0, miss: 0 };
  }

  // pattern から「何か 1 つでも on のステップ」を拾い上げ、
  // stepDurationsSec（長さ 16）に基づいて barCount 小節分の期待時刻を作る。
  // これでスイング時も正しい時刻になる。
  function rebuild(pattern, barStartTime, stepDurationsSec, barCount = 8) {
    expected = [];
    const hitSteps = [];
    for (let i = 0; i < STEPS; i++) {
      if (pattern.bass[i] || pattern.snare[i] || pattern.hat[i] || (pattern.c4 && pattern.c4[i])) {
        hitSteps.push(i);
      }
    }
    // 各ステップの先頭時刻（小節内オフセット）をあらかじめ計算
    const stepOffsets = new Array(STEPS);
    let acc = 0;
    for (let i = 0; i < STEPS; i++) {
      stepOffsets[i] = acc;
      acc += stepDurationsSec[i];
    }
    const barSeconds = acc;
    for (let bar = 0; bar < barCount; bar++) {
      for (const s of hitSteps) {
        expected.push({
          t: barStartTime + bar * barSeconds + stepOffsets[s],
          judged: false,
        });
      }
    }
    counts = { perfect: 0, good: 0, miss: 0 };
  }

  function findClosestPending(nowSec) {
    // まだ judged でなく、かつ時刻が近い（過去も未来も許容）
    let best = null;
    let bestDiff = Infinity;
    for (const e of expected) {
      if (e.judged) continue;
      const diff = Math.abs(e.t - nowSec);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = e;
      }
    }
    return best;
  }

  function onTap(nowSec) {
    const cand = findClosestPending(nowSec);
    if (!cand) return { result: null };
    const diffMs = Math.abs(cand.t - nowSec) * 1000;
    let result;
    if (diffMs <= PERFECT_MS)      result = 'perfect';
    else if (diffMs <= GOOD_MS)    result = 'good';
    else result = 'miss';
    cand.judged = true;
    counts[result]++;
    if (onJudge) onJudge(result);
    return { result };
  }

  // 許容ウィンドウを過ぎた未判定の期待時刻を自動 miss にする
  function sweepMissed(nowSec) {
    for (const e of expected) {
      if (e.judged) continue;
      if (e.t < nowSec - GOOD_MS / 1000) {
        e.judged = true;
        counts.miss++;
        if (onJudge) onJudge('miss');
      }
    }
  }

  function getCounts() { return { ...counts }; }

  return { rebuild, onTap, sweepMissed, reset, getCounts, setOnJudge };
})();
