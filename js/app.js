// エントリ：状態の束ね、モード切替、描画ループ、イベント配線。

(() => {
  // --- 状態 ----------------------------------------------------------
  let mode = 'edit';
  let editPattern = createEmptyPattern();
  let currentPattern = editPattern;
  let swing = { type: 'straight', ratio: 0.5 };

  // --- DOM 参照 ------------------------------------------------------
  const $gridWrap     = document.getElementById('grid-wrap');
  const $scoreWrap    = document.getElementById('score-wrap');
  const $scoreHead    = document.getElementById('score-head');
  const $swingIndicator = document.getElementById('swing-indicator');
  const $playBtn      = document.getElementById('play-btn');
  const $clearBtn     = document.getElementById('clear-btn');
  const $bpmSlider    = document.getElementById('bpm-slider');
  const $bpmValue     = document.getElementById('bpm-value');
  const $swingType    = document.getElementById('swing-type');
  const $swingRatio   = document.getElementById('swing-ratio');
  const $swingRatioWrap  = document.getElementById('swing-ratio-wrap');
  const $swingRatioValue = document.getElementById('swing-ratio-value');
  const $modeEdit     = document.getElementById('mode-edit');
  const $modeTrain    = document.getElementById('mode-train');
  const $trainControls = document.getElementById('train-controls');
  const $presetSelect = document.getElementById('preset-select');
  const $tapBtn       = document.getElementById('tap-btn');
  const $judgeLast    = document.getElementById('judge-last');
  const $cntPerfect   = document.getElementById('cnt-perfect');
  const $cntGood      = document.getElementById('cnt-good');
  const $cntMiss      = document.getElementById('cnt-miss');

  // --- 初期化 --------------------------------------------------------
  function init() {
    editPattern = clonePattern(PRESETS['basic-rock']);
    currentPattern = editPattern;

    UIGrid.render($gridWrap, currentPattern, { onToggle: onGridToggle });
    UIScore.render('score', $scoreHead, $swingIndicator, currentPattern, swing);

    DrumAudio.setBpm(Number($bpmSlider.value));
    $bpmValue.textContent = $bpmSlider.value;
    applySwing();
    requestAlign();

    Train.setOnJudge((result) => {
      $judgeLast.textContent = result.toUpperCase();
      $judgeLast.className = `judge-last ${result}`;
      const c = Train.getCounts();
      $cntPerfect.textContent = c.perfect;
      $cntGood.textContent    = c.good;
      $cntMiss.textContent    = c.miss;
    });

    wireEvents();
    window.addEventListener('resize', debounce(() => {
      UIScore.refresh(currentPattern, swing);
      requestAlign();
    }, 120));

    requestAnimationFrame(renderLoop);
  }

  // パターン変更時のハンドラ：譜面も再描画してアライン再計算
  function onGridToggle() {
    UIScore.refresh(currentPattern, swing);
    requestAlign();
  }

  // --- イベント配線 -------------------------------------------------
  function wireEvents() {
    $playBtn.addEventListener('click', togglePlay);
    $clearBtn.addEventListener('click', () => {
      if (mode !== 'edit') return;
      editPattern = createEmptyPattern();
      currentPattern = editPattern;
      UIGrid.render($gridWrap, currentPattern, { onToggle: onGridToggle });
      UIScore.refresh(currentPattern, swing);
      applySwing();
      requestAlign();
    });

    $bpmSlider.addEventListener('input', () => {
      const v = Number($bpmSlider.value);
      $bpmValue.textContent = String(v);
      DrumAudio.setBpm(v);
    });

    $swingType.addEventListener('change', applySwing);
    $swingRatio.addEventListener('input', applySwing);

    $modeEdit.addEventListener('click', () => setMode('edit'));
    $modeTrain.addEventListener('click', () => setMode('train'));

    $presetSelect.addEventListener('change', () => {
      if (mode !== 'train') return;
      loadTrainPreset($presetSelect.value);
    });

    $tapBtn.addEventListener('click', handleTap);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (mode === 'train') handleTap();
      }
    });
  }

  // --- モード切替 ----------------------------------------------------
  function setMode(newMode) {
    if (mode === newMode) return;
    if (DrumAudio.isPlaying) stopPlayback();

    mode = newMode;
    document.body.classList.toggle('mode-train', mode === 'train');
    $modeEdit.classList.toggle('active', mode === 'edit');
    $modeTrain.classList.toggle('active', mode === 'train');
    $modeEdit.setAttribute('aria-selected', mode === 'edit');
    $modeTrain.setAttribute('aria-selected', mode === 'train');
    $trainControls.hidden = mode !== 'train';

    if (mode === 'edit') {
      currentPattern = editPattern;
      UIGrid.render($gridWrap, currentPattern, { onToggle: onGridToggle });
      UIGrid.setReadOnly(false);
    } else {
      loadTrainPreset($presetSelect.value);
    }
    UIScore.refresh(currentPattern, swing);
    applySwing();
    requestAlign();
  }

  function loadTrainPreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;
    currentPattern = clonePattern(preset);
    UIGrid.render($gridWrap, currentPattern, { readOnly: true });
    UIGrid.setReadOnly(true);
    UIScore.refresh(currentPattern, swing);
    applySwing();
    requestAlign();
    resetJudgeDisplay();
  }

  function resetJudgeDisplay() {
    Train.reset();
    $judgeLast.textContent = '--';
    $judgeLast.className = 'judge-last';
    $cntPerfect.textContent = '0';
    $cntGood.textContent = '0';
    $cntMiss.textContent = '0';
  }

  // --- 再生制御 ------------------------------------------------------
  function togglePlay() {
    if (DrumAudio.isPlaying) stopPlayback();
    else startPlayback();
  }

  function startPlayback() {
    DrumAudio.ensureContext();
    DrumAudio.setBpm(Number($bpmSlider.value));
    DrumAudio.start(currentPattern);
    $playBtn.textContent = '■ Stop';
    $playBtn.classList.add('playing');

    if (mode === 'train') {
      resetJudgeDisplay();
      Train.rebuild(currentPattern, DrumAudio.startedAt, DrumAudio.getStepDurationsSec(), 16);
    }
  }

  function stopPlayback() {
    DrumAudio.stop();
    $playBtn.textContent = '▶ Play';
    $playBtn.classList.remove('playing');
    UIGrid.highlightStep(-1);
    UIScore.highlightStep(-1);
  }

  // --- Swing ---------------------------------------------------------
  function applySwing() {
    swing.type = $swingType.value;
    swing.ratio = Number($swingRatio.value) / 100;

    DrumAudio.setSwing(swing);
    const fractions = getStepDurations(swing);
    UIGrid.applyStepFractions(fractions);

    const isOn = swing.type !== 'straight';
    $swingRatioWrap.hidden = !isOn;
    $swingRatioValue.textContent = `${Math.round(swing.ratio * 100)}%`;

    let label = '';
    if (swing.type === 'eighth')         label = `Swing 8分 ${Math.round(swing.ratio * 100)}%`;
    else if (swing.type === 'sixteenth') label = `Swing 16分 ${Math.round(swing.ratio * 100)}%`;
    UIScore.setSwingLabel(label);
    $swingIndicator.classList.toggle('active', !!label);
  }

  // --- 譜面↔DTM 水平アライン -------------------------------------------
  // 譜面のドラム上声部の各音符 X と、DTM セルの中心 X を一致させる。
  // これで再生ヘッドが両パネルでピクセル単位で同じ位置を指す（straight 時）。
  function requestAlign() {
    // 2 フレーム後に実行（レイアウト確定を待つ）
    requestAnimationFrame(() => requestAnimationFrame(alignGridToScore));
  }

  function alignGridToScore() {
    const metrics = UIScore.getAlignMetrics();
    if (!metrics) return;

    const scoreEl = document.getElementById('score');
    if (!scoreEl) return;
    const scoreRect = scoreEl.getBoundingClientRect();
    if (scoreRect.width === 0) return;

    const firstNoteAbs = scoreRect.left + metrics.firstX;
    const lastNoteAbs  = scoreRect.left + metrics.lastX;
    const D = lastNoteAbs - firstNoteAbs;
    if (D <= 0) return;

    // CSS grid の column-gap を考慮してセル領域サイズを算出
    const firstCells = $gridWrap.querySelector('.track-cells');
    const gap = parseFloat(getComputedStyle(firstCells).columnGap) || 0;
    const cellPlusGap = D / (STEPS - 1);
    const cellW = cellPlusGap - gap;
    if (cellW <= 0) return;
    const cellsWidth = STEPS * cellW + (STEPS - 1) * gap;
    const cellsLeftAbs = firstNoteAbs - cellW / 2;

    // ラベル幅 + 行 gap を考慮: margin=0 で自然な左端位置を取得してから差分を設定
    UIGrid.alignToScore({ leftPx: 0, widthPx: cellsWidth });
    const naturalLeft = firstCells.getBoundingClientRect().left;
    const leftPx = cellsLeftAbs - naturalLeft;

    UIGrid.alignToScore({ leftPx, widthPx: cellsWidth });
    UIGrid.updateDynamicPositions();
  }

  // --- Train タップ -------------------------------------------------
  function handleTap() {
    if (mode !== 'train') return;
    if (!DrumAudio.isPlaying) return;
    const now = DrumAudio.getCtx().currentTime;
    Train.onTap(now);
  }

  // --- 描画ループ ---------------------------------------------------
  function renderLoop() {
    if (DrumAudio.isPlaying) {
      const ctx = DrumAudio.getCtx();
      const now = ctx.currentTime;
      const q = DrumAudio.scheduledQueue;
      while (q.length && q[0].time <= now) {
        const evt = q.shift();
        UIGrid.highlightStep(evt.step);
        UIScore.highlightStep(evt.step);
      }
      if (mode === 'train') Train.sweepMissed(now);
    }
    requestAnimationFrame(renderLoop);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
