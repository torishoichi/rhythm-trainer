// エントリ：状態の束ね、描画ループ、イベント配線。

(() => {
  // --- 状態 ----------------------------------------------------------
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
  function requestAlign() {
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

    const firstCells = $gridWrap.querySelector('.track-cells');
    const gap = parseFloat(getComputedStyle(firstCells).columnGap) || 0;
    const cellPlusGap = D / (STEPS - 1);
    const cellW = cellPlusGap - gap;
    if (cellW <= 0) return;
    const cellsWidth = STEPS * cellW + (STEPS - 1) * gap;
    const cellsLeftAbs = firstNoteAbs - cellW / 2;

    UIGrid.alignToScore({ leftPx: 0, widthPx: cellsWidth });
    const naturalLeft = firstCells.getBoundingClientRect().left;
    const leftPx = cellsLeftAbs - naturalLeft;

    UIGrid.alignToScore({ leftPx, widthPx: cellsWidth });
    UIGrid.updateDynamicPositions();
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
