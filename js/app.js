// エントリ：状態の束ね、描画ループ、イベント配線。

(() => {
  // --- 状態 ----------------------------------------------------------
  let editPattern = createEmptyPattern();
  let currentPattern = editPattern;
  let swing = { type: 'straight', ratio: 0.5 };

  // --- モバイル検出 ---------------------------------------------------
  const mqMobile = window.matchMedia('(max-width: 640px)');
  const mqLandscape = window.matchMedia('(max-width: 900px) and (orientation: landscape)');
  let isMobile = mqMobile.matches || mqLandscape.matches;
  mqMobile.addEventListener('change', onMobileChange);
  mqLandscape.addEventListener('change', onMobileChange);

  function onMobileChange() {
    isMobile = mqMobile.matches || mqLandscape.matches;
    if (isMobile) {
      setupMobileUI();
      resetGridAlignment();
    } else {
      UIScore.refresh(currentPattern, swing);
      requestAlign();
    }
  }

  // --- DOM 参照（デスクトップ） -----------------------------------------
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

  // --- DOM 参照（モバイル） ---------------------------------------------
  const $mobPlayBtn     = document.getElementById('mob-play-btn');
  const $mobBpmBadge    = document.getElementById('mob-bpm-badge');
  const $mobBpmVal      = document.getElementById('mob-bpm-val');
  const $mobSettingsBtn = document.getElementById('mob-settings-btn');
  const $scoreToggle   = document.getElementById('score-toggle');
  const $scorePanel    = document.getElementById('score-panel');
  const $beatIndicator = document.getElementById('beat-indicator');

  // --- DOM 参照（ボトムシート） ------------------------------------------
  const $sheet           = document.getElementById('bottom-sheet');
  const $sheetBackdrop   = document.getElementById('sheet-backdrop');
  const $sheetBpmSlider  = document.getElementById('sheet-bpm-slider');
  const $sheetBpmValue   = document.getElementById('sheet-bpm-value');
  const $sheetSwingType  = document.getElementById('sheet-swing-type');
  const $sheetSwingRatio = document.getElementById('sheet-swing-ratio');
  const $sheetSwingRatioWrap  = document.getElementById('sheet-swing-ratio-wrap');
  const $sheetSwingRatioValue = document.getElementById('sheet-swing-ratio-value');
  const $sheetClearBtn   = document.getElementById('sheet-clear-btn');

  let scoreVisible = false;

  // --- 初期化 --------------------------------------------------------
  function init() {
    editPattern = clonePattern(PRESETS['basic-rock']);
    currentPattern = editPattern;

    UIGrid.render($gridWrap, currentPattern, { onToggle: onGridToggle });
    UIScore.render('score', $scoreHead, $swingIndicator, currentPattern, swing);

    DrumAudio.setBpm(Number($bpmSlider.value));
    $bpmValue.textContent = $bpmSlider.value;
    applySwing();

    if (isMobile) {
      // モバイル：グリッドの alignToScore を適用しない
      setupMobileUI();
      resetGridAlignment();
    } else {
      requestAlign();
    }

    wireEvents();
    window.addEventListener('resize', debounce(() => {
      isMobile = mqMobile.matches || mqLandscape.matches;
      if (isMobile) {
        resetGridAlignment();
        if (scoreVisible) {
          UIScore.refresh(currentPattern, swing);
          applyScoreScale();
        }
      } else {
        UIScore.refresh(currentPattern, swing);
        requestAlign();
      }
    }, 120));

    requestAnimationFrame(renderLoop);
  }

  function setupMobileUI() {
    UIGrid.setupScrollSync();
    UIGrid.buildBeatIndicator($beatIndicator);
    syncMobileControls();
  }

  // パターン変更時のハンドラ：譜面も再描画してアライン再計算
  function onGridToggle() {
    if (!isMobile || scoreVisible) {
      UIScore.refresh(currentPattern, swing);
    }
    if (!isMobile) requestAlign();
  }

  // --- イベント配線 -------------------------------------------------
  function wireEvents() {
    // デスクトップ
    $playBtn.addEventListener('click', togglePlay);
    $clearBtn.addEventListener('click', clearPattern);

    $bpmSlider.addEventListener('input', () => {
      const v = Number($bpmSlider.value);
      $bpmValue.textContent = String(v);
      DrumAudio.setBpm(v);
      syncMobileControls();
    });

    $swingType.addEventListener('change', () => { applySwing(); syncMobileControls(); });
    $swingRatio.addEventListener('input', () => { applySwing(); syncMobileControls(); });

    // モバイル再生ボタン
    $mobPlayBtn.addEventListener('click', togglePlay);

    // モバイル BPM バッジ → シートを開く
    $mobBpmBadge.addEventListener('click', openSheet);

    // モバイル設定ボタン → シートを開く
    $mobSettingsBtn.addEventListener('click', openSheet);

    // スコアトグル
    $scoreToggle.addEventListener('click', toggleScore);

    // --- ボトムシート内コントロール ---
    $sheetBpmSlider.addEventListener('input', () => {
      const v = Number($sheetBpmSlider.value);
      $sheetBpmValue.textContent = String(v);
      // デスクトップ側にも同期
      $bpmSlider.value = v;
      $bpmValue.textContent = String(v);
      $mobBpmVal.textContent = String(v);
      DrumAudio.setBpm(v);
    });

    $sheetSwingType.addEventListener('change', () => {
      $swingType.value = $sheetSwingType.value;
      applySwing();
      syncMobileControls();
    });

    $sheetSwingRatio.addEventListener('input', () => {
      $swingRatio.value = $sheetSwingRatio.value;
      applySwing();
      syncMobileControls();
    });

    $sheetClearBtn.addEventListener('click', () => {
      clearPattern();
      closeSheet();
    });

    // シートバックドロップ
    $sheetBackdrop.addEventListener('click', closeSheet);
  }

  function clearPattern() {
    editPattern = createEmptyPattern();
    currentPattern = editPattern;
    UIGrid.render($gridWrap, currentPattern, { onToggle: onGridToggle });
    applySwing();
    if (isMobile) {
      setupMobileUI();
      resetGridAlignment();
    } else {
      UIScore.refresh(currentPattern, swing);
      requestAlign();
    }
  }

  // --- モバイルコントロール同期 -----------------------------------------
  function syncMobileControls() {
    const bpm = $bpmSlider.value;
    $mobBpmVal.textContent = bpm;
    $sheetBpmSlider.value = bpm;
    $sheetBpmValue.textContent = bpm;
    $sheetSwingType.value = $swingType.value;
    $sheetSwingRatio.value = $swingRatio.value;
    const ratioText = `${Math.round(swing.ratio * 100)}%`;
    $sheetSwingRatioValue.textContent = ratioText;
    $sheetSwingRatioWrap.hidden = swing.type === 'straight';
  }

  // --- ボトムシート ---------------------------------------------------
  function openSheet() {
    syncMobileControls();
    $sheet.hidden = false;
    $sheetBackdrop.hidden = false;
    requestAnimationFrame(() => {
      $sheet.classList.add('show');
      $sheetBackdrop.classList.add('show');
    });
  }

  function closeSheet() {
    $sheet.classList.remove('show');
    $sheetBackdrop.classList.remove('show');
    setTimeout(() => {
      $sheet.hidden = true;
      $sheetBackdrop.hidden = true;
    }, 300);
  }

  // --- スコアトグル ---------------------------------------------------
  function toggleScore() {
    scoreVisible = !scoreVisible;
    $scorePanel.classList.toggle('show', scoreVisible);
    $scoreToggle.classList.toggle('active', scoreVisible);
    $scoreToggle.textContent = scoreVisible ? '♫ 譜面を隠す' : '♫ 譜面';
    if (scoreVisible) {
      UIScore.refresh(currentPattern, swing);
      requestAnimationFrame(() => {
        applyScoreScale();
        requestAlign();
      });
    } else {
      resetGridAlignment();
    }
  }

  function applyScoreScale() {
    const scoreEl = document.getElementById('score');
    if (!scoreEl) return;
    const svg = scoreEl.querySelector('svg');
    if (!svg) return;
    const panelWidth = $scorePanel.clientWidth - 16; // padding
    const svgWidth = svg.getAttribute('width') || svg.viewBox?.baseVal?.width || 560;
    const scale = Math.min(1, panelWidth / parseFloat(svgWidth));
    svg.style.transformOrigin = 'top left';
    svg.style.transform = `scale(${scale})`;
    // Adjust container height
    const svgHeight = svg.getAttribute('height') || 300;
    scoreEl.style.height = `${parseFloat(svgHeight) * scale}px`;
    scoreEl.style.minHeight = 'auto';
  }

  function resetGridAlignment() {
    // モバイルでスコア非表示時、グリッドの alignment をリセット
    const trackCells = $gridWrap.querySelectorAll('.track-cells');
    trackCells.forEach(cells => {
      cells.style.marginLeft = '';
      cells.style.width = '';
      cells.style.flex = '';
    });
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
    $mobPlayBtn.textContent = '■';
    $mobPlayBtn.classList.add('playing');
  }

  function stopPlayback() {
    DrumAudio.stop();
    $playBtn.textContent = '▶ Play';
    $playBtn.classList.remove('playing');
    $mobPlayBtn.textContent = '▶';
    $mobPlayBtn.classList.remove('playing');
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
    // モバイルでスコア非表示時はアラインをスキップ
    if (isMobile && !scoreVisible) return;

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
