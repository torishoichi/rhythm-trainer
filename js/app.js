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
  mqMobile.addEventListener('change', onViewportChange);
  mqLandscape.addEventListener('change', onViewportChange);

  function onViewportChange() {
    isMobile = mqMobile.matches || mqLandscape.matches;
    UIScore.refresh(currentPattern, swing);
    if (isMobile) {
      applyScoreScale();
    }
    requestAlign();
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
  const $scorePanel    = document.getElementById('score-panel');

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
      syncMobileControls();
      requestAnimationFrame(() => {
        applyScoreScale();
        requestAlign();
      });
    } else {
      requestAlign();
    }

    wireEvents();
    window.addEventListener('resize', debounce(() => {
      isMobile = mqMobile.matches || mqLandscape.matches;
      UIScore.refresh(currentPattern, swing);
      if (isMobile) applyScoreScale();
      requestAlign();
    }, 120));

    requestAnimationFrame(renderLoop);
  }

  // パターン変更時のハンドラ：譜面のみ再描画（グリッドアラインは動かさない）
  // requestAlign() をここで呼ぶと、VexFlow のフォーマッタが音符幅に応じて
  // X 座標を微妙に変えるたびグリッドが揺れるため、init / resize 時のみ実行する。
  function onGridToggle() {
    if (isMobile) {
      const wrap = document.getElementById('score-wrap');
      const scoreEl = document.getElementById('score');
      if (wrap) { wrap.style.height = wrap.offsetHeight + 'px'; wrap.style.width = wrap.offsetWidth + 'px'; }
      if (scoreEl) { scoreEl.style.width = scoreEl.offsetWidth + 'px'; }
      UIScore.refresh(currentPattern, swing);
      applyScoreScale();
      requestAnimationFrame(() => {
        if (wrap) { wrap.style.height = ''; wrap.style.width = ''; }
        if (scoreEl) { scoreEl.style.width = ''; }
      });
    } else {
      UIScore.refresh(currentPattern, swing);
    }
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

    // --- ボトムシート内コントロール ---
    $sheetBpmSlider.addEventListener('input', () => {
      const v = Number($sheetBpmSlider.value);
      $sheetBpmValue.textContent = String(v);
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

    $sheetBackdrop.addEventListener('click', closeSheet);
  }

  function clearPattern() {
    editPattern = createEmptyPattern();
    currentPattern = editPattern;
    UIGrid.render($gridWrap, currentPattern, { onToggle: onGridToggle });
    UIScore.refresh(currentPattern, swing);
    applySwing();
    if (isMobile) applyScoreScale();
    requestAlign();
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

  // --- 譜面スケール（モバイル用） ----------------------------------------
  // CSS transform ではなく viewBox + width:100% でネイティブスケール。
  // レイアウトボックスがコンテナ幅に一致するため overflow 問題なし。
  function applyScoreScale() {
    const scoreEl = document.getElementById('score');
    if (!scoreEl) return;
    const svg = scoreEl.querySelector('svg');
    if (!svg) return;
    const w = parseFloat(svg.getAttribute('width'));
    const h = parseFloat(svg.getAttribute('height'));
    if (!w || !h) return;
    // viewBox 設定でSVGをレスポンシブ化
    if (!svg.getAttribute('viewBox')) {
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.width = '100%';
    svg.style.height = 'auto';
    svg.style.display = 'block';
    scoreEl.style.minHeight = 'auto';
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
    const metrics = UIScore.getAlignMetrics();
    if (!metrics) return;

    const scoreEl = document.getElementById('score');
    if (!scoreEl) return;
    const scoreRect = scoreEl.getBoundingClientRect();
    if (scoreRect.width === 0) return;

    // viewBox 方式: SVG が CSS でスケールされているため
    // getAbsoluteX() の値を実描画スケールに変換
    const svg = scoreEl.querySelector('svg');
    let scaleF = 1;
    if (svg) {
      const vb = svg.getAttribute('viewBox');
      if (vb) {
        const vbW = parseFloat(vb.split(/\s+/)[2]);
        if (vbW > 0) scaleF = scoreRect.width / vbW;
      }
    }

    const firstNoteAbs = scoreRect.left + metrics.firstX * scaleF;
    const lastNoteAbs  = scoreRect.left + metrics.lastX * scaleF;
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
