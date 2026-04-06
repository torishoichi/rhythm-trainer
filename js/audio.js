// AudioContext + 簡易ドラムシンセ + C4 持続音 + スイング対応 lookahead スケジューラ
//
// 外部から呼ぶもの:
//   DrumAudio.ensureContext()                 // ユーザー操作後に呼ぶ
//   DrumAudio.start(pattern, { onStep })      // 再生開始
//   DrumAudio.stop()                          // 停止
//   DrumAudio.setBpm(bpm)                     // BPM 更新
//   DrumAudio.setSwing({ type, ratio })       // スイング更新
//   DrumAudio.getStepDurationsSec()           // 現在の各ステップの秒数 [16]
//   DrumAudio.getCtx()                        // AudioContext
//   DrumAudio.scheduledQueue                  // [{ step, time }]（描画側で drain）

const DrumAudio = (() => {
  let ctx = null;
  let isPlaying = false;
  let currentStep = 0;
  let nextNoteTime = 0;
  let timerId = null;
  let bpm = 100;
  let swing = { type: 'straight', ratio: 0.5 };
  let stepDurationUnits = [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1]; // 相対（1 = ストレート 16 分）
  let stepDurationSec = new Array(STEPS).fill(0);
  let barSeconds = 0;
  let patternRef = null;
  let onStepCb = null;
  let startedAt = 0;

  const scheduledQueue = [];

  const LOOKAHEAD_MS   = 25;
  const SCHEDULE_AHEAD = 0.1;

  function ensureContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function recomputeDurations() {
    stepDurationUnits = getStepDurations(swing);
    const sixteenthSec = (60 / bpm) / STEPS_PER_BEAT;
    stepDurationSec = stepDurationUnits.map(u => u * sixteenthSec);
    barSeconds = stepDurationSec.reduce((a, b) => a + b, 0);
  }

  function setBpm(v) {
    bpm = v;
    recomputeDurations();
  }

  function setSwing(s) {
    swing = { type: s.type, ratio: s.ratio };
    recomputeDurations();
  }

  function start(pattern, opts = {}) {
    ensureContext();
    patternRef = pattern;
    onStepCb = opts.onStep || null;
    recomputeDurations();
    isPlaying = true;
    currentStep = 0;
    nextNoteTime = ctx.currentTime + 0.05;
    startedAt = nextNoteTime;
    scheduledQueue.length = 0;
    timerId = setInterval(schedulerTick, LOOKAHEAD_MS);
  }

  function stop() {
    isPlaying = false;
    if (timerId !== null) { clearInterval(timerId); timerId = null; }
    scheduledQueue.length = 0;
  }

  function schedulerTick() {
    if (!isPlaying || !ctx) return;
    while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
      scheduleStep(currentStep, nextNoteTime);
      scheduledQueue.push({ step: currentStep, time: nextNoteTime });
      if (onStepCb) onStepCb(currentStep, nextNoteTime);
      nextNoteTime += stepDurationSec[currentStep];
      currentStep = (currentStep + 1) % STEPS;
      // ループ先頭に戻ったら startedAt を次小節先頭に繰り上げて Train 判定で使えるように
      if (currentStep === 0) startedAt = nextNoteTime;
    }
  }

  function scheduleStep(step, time) {
    if (!patternRef) return;
    if (patternRef.bass[step])  playBass(time);
    if (patternRef.snare[step]) playSnare(time);
    if (patternRef.hat[step])   playHat(time);

    // C4：run の先頭でのみ発音し、run 長に合わせた持続時間を渡す
    if (isRunStart(patternRef, 'c4', step)) {
      const rl = runLength(patternRef, 'c4', step);
      let dur = 0;
      for (let k = 0; k < rl; k++) dur += stepDurationSec[(step + k) % STEPS];
      playC4(time, dur);
    }

    // G4：C4 と同じ run-length パターン
    if (isRunStart(patternRef, 'g4', step)) {
      const rl = runLength(patternRef, 'g4', step);
      let dur = 0;
      for (let k = 0; k < rl; k++) dur += stepDurationSec[(step + k) % STEPS];
      playG4(time, dur);
    }
  }

  // --- 音源 ------------------------------------------------------------

  function playBass(time) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.9, time + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  let noiseBuffer = null;
  function getNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer;
    const len = Math.floor(ctx.sampleRate * 0.4);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuffer;
  }

  function playSnare(time) {
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.7, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);
    src.connect(hp).connect(gain).connect(ctx.destination);
    src.start(time);
    src.stop(time + 0.2);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 210;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, time);
    g2.gain.exponentialRampToValueAtTime(0.25, time + 0.002);
    g2.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
    osc.connect(g2).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.14);
  }

  function playHat(time) {
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = getNoiseBuffer();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.35, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    src.connect(hp).connect(gain).connect(ctx.destination);
    src.start(time);
    src.stop(time + 0.06);
  }

  // C4 = 261.63Hz。音価を耳で感じるための持続音（run 長に合わせて sustain）
  function playC4(time, durationSec) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc.type = 'triangle';
    osc2.type = 'sine';
    osc.frequency.value = 261.6256;
    osc2.frequency.value = 261.6256 * 2; // オクターブ上を薄く混ぜて存在感
    const gain = ctx.createGain();
    const attack = 0.008;
    const release = Math.min(0.08, durationSec * 0.3);
    const sustainEnd = Math.max(time + attack, time + durationSec - release);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.35, time + attack);
    gain.gain.setValueAtTime(0.35, sustainEnd);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + durationSec);
    const gain2 = ctx.createGain();
    gain2.gain.value = 0.08;
    osc.connect(gain);
    osc2.connect(gain2).connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc2.start(time);
    osc.stop(time + durationSec + 0.02);
    osc2.stop(time + durationSec + 0.02);
  }

  // G4 = 391.995Hz。C4 と同じエンベロープ構造
  function playG4(time, durationSec) {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc.type = 'triangle';
    osc2.type = 'sine';
    osc.frequency.value = 391.9954;
    osc2.frequency.value = 391.9954 * 2;
    const gain = ctx.createGain();
    const attack = 0.008;
    const release = Math.min(0.08, durationSec * 0.3);
    const sustainEnd = Math.max(time + attack, time + durationSec - release);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.35, time + attack);
    gain.gain.setValueAtTime(0.35, sustainEnd);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + durationSec);
    const gain2 = ctx.createGain();
    gain2.gain.value = 0.08;
    osc.connect(gain);
    osc2.connect(gain2).connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc2.start(time);
    osc.stop(time + durationSec + 0.02);
    osc2.stop(time + durationSec + 0.02);
  }

  function getCtx() { return ctx; }
  function getStepDurationsSec() { return stepDurationSec.slice(); }
  function getStepDurationsUnit() { return stepDurationUnits.slice(); }

  return {
    ensureContext, start, stop, setBpm, setSwing, getCtx,
    getStepDurationsSec, getStepDurationsUnit,
    playBass, playSnare, playHat, playC4, playG4,
    get scheduledQueue() { return scheduledQueue; },
    get isPlaying() { return isPlaying; },
    get startedAt() { return startedAt; },
    get barSeconds() { return barSeconds; },
    get bpm() { return bpm; },
    get swing() { return { ...swing }; },
  };
})();
