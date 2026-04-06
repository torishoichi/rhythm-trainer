// DTM グリッドの描画・編集・再生ヘッドハイライト
//
// 構造:
//   #grid-wrap
//     .track-row × 4
//       .track-label
//       .track-cells
//         .grid-cell × 16
//     .grid-beat-divider × 3
//     .grid-head
//
// 外部から呼ぶもの:
//   UIGrid.render(container, pattern, { onToggle, readOnly })
//   UIGrid.highlightStep(step)           // -1 でハイライト解除
//   UIGrid.refresh(pattern)              // パターン更新時に見た目を同期
//   UIGrid.applyStepFractions(fractions) // 16 要素の比率で列幅を変える（スイング対応）
//   UIGrid.alignToScore({ leftPx, widthPx }) // 譜面のノート領域に水平位置を合わせる

const UIGrid = (() => {
  let rootEl = null;
  let cellEls = [];       // [{ track, step, el }]
  let rowAreas = {};      // { [track]: .track-cells element }
  let currentPattern = null;
  let currentHighlight = -1;
  let currentFractions = new Array(STEPS).fill(1);
  let optsRef = {};
  let dragState = null;
  let eventsWired = false;
  let gridHeadEl = null;
  let beatDividers = [];
  let cachedCellCenterXs = [];

  function render(container, pattern, opts = {}) {
    optsRef = opts;
    const { readOnly = false } = opts;
    rootEl = container;
    rootEl.innerHTML = '';
    cellEls = [];
    rowAreas = {};
    cachedCellCenterXs = [];
    currentPattern = pattern;

    rootEl.className = 'grid-wrap';
    rootEl.dataset.readonly = readOnly ? '1' : '0';

    for (const track of TRACKS) {
      const trackRow = document.createElement('div');
      trackRow.className = 'track-row';
      trackRow.dataset.track = track;

      const label = document.createElement('div');
      label.className = 'track-label';
      label.innerHTML = TRACK_ICONS[track];
      label.title = TRACK_LABELS[track];
      label.style.color = `var(--${track})`;
      trackRow.appendChild(label);

      const cells = document.createElement('div');
      cells.className = 'track-cells';
      cells.dataset.track = track;

      for (let step = 0; step < STEPS; step++) {
        const cell = document.createElement('div'); // button だとドラッグ時の pointer 挙動が煩雑
        cell.className = 'grid-cell';
        cell.dataset.track = track;
        cell.dataset.step = String(step);
        cell.style.gridColumn = `${step + 1}`;
        cell.style.gridRow = '1';
        if (step % STEPS_PER_BEAT === 0) cell.classList.add('beat-head');
        cells.appendChild(cell);
        cellEls.push({ track, step, el: cell });
      }

      trackRow.appendChild(cells);
      rootEl.appendChild(trackRow);
      rowAreas[track] = cells;
    }

    // グローバル拍区切り線（grid-wrap に配置、全トラック縦断）
    beatDividers = [];
    for (let i = 0; i < 3; i++) {
      const div = document.createElement('div');
      div.className = 'grid-beat-divider';
      rootEl.appendChild(div);
      beatDividers.push(div);
    }
    // 再生ヘッドライン
    gridHeadEl = document.createElement('div');
    gridHeadEl.className = 'grid-head';
    rootEl.appendChild(gridHeadEl);

    // ポインタイベントをルートにまとめてバインド（drag 対応）
    wirePointerEvents();

    // 初期描画
    syncVisuals(pattern);
    applyStepFractions(currentFractions);
  }

  // --- ポインタ／ドラッグ ----------------------------------------------
  // render は何度も呼ばれる（モード切替、Clear、プリセット読込）。
  // rootEl と document に同じハンドラを多重登録しないように一度だけ配線する。
  function wirePointerEvents() {
    if (eventsWired) return;
    rootEl.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    eventsWired = true;
  }

  function cellAtPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const cell = el.closest('.grid-cell');
    if (!cell) return null;
    if (!rootEl.contains(cell)) return null;
    return cell;
  }

  // C4 行はセルが display:none になることがあるため、X 座標からステップを算出
  function c4StepFromClientX(clientX) {
    const cells = rowAreas['c4'];
    if (!cells) return -1;
    const rect = cells.getBoundingClientRect();
    if (rect.width === 0) return -1;
    const x = clientX - rect.left;
    const totalFr = currentFractions.reduce((a, b) => a + b, 0);
    let accum = 0;
    for (let i = 0; i < STEPS; i++) {
      accum += currentFractions[i] / totalFr;
      if (x / rect.width < accum) return i;
    }
    return STEPS - 1;
  }

  function onPointerDown(e) {
    if (rootEl.dataset.readonly === '1') return;

    // C4 行: 座標ベースで判定（display:none セルでも検出可能）
    let track, step;
    const c4Area = rowAreas['c4'];
    if (c4Area) {
      const r = c4Area.getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom
          && e.clientX >= r.left && e.clientX <= r.right) {
        track = 'c4';
        step = c4StepFromClientX(e.clientX);
        if (step < 0) return;
      }
    }
    if (!track) {
      const cell = cellAtPoint(e.clientX, e.clientY);
      if (!cell) return;
      track = cell.dataset.track;
      step = Number(cell.dataset.step);
    }

    e.preventDefault();
    rootEl.setPointerCapture(e.pointerId);

    if (track === 'c4') {
      if (currentPattern.c4[step] !== 0) {
        clearC4RunContaining(currentPattern, step);
        syncVisuals(currentPattern);
        notifyChange(track, step);
        haptic();
        dragState = null;
      } else {
        const snapshot = currentPattern.c4.slice();
        snapshot[step] = 1;
        dragState = {
          track: 'c4',
          startStep: step,
          snapshot,
          currentEnd: step,
        };
        applyC4Drag(step);
      }
    } else {
      const newVal = !currentPattern[track][step];
      currentPattern[track][step] = newVal;
      dragState = { track, paintValue: newVal };
      syncVisuals(currentPattern);
      notifyChange(track, step);
      haptic();
    }
  }

  function onPointerMove(e) {
    if (!dragState) return;
    if (dragState.track === 'c4') {
      const step = c4StepFromClientX(e.clientX);
      if (step < 0 || step === dragState.currentEnd) return;
      applyC4Drag(step);
    } else {
      const cell = cellAtPoint(e.clientX, e.clientY);
      if (!cell) return;
      if (cell.dataset.track !== dragState.track) return;
      const step = Number(cell.dataset.step);
      if (currentPattern[dragState.track][step] !== dragState.paintValue) {
        currentPattern[dragState.track][step] = dragState.paintValue;
        syncVisuals(currentPattern);
        notifyChange(dragState.track, step);
      }
    }
  }

  function onPointerUp(e) {
    if (e && e.pointerId != null) {
      try { rootEl.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    dragState = null;
  }

  function applyC4Drag(step) {
    const snap = dragState.snapshot;
    // snap を復元
    for (let i = 0; i < STEPS; i++) currentPattern.c4[i] = snap[i];
    // 新しい range [from..to] を hit + hold で塗る
    const from = Math.min(dragState.startStep, step);
    const to   = Math.max(dragState.startStep, step);
    currentPattern.c4[from] = 1;
    for (let i = from + 1; i <= to; i++) currentPattern.c4[i] = 2;
    dragState.currentEnd = step;
    syncVisuals(currentPattern);
    notifyChange('c4', step);
  }

  function clearC4RunContaining(pattern, step) {
    // step が属する run を特定して 0 に
    let start = step;
    while (start > 0 && pattern.c4[start] === 2) start--;
    // start は 1（hit）または 0 のはず
    if (pattern.c4[start] === 0) return;
    let end = start;
    while (end + 1 < STEPS && pattern.c4[end + 1] === 2) end++;
    for (let i = start; i <= end; i++) pattern.c4[i] = 0;
  }

  function notifyChange(track, step) {
    if (optsRef.onToggle) optsRef.onToggle(track, step, currentPattern[track][step]);
  }

  // --- 描画反映 --------------------------------------------------------
  function syncVisuals(pattern) {
    currentPattern = pattern;
    for (const c of cellEls) {
      if (c.track === 'c4') continue;
      c.el.classList.toggle('on', !!pattern[c.track][c.step]);
    }
    updateC4Visuals(pattern);
  }

  function updateC4Visuals(pattern) {
    if (!pattern.c4) return;
    // 全 C4 セルをリセット（span・非表示を解除）
    for (const c of cellEls) {
      if (c.track !== 'c4') continue;
      c.el.classList.remove('on', 'run-single', 'run-span');
      c.el.style.gridColumn = `${c.step + 1}`;
      c.el.style.display = '';
    }
    // hit を起点に run を描画
    for (let i = 0; i < STEPS; i++) {
      if (pattern.c4[i] === 1) {
        let len = 1;
        while (i + len < STEPS && pattern.c4[i + len] === 2) len++;
        const startCell = cellEls.find(c => c.track === 'c4' && c.step === i);
        startCell.el.classList.add('on');
        if (len === 1) {
          startCell.el.classList.add('run-single');
        } else {
          // 複数セルを 1 つの gridColumn span でまとめる（gap を埋めて 1 枚板に）
          startCell.el.style.gridColumn = `${i + 1} / span ${len}`;
          startCell.el.classList.add('run-span');
          for (let k = 1; k < len; k++) {
            const midCell = cellEls.find(c => c.track === 'c4' && c.step === i + k);
            midCell.el.style.display = 'none';
          }
        }
        i += len - 1;
      }
    }
  }

  function refresh(pattern) {
    syncVisuals(pattern);
  }

  // --- スイング列幅 ----------------------------------------------------
  function applyStepFractions(fractions) {
    if (!fractions || fractions.length !== STEPS) return;
    currentFractions = fractions.slice();
    const cols = currentFractions.map(f => `${f}fr`).join(' ');
    for (const track of Object.keys(rowAreas)) {
      rowAreas[track].style.gridTemplateColumns = cols;
    }
  }

  // --- 譜面との水平アライン -------------------------------------------
  // leftPx, widthPx は「#grid-wrap の左端を 0 としたときのセル領域の左と幅」
  function alignToScore(metrics) {
    if (!metrics) return;
    const { leftPx, widthPx } = metrics;
    for (const track of Object.keys(rowAreas)) {
      const cells = rowAreas[track];
      cells.style.marginLeft = `${leftPx}px`;
      cells.style.width = `${widthPx}px`;
      cells.style.flex = 'none';
    }
  }

  function setReadOnly(flag) {
    if (!rootEl) return;
    rootEl.dataset.readonly = flag ? '1' : '0';
  }

  function highlightStep(step) {
    if (currentHighlight === step) return;
    currentHighlight = step;
    // ヘッドライン（赤線のみ）
    if (gridHeadEl) {
      if (step < 0 || step >= cachedCellCenterXs.length) {
        gridHeadEl.classList.remove('visible');
      } else {
        gridHeadEl.style.left = `${cachedCellCenterXs[step]}px`;
        gridHeadEl.classList.add('visible');
      }
    }
  }

  // --- セル位置キャッシュ・拍区切り配置 ----------------------------------
  function updateDynamicPositions() {
    if (!rootEl || !cellEls.length) return;
    const rootRect = rootEl.getBoundingClientRect();
    const refTrack = TRACKS[0];

    // 各ステップのセル中心 X をキャッシュ（grid-wrap 基準）
    cachedCellCenterXs = [];
    for (let step = 0; step < STEPS; step++) {
      const cell = cellEls.find(c => c.track === refTrack && c.step === step);
      if (cell) {
        const rect = cell.el.getBoundingClientRect();
        cachedCellCenterXs[step] = rect.left + rect.width / 2 - rootRect.left;
      }
    }

    // 拍区切り線を配置（セル間ギャップの中央。スイング時もずれない）
    const beatEdges = [4, 8, 12];
    for (let i = 0; i < beatEdges.length; i++) {
      const s = beatEdges[i];
      const prev = cellEls.find(c => c.track === refTrack && c.step === s - 1);
      const next = cellEls.find(c => c.track === refTrack && c.step === s);
      if (prev && next) {
        const prevRight = prev.el.getBoundingClientRect().right;
        const nextLeft = next.el.getBoundingClientRect().left;
        const x = (prevRight + nextLeft) / 2 - rootRect.left;
        beatDividers[i].style.left = `${x}px`;
      }
    }
  }

  // --- モバイル: 行スクロール同期 -----------------------------------------
  let scrollSyncing = false;

  function setupScrollSync() {
    const trackKeys = Object.keys(rowAreas);
    for (const track of trackKeys) {
      if (rowAreas[track].dataset.scrollSync) continue;
      rowAreas[track].dataset.scrollSync = '1';
      rowAreas[track].addEventListener('scroll', function () {
        if (scrollSyncing) return;
        scrollSyncing = true;
        const sl = this.scrollLeft;
        for (const t of trackKeys) {
          if (rowAreas[t] !== this) rowAreas[t].scrollLeft = sl;
        }
        requestAnimationFrame(() => { scrollSyncing = false; });
        updateBeatIndicator(sl);
      }, { passive: true });
    }
  }

  // --- モバイル: ビートインジケーター更新 -----------------------------------
  let beatDotEls = [];

  function buildBeatIndicator(indicatorEl) {
    if (!indicatorEl) return;
    indicatorEl.innerHTML = '';
    beatDotEls = [];
    for (let i = 0; i < STEPS; i++) {
      const dot = document.createElement('div');
      dot.className = 'beat-dot';
      if (i % STEPS_PER_BEAT === 0) dot.classList.add('beat-head');
      dot.addEventListener('click', () => scrollToBeat(i));
      indicatorEl.appendChild(dot);
      beatDotEls.push(dot);
    }
    updateBeatIndicator(0);
  }

  function scrollToBeat(step) {
    const refTrack = Object.keys(rowAreas)[0];
    if (!refTrack) return;
    const cells = rowAreas[refTrack];
    const cell = cellEls.find(c => c.track === refTrack && c.step === step);
    if (cell) {
      const cellRect = cell.el.getBoundingClientRect();
      const areaRect = cells.getBoundingClientRect();
      const scrollTarget = cells.scrollLeft + (cellRect.left - areaRect.left);
      cells.scrollTo({ left: scrollTarget, behavior: 'smooth' });
    }
  }

  function updateBeatIndicator(scrollLeft) {
    if (!beatDotEls.length) return;
    const refTrack = Object.keys(rowAreas)[0];
    if (!refTrack) return;
    const cells = rowAreas[refTrack];
    const areaWidth = cells.clientWidth;
    const scrollWidth = cells.scrollWidth;
    if (scrollWidth <= areaWidth) {
      // All visible
      beatDotEls.forEach(d => d.classList.add('visible'));
      return;
    }
    const viewStart = scrollLeft / scrollWidth;
    const viewEnd = (scrollLeft + areaWidth) / scrollWidth;
    for (let i = 0; i < STEPS; i++) {
      const stepStart = i / STEPS;
      const stepEnd = (i + 1) / STEPS;
      const visible = stepStart >= viewStart - 0.01 && stepEnd <= viewEnd + 0.01;
      beatDotEls[i].classList.toggle('visible', visible);
    }
  }

  // --- 触覚フィードバック -------------------------------------------------
  function haptic() {
    if ('vibrate' in navigator) navigator.vibrate(10);
  }

  return {
    render, highlightStep, refresh, setReadOnly,
    applyStepFractions, alignToScore, updateDynamicPositions,
    setupScrollSync, buildBeatIndicator,
  };
})();
