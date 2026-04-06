// VexFlow 5 で「ドラム譜（上）+ メロディ2声譜（下: G4↑ + C4↓）」を描画する。
//
// 外部から呼ぶもの:
//   UIScore.render(containerId, headEl, labelEl, pattern, swing)
//   UIScore.highlightStep(step)        // -1 でヘッド非表示
//   UIScore.refresh(pattern, swing)    // パターン変更時に描き直す
//   UIScore.setSwingLabel(text)
//   UIScore.getStepXs()                // [16] 各ステップの X（#score 内）
//   UIScore.getAlignMetrics()          // 譜面のノート領域の位置（アライン用）
//     → { scoreLeftInContainer, firstX, lastX, stepXs }

const UIScore = (() => {
  let containerEl = null;
  let headEl = null;
  let labelEl = null;
  let stepXs = [];        // 各ステップの X（#score 要素内、px）
  let staveTopY = 0;
  let staveBottomY = 0;
  let scoreWidthPx = 0;
  let containerOffsetLeft = 0;

  function render(containerId, headElement, labelElement, pattern, swing) {
    containerEl = document.getElementById(containerId);
    headEl = headElement;
    labelEl = labelElement;
    redraw(pattern, swing);
  }

  function refresh(pattern, swing) {
    redraw(pattern, swing);
  }

  function setSwingLabel(text) {
    if (labelEl) labelEl.textContent = text || '';
  }

  function redraw(pattern, swing) {
    if (!containerEl) return;
    if (typeof VexFlow === 'undefined') {
      containerEl.textContent = 'VexFlow 読み込みエラー';
      return;
    }

    const { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Dot, StaveTie } = VexFlow;

    containerEl.innerHTML = '';
    const width = Math.max(560, containerEl.clientWidth || containerEl.parentElement.clientWidth || 700);
    const height = 300;
    scoreWidthPx = width;

    const renderer = new Renderer(containerEl, Renderer.Backends.SVG);
    renderer.resize(width, height);
    const ctx = renderer.getContext();

    // --- 上：ドラム譜 (percussion 5 線) -------------------------------
    const drumStaveY = 20;
    const drumStave = new Stave(10, drumStaveY, width - 20);
    drumStave.addClef('percussion').addTimeSignature('4/4');
    drumStave.setContext(ctx).draw();

    const drumResult = buildDrumVoices(pattern, StaveNote, Beam);
    const voice1 = new Voice({ numBeats: 4, beatValue: 4 });
    voice1.addTickables(drumResult.upperNotes);
    const voice2 = new Voice({ numBeats: 4, beatValue: 4 });
    voice2.addTickables(drumResult.lowerNotes);

    // --- 下：メロディ2声 単線譜（G4↑ + C4↓、同一線上） --------------------
    const melodyStaveY = 160;
    const melodyStave = new Stave(10, melodyStaveY, width - 20);
    if (typeof melodyStave.setNumLines === 'function') melodyStave.setNumLines(1);
    melodyStave.addTimeSignature('4/4');
    melodyStave.setContext(ctx).draw();

    // メロディ譜表のノート開始位置をドラム譜表に揃える（clef 幅の差を吸収）
    melodyStave.setNoteStartX(drumStave.getNoteStartX());

    // G4 voice（符幹上）— 音符は 'b/4'（線上）、休符は 'd/5'（線の上）
    const g4Result = buildMelodyNotes(pattern, 'g4', 'b/4', 'd/5', 1, StaveNote, Dot);
    const g4Voice = new Voice({ numBeats: 4, beatValue: 4 });
    g4Voice.addTickables(g4Result.notes);

    // C4 voice（符幹下）— 音符は 'b/4'（線上）、休符は 'f/4'（線の下）
    const c4Result = buildMelodyNotes(pattern, 'c4', 'b/4', 'f/4', -1, StaveNote, Dot);
    const c4Voice = new Voice({ numBeats: 4, beatValue: 4 });
    c4Voice.addTickables(c4Result.notes);

    // ドラム声部とメロディ声部を別フォーマッタで整形。
    // 同一フォーマッタだとメロディの音価変更でドラム X 座標が動き、DTM グリッドが揺れる。
    const noteWidth = width - 120;
    new Formatter()
      .joinVoices([voice1, voice2])
      .format([voice1, voice2], noteWidth);
    new Formatter()
      .joinVoices([g4Voice, c4Voice])
      .format([g4Voice, c4Voice], noteWidth);

    voice1.draw(ctx, drumStave);
    voice2.draw(ctx, drumStave);
    drumResult.upperBeams.forEach(b => b.setContext(ctx).draw());
    drumResult.lowerBeams.forEach(b => b.setContext(ctx).draw());

    g4Voice.draw(ctx, melodyStave);
    c4Voice.draw(ctx, melodyStave);

    // G4 タイ描画
    for (const t of g4Result.ties) {
      new StaveTie({
        firstNote: g4Result.notes[t.first],
        lastNote: g4Result.notes[t.last],
        firstIndices: [0],
        lastIndices: [0],
      }).setContext(ctx).draw();
    }
    // C4 タイ描画
    for (const t of c4Result.ties) {
      new StaveTie({
        firstNote: c4Result.notes[t.first],
        lastNote: c4Result.notes[t.last],
        firstIndices: [0],
        lastIndices: [0],
      }).setContext(ctx).draw();
    }

    // --- ステップ X 座標：ドラム上声部の各音符 X を 16 ステップ分取得 -----
    stepXs = drumResult.upperNotes.map((n) => {
      try { return n.getAbsoluteX(); }
      catch (e) { return 0; }
    });

    staveTopY = drumStaveY;
    staveBottomY = melodyStaveY + 40;

    containerOffsetLeft = containerEl.offsetLeft || 0;

    // --- 拍区切り線（譜面側） -------------------------------------------
    drawBeatDividers(ctx, stepXs, staveTopY, staveBottomY);
  }

  // --- ドラム声部構築（既存ロジック） ----------------------------------
  function buildDrumVoices(pattern, StaveNote, Beam) {
    const upperNotes = [];
    const lowerNotes = [];
    const upperIsRest = [];
    const lowerIsRest = [];

    for (let i = 0; i < STEPS; i++) {
      const upperKeys = [];
      if (pattern.hat[i])   upperKeys.push('g/5/x');
      if (pattern.snare[i]) upperKeys.push('c/5');
      if (upperKeys.length > 0) {
        upperNotes.push(new StaveNote({
          keys: upperKeys,
          duration: '16',
          stemDirection: 1,
        }));
        upperIsRest.push(false);
      } else {
        upperNotes.push(new StaveNote({ keys: ['b/4'], duration: '16r' }));
        upperIsRest.push(true);
      }

      if (pattern.bass[i]) {
        lowerNotes.push(new StaveNote({
          keys: ['f/4'],
          duration: '16',
          stemDirection: -1,
        }));
        lowerIsRest.push(false);
      } else {
        lowerNotes.push(new StaveNote({ keys: ['d/4'], duration: '16r' }));
        lowerIsRest.push(true);
      }
    }

    const upperBeams = buildBeams(Beam, upperNotes, upperIsRest);
    const lowerBeams = buildBeams(Beam, lowerNotes, lowerIsRest);

    return { upperNotes, lowerNotes, upperBeams, lowerBeams };
  }

  function buildBeams(Beam, notes, isRestFlags) {
    const beams = [];
    for (let beat = 0; beat < BEATS_PER_BAR; beat++) {
      const start = beat * STEPS_PER_BEAT;
      let group = [];
      for (let i = 0; i < STEPS_PER_BEAT; i++) {
        const idx = start + i;
        if (isRestFlags[idx]) {
          if (group.length >= 2) beams.push(new Beam(group));
          group = [];
        } else {
          group.push(notes[idx]);
        }
      }
      if (group.length >= 2) beams.push(new Beam(group));
    }
    return beams;
  }

  // --- メロディノート構築（C4 / G4 共通） -----------------------------------
  // 3値配列 (0/1/2) をスキャンして音符・休符を作り、タイ情報も返す。
  // noteKey: 音符のキー ('b/4' = 線上)
  // restKey: 休符のキー（2声で重ならないよう上下にずらす）
  // stemDir: 1=上, -1=下
  function buildMelodyNotes(pattern, track, noteKey, restKey, stemDir, StaveNote, Dot) {
    const arr = pattern[track];
    const notes = [];
    const ties = [];
    let i = 0;
    while (i < STEPS) {
      if (arr && arr[i] === 1) {
        let len = 1;
        while (i + len < STEPS && arr[i + len] === 2) len++;
        const parts = splitNoteBeatAware(i, len);
        for (let p = 0; p < parts.length; p++) {
          const idx = notes.length;
          notes.push(makeMelodyNote(StaveNote, Dot, parts[p].duration, parts[p].dots, false, noteKey, stemDir));
          if (p < parts.length - 1) {
            ties.push({ first: idx, last: idx + 1 });
          }
        }
        i += len;
      } else {
        let len = 0;
        while (i + len < STEPS && (!arr || arr[i + len] !== 1)) len++;
        if (len === 0) { i++; continue; }
        for (const d of splitRestBeatAware(i, len)) {
          notes.push(makeMelodyNote(StaveNote, Dot, d.duration, d.dots, true, restKey, stemDir));
        }
        i += len;
      }
    }
    return { notes, ties };
  }

  function makeMelodyNote(StaveNote, Dot, duration, dots, isRest, key, stemDir) {
    const dur = duration + 'd'.repeat(dots) + (isRest ? 'r' : '');
    const opts = { keys: [key], duration: dur };
    if (!isRest) opts.stemDirection = stemDir;
    const n = new StaveNote(opts);
    for (let d = 0; d < dots; d++) {
      n.addModifier(new Dot(), 0);
    }
    return n;
  }

  // len（16 分単位）を標準音価に分割する（greedy）
  function splitLen(len) {
    const candidates = [
      { ticks: 16, duration: 'w',  dots: 0 },
      { ticks: 12, duration: 'h',  dots: 1 },
      { ticks: 8,  duration: 'h',  dots: 0 },
      { ticks: 6,  duration: 'q',  dots: 1 },
      { ticks: 4,  duration: 'q',  dots: 0 },
      { ticks: 3,  duration: '8',  dots: 1 },
      { ticks: 2,  duration: '8',  dots: 0 },
      { ticks: 1,  duration: '16', dots: 0 },
    ];
    const out = [];
    let remaining = len;
    for (const c of candidates) {
      while (remaining >= c.ticks) {
        out.push(c);
        remaining -= c.ticks;
      }
    }
    return out;
  }

  // ── 音符用：拍境界で分割（付点OK、タイで接続） ──
  // - オフビート開始 → 次の拍頭まで詰める
  // - 拍頭開始 → 半小節境界（step 8）を超えない最大標準音価を選択
  function splitNoteBeatAware(start, len) {
    const out = [];
    let pos = start;
    let remaining = len;
    const candidates = [8, 6, 4, 3, 2, 1]; // half, q., q, 8., 8, 16

    while (remaining > 0) {
      const posInBeat = pos % 4;
      let chunk;

      if (posInBeat !== 0) {
        chunk = Math.min(remaining, 4 - posInBeat);
      } else {
        const posInHalf = pos % 8;
        const toHalfEnd = posInHalf === 0 ? 8 : (8 - posInHalf);
        const maxChunk = Math.min(remaining, toHalfEnd);
        chunk = 1;
        for (const c of candidates) {
          if (c <= maxChunk) { chunk = c; break; }
        }
      }

      out.push(...splitLen(chunk));
      pos += chunk;
      remaining -= chunk;
    }
    return out;
  }

  // ── 休符用：8分音符境界でも分割し、付点を使わない ──
  // 音符と違い、休符は「拍の構造が見える」ことが最優先。
  //  - 8分境界（2ステップごと）を跨がない
  //  - 付点休符を使わない（付点4分→4分+8分、付点8分→8分+16分）
  function splitRestBeatAware(start, len) {
    const out = [];
    let pos = start;
    let remaining = len;
    // 付点なしの音価のみ: 2分(8), 4分(4), 8分(2), 16分(1)
    const restCandidates = [8, 4, 2, 1];

    while (remaining > 0) {
      const posIn8th = pos % 2;
      const posInBeat = pos % 4;
      let chunk;

      if (posIn8th !== 0) {
        // 8分音符の途中 → 16分休符 1 つだけ
        chunk = 1;
      } else if (posInBeat !== 0) {
        // 8分境界上だが拍頭ではない → 8分休符まで（最大2ステップ）
        chunk = Math.min(remaining, 2);
      } else {
        // 拍頭 → 半小節境界を超えない最大の非付点音価
        const posInHalf = pos % 8;
        const toHalfEnd = posInHalf === 0 ? 8 : (8 - posInHalf);
        const maxChunk = Math.min(remaining, toHalfEnd);
        chunk = 1;
        for (const c of restCandidates) {
          if (c <= maxChunk) { chunk = c; break; }
        }
      }

      out.push(...splitLen(chunk));
      pos += chunk;
      remaining -= chunk;
    }
    return out;
  }

  // --- 拍区切り線（譜面側） -------------------------------------------
  // stepXs[4], [8], [12] の直前あたりに縦線を薄く引く。
  function drawBeatDividers(ctx, xs, y1, y2) {
    if (!xs || xs.length < 16) return;
    const beatEdgeIdxs = [4, 8, 12];
    ctx.save();
    ctx.setStrokeStyle('rgba(40, 40, 40, 0.35)');
    ctx.setLineWidth(1.2);
    for (const idx of beatEdgeIdxs) {
      // 前拍最終ステップと次拍先頭ステップの中点
      const x = (xs[idx - 1] + xs[idx]) / 2;
      ctx.beginPath();
      ctx.moveTo(x, y1);
      ctx.lineTo(x, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- 再生ヘッド -------------------------------------------------------
  function highlightStep(step) {
    if (!headEl) return;
    if (step < 0 || step >= stepXs.length) {
      headEl.classList.remove('visible');
      return;
    }
    // viewBox 方式: SVG が CSS でスケールされている場合、座標を実寸に変換
    const svg = containerEl && containerEl.querySelector('svg');
    let scale = 1;
    if (svg) {
      const vb = svg.getAttribute('viewBox');
      if (vb) {
        const vbW = parseFloat(vb.split(/\s+/)[2]);
        const renderedW = svg.getBoundingClientRect().width;
        if (vbW > 0 && renderedW > 0) scale = renderedW / vbW;
      }
    }
    const x = stepXs[step] * scale + containerOffsetLeft;
    headEl.style.left = `${x}px`;
    headEl.classList.add('visible');
  }

  function getStepXs() { return stepXs.slice(); }

  // DTM アライン用：譜面のノート領域（最初の音符〜最後の音符）の左右位置
  function getAlignMetrics() {
    if (!stepXs.length) return null;
    return {
      scoreLeftInContainer: containerOffsetLeft,
      firstX: stepXs[0],
      lastX: stepXs[STEPS - 1],
      width: scoreWidthPx,
      stepXs: stepXs.slice(),
    };
  }

  return { render, refresh, highlightStep, getStepXs, setSwingLabel, getAlignMetrics };
})();
