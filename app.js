(function () {
  "use strict";

  const regions = window.PianoRegions;
  if (!regions) {
    console.error("Piano helpers not loaded.");
    return;
  }

  const Config = {
    jumpThreshold: 12,
    whiteKeyWidth: 36,
    blackKeyWidth: 22,
    phraseLookahead: 8,
  };

  const PIECES = [
    { id: "air_bach", src: "pieces/Air — Bach.json", label: "Air — Bach" },
    { id: "arabesque_debussy", src: "pieces/Arabesque — Debussy.json", label: "Arabesque — Debussy" },
    { id: "ave_maria_schubert", src: "pieces/Ave Maria — Schubert.json", label: "Ave Maria — Schubert" },
    { id: "canon_in_d_pachelbel", src: "pieces/Canon in D — Pachelbel.json", label: "Canon in D — Pachelbel" },
    { id: "clair_de_lune", src: "pieces/Clair de Lune — Debussy.json", label: "Clair de Lune — Debussy" },
    { id: "dance_of_the_sugar_plum_fairy_tchaikovsky", src: "pieces/Dance of the Sugar Plum Fairy — Tchaikovsky.json", label: "Dance of the Sugar Plum Fairy — Tchaikovsky" },
    { id: "flight_of_the_bumblebee_rimsky_korsakov", src: "pieces/Flight of the Bumblebee — Rimsky-Korsakov.json", label: "Flight of the Bumblebee — Rimsky-Korsakov" },
    { id: "fur_elise_beethoven", src: "pieces/Für Elise — Beethoven.json", label: "Für Elise — Beethoven" },
    { id: "gymnopedie_satie", src: "pieces/Gymnopédie — Satie.json", label: "Gymnopédie — Satie" },
    { id: "maple_leaf_rag_scott_joplin", src: "pieces/Maple Leaf Rag — Scott Joplin.json", label: "Maple Leaf Rag — Scott Joplin" },
    { id: "moonlight", src: "pieces/Moonlight Sonata — Beethoven.json", label: "Moonlight Sonata — Beethoven" },
    { id: "nocturne_no_20_chopin", src: "pieces/Nocturne No. 20 — Chopin.json", label: "Nocturne No. 20 — Chopin" },
    { id: "nocturne_op_9_chopin", src: "pieces/Nocturne Op. 9 — Chopin.json", label: "Nocturne Op. 9 — Chopin" },
    { id: "ode_to_joy_beethoven", src: "pieces/Ode to Joy — Beethoven.json", label: "Ode to Joy — Beethoven" },
    { id: "prelude_bach", src: "pieces/Prelude — Bach.json", label: "Prelude — Bach" },
    { id: "the_entertainer_scott_joplin", src: "pieces/The Entertainer — Scott Joplin.json", label: "The Entertainer — Scott Joplin" },
    { id: "toccata_and_fugue_bach", src: "pieces/Toccata and Fugue — Bach.json", label: "Toccata and Fugue — Bach" },
    { id: "turkish_march_mozart", src: "pieces/Turkish March — Mozart.json", label: "Turkish March — Mozart" },
    { id: "waltz_chopin", src: "pieces/Waltz – Chopin.json", label: "Waltz – Chopin" },
  ];

  const State = {
    piece: null,
    flatEvents: [],
    currentIndex: 0,
    playedKeys: new Set(),
    currentlyPressedKeys: new Set(),
    localWindow: { startKey: 25, endKey: 56 },
    keyPositions: new Map(),
    midiAccess: null,
    selectedInputId: null,
    midiStatus: "idle",
    showKeyNumbers: false,
    practiceAdvanceTimer: null,
    loop: null,
    loopBarCount: 1,
    selection: null,
    homePianoOnRender: true,
    lastPhraseScrollIndex: null,
    lastPhraseScrollBar: null,
    wakeLock: null,
  };

  const KEY_NUMBERS_STORE = "clair-de-lune.show-key-numbers";
  const SELECTED_PIECE_STORE = "piano.selected-piece";
  const pieceCache = Object.create(null);

  const els = {
    pageTitle: document.getElementById("page-title"),
    pageSubtitle: document.getElementById("page-subtitle"),
    pieceSelect: document.getElementById("piece-select"),
    barNum: document.getElementById("bar-num"),
    barTotal: document.getElementById("bar-total"),
    stepNum: document.getElementById("step-num"),
    stepTotal: document.getElementById("step-total"),
    btnPrev: document.getElementById("btn-prev"),
    btnNext: document.getElementById("btn-next"),
    btnReset: document.getElementById("btn-reset"),
    midiChip: document.getElementById("midi-chip"),
    midiSelect: document.getElementById("midi-select"),
    minimap: document.getElementById("minimap"),
    movementCues: document.getElementById("movement-cues"),
    landmarkStrip: document.getElementById("landmark-strip"),
    noteLane: document.getElementById("note-lane"),
    pianoScroll: document.getElementById("piano-scroll"),
    localStageInner: document.getElementById("local-stage-inner"),
    localPiano: document.getElementById("local-piano"),
    btnKeyNumbers: document.getElementById("btn-key-numbers"),
    phrasePanel: document.getElementById("phrase-panel"),
    phraseScroll: document.getElementById("phrase-scroll"),
    phraseInner: document.getElementById("phrase-inner"),
    phraseStatus: document.getElementById("phrase-status"),
    btnLoopThese: document.getElementById("btn-loop-these"),
    btnLoopAgain: document.getElementById("btn-loop-again"),
    btnLoopClear: document.getElementById("btn-loop-clear"),
    btnLoopMinus: document.getElementById("btn-loop-minus"),
    btnLoopPlus: document.getElementById("btn-loop-plus"),
    loopBarCount: document.getElementById("loop-bar-count"),
  };

  let syncingPhraseScroll = false;
  let lastPianoScrollX = 0;
  let lastPhraseScrollX = 0;

  function buildFlatEvents(piece) {
    const list = [];
    (piece.bars || []).forEach(function (bar, bIdx) {
      (bar.events || []).forEach(function (ev, eIdx) {
        list.push({
          barIndex: bIdx,
          eventIndex: eIdx,
          barNum: bar.n,
          eventNum: eIdx + 1,
          totalInBar: bar.events.length,
          event: ev,
          keysL: ev.L && ev.L.length ? ev.L.slice() : [],
          keysR: ev.R && ev.R.length ? ev.R.slice() : [],
          allKeys: [].concat(ev.L || [], ev.R || []),
          isRest: !!ev.rest,
        });
      });
    });
    return list;
  }

  function currentFlatEvent() {
    return State.flatEvents[State.currentIndex] || null;
  }

  function upcomingFlatEvent(offset) {
    const idx = State.currentIndex + (offset || 1);
    return State.flatEvents[idx] || null;
  }

  function renderMinimap() {
    if (!els.minimap) return;
    const cur = currentFlatEvent();
    const nxt = upcomingFlatEvent(1);

    const curL = cur ? cur.keysL : [];
    const curR = cur ? cur.keysR : [];
    const nxtL = nxt ? nxt.keysL : [];
    const nxtR = nxt ? nxt.keysR : [];

    const lhActiveRegions = new Set(regions.getRegionsForKeys(curL).map(function (r) { return r.id; }));
    const rhActiveRegions = new Set(regions.getRegionsForKeys(curR).map(function (r) { return r.id; }));

    const lhMove = regions.calculateHandMovement(curL, nxtL, "L", { LARGE_JUMP: Config.jumpThreshold });
    const rhMove = regions.calculateHandMovement(curR, nxtR, "R", { LARGE_JUMP: Config.jumpThreshold });

    const targetRegionIds = new Set();
    if (lhMove.requiresJumpWarning || lhMove.crossesRegion) {
      lhMove.destinationRegions.forEach(function (r) { targetRegionIds.add(r.id); });
    }
    if (rhMove.requiresJumpWarning || rhMove.crossesRegion) {
      rhMove.destinationRegions.forEach(function (r) { targetRegionIds.add(r.id); });
    }

    let html = "";
    regions.PIANO_REGIONS.forEach(function (reg) {
      const isTarget = targetRegionIds.has(reg.id);
      const isLh = lhActiveRegions.has(reg.id);
      const isRh = rhActiveRegions.has(reg.id);

      let badgesHtml = "";
      if (isLh) badgesHtml += '<span class="hand-badge hand-badge-lh" title="Left hand in ' + reg.name + '">L</span>';
      if (isRh) badgesHtml += '<span class="hand-badge hand-badge-rh" title="Right hand in ' + reg.name + '">R</span>';

      const targetTag = isTarget ? '<span class="minimap-target-cue">DEST</span>' : "";
      const keysSpan = reg.id === 1 ? "1–15" : (reg.id === 7 ? "76–88" : reg.start + "–" + reg.end);

      html +=
        '<div class="minimap-cell' + (isTarget ? " is-target" : "") + '" ' +
        'style="--cell-color:' + reg.color + '; --cell-ink:' + reg.textInk + ';" ' +
        'title="' + reg.label + ' (keys ' + keysSpan + ')">' +
          targetTag +
          '<span class="minimap-cell-name">' + reg.name + "</span>" +
          '<span class="minimap-cell-keys">' + keysSpan + "</span>" +
          '<div class="minimap-badges">' + badgesHtml + "</div>" +
        "</div>";
    });

    els.minimap.innerHTML = html;
    renderMovementCues(lhMove, rhMove);
  }

  function renderMovementCues(lhMove, rhMove) {
    if (!els.movementCues) return;
    const cues = [];

    function makeCueHtml(move, handLabel, badgeClass) {
      if (!move.nextRange || move.distance === 0) return "";
      const arrow = move.direction === "right" ? "→" : (move.direction === "left" ? "←" : "·");
      let tagHtml = "";
      if (move.requiresJumpWarning) {
        tagHtml = '<span class="cue-jump-tag">Jump ' + move.distance + ' keys</span>';
      } else if (move.level === "move" || move.crossesRegion) {
        tagHtml = '<span class="cue-move-tag">' + move.distance + ' keys ' + arrow + "</span>";
      }

      if (!tagHtml) return "";

      return (
        '<div class="cue-item">' +
          '<span class="hand-badge ' + badgeClass + '">' + handLabel + "</span>" +
          '<span class="cue-arrow">' + arrow + "</span>" +
          tagHtml +
        "</div>"
      );
    }

    const lhHtml = makeCueHtml(lhMove, "L", "hand-badge-lh");
    const rhHtml = makeCueHtml(rhMove, "R", "hand-badge-rh");

    if (lhHtml) cues.push(lhHtml);
    if (rhHtml) cues.push(rhHtml);

    if (!cues.length) {
      els.movementCues.innerHTML = '<span class="muted">Hands in position</span>';
    } else {
      els.movementCues.innerHTML = cues.join("");
    }
  }

  function whiteKeyWidth() {
    return window.innerWidth <= 640 ? 32 : Config.whiteKeyWidth;
  }

  function isWhiteKey(key) {
    const pos = regions.getPositionWithinRegion(key);
    return !!(pos && !pos.isBlack);
  }

  function computeFilledWindow(centerKey) {
    const whiteW = whiteKeyWidth();
    const available = (els.pianoScroll && els.pianoScroll.clientWidth)
      ? els.pianoScroll.clientWidth
      : Math.max(320, window.innerWidth - 40);
    const targetWhites = Math.max(12, Math.floor(available / whiteW));
    const center = Math.max(1, Math.min(88, Math.round(centerKey) || 40));

    let start = center;
    let end = center;
    let whites = isWhiteKey(start) ? 1 : 0;

    while (whites < targetWhites && (start > 1 || end < 88)) {
      const startDist = start > 1 ? (center - (start - 1)) : Infinity;
      const endDist = end < 88 ? ((end + 1) - center) : Infinity;
      if (startDist <= endDist) {
        start -= 1;
        if (isWhiteKey(start)) whites += 1;
      } else {
        end += 1;
        if (isWhiteKey(end)) whites += 1;
      }
    }

    return { startKey: start, endKey: end };
  }

  function computeLocalWindow() {
    return { startKey: 1, endKey: 88 };
  }

  function renderLocalStage() {
    if (!els.localPiano || !els.noteLane || !els.landmarkStrip) return;

    const win = computeLocalWindow();
    State.localWindow = win;

    const cur = currentFlatEvent();
    const nxt = upcomingFlatEvent(1);
    const expectedKeys = new Set(cur && !cur.isRest ? cur.allKeys : []);

    const isNarrow = window.innerWidth <= 640;
    const whiteW = isNarrow ? 32 : Config.whiteKeyWidth;
    const blackW = isNarrow ? 20 : Config.blackKeyWidth;

    let whiteIdx = 0;
    let whitesHtml = "";
    let blacksHtml = "";
    State.keyPositions.clear();

    const visibleRegions = [];
    let currentRegId = null;
    let segStartKey = null;

    for (let k = win.startKey; k <= win.endKey; k++) {
      const reg = regions.getRegionForPianoKey(k);
      if (reg && reg.id !== currentRegId) {
        if (currentRegId !== null) {
          visibleRegions.push({ regionId: currentRegId, start: segStartKey, end: k - 1 });
        }
        currentRegId = reg.id;
        segStartKey = k;
      }

      const pos = regions.getPositionWithinRegion(k);
      const isBlack = pos ? pos.isBlack : false;
      const isC = pos ? pos.name === "C" : false;
      const isMiddleC = k === 40;

      const isPressed = State.currentlyPressedKeys.has(k);
      const isExpected = expectedKeys.has(k);
      const regColor = reg ? reg.color : "#888";
      const regInk = reg ? reg.textInk : "#fff";
      const regName = reg ? reg.name : "";

      let keyClasses = "lpk " + (isBlack ? "lpk-b" : "lpk-w");
      if (isC) keyClasses += " is-c";
      if (isMiddleC) keyClasses += " is-middle-c";
      if (isPressed) keyClasses += " is-pressed";
      if (isExpected) keyClasses += " is-expected";

      const keyStyle = "--reg-color:" + regColor + "; --reg-ink:" + regInk + ";";
      const keyTitle = "Key " + k + (pos ? " (" + pos.name + ")" : "") + (regName ? " · " + regName : "");
      const numHtml = '<span class="lpk-num">' + k + "</span>";

      if (isBlack) {
        const left = whiteIdx * whiteW - blackW / 2;
        const center = left + blackW / 2;
        State.keyPositions.set(k, { leftPx: left, centerPx: center, isBlack: true });
        blacksHtml +=
          '<div class="' + keyClasses + '" data-key="' + k + '" style="' + keyStyle + "left:" + left + 'px;" title="' + keyTitle + '">' +
            numHtml +
          "</div>";
      } else {
        const left = whiteIdx * whiteW;
        const center = left + whiteW / 2;
        State.keyPositions.set(k, { leftPx: left, centerPx: center, isBlack: false });
        whitesHtml +=
          '<div class="' + keyClasses + '" data-key="' + k + '" style="' + keyStyle + '" title="' + keyTitle + '">' +
            numHtml +
          "</div>";
        whiteIdx++;
      }
    }

    if (currentRegId !== null) {
      visibleRegions.push({ regionId: currentRegId, start: segStartKey, end: win.endKey });
    }

    const totalWidth = whiteIdx * whiteW;
    if (els.localStageInner) els.localStageInner.style.width = totalWidth + "px";
    els.localPiano.style.width = totalWidth + "px";
    els.localPiano.innerHTML = whitesHtml + blacksHtml;

    let stripHtml = "";
    visibleRegions.forEach(function (seg) {
      const reg = regions.PIANO_REGIONS.find(function (r) { return r.id === seg.regionId; });
      if (!reg) return;
      const startPos = State.keyPositions.get(seg.start);
      const endPos = State.keyPositions.get(seg.end);
      if (startPos && endPos) {
        const segLeft = startPos.leftPx;
        const segRight = endPos.leftPx + (endPos.isBlack ? blackW : whiteW);
        const segWidth = Math.max(1, segRight - segLeft);
        stripHtml +=
          '<div class="landmark-segment" style="--seg-color:' + reg.color + '; position:absolute; left:' + segLeft + 'px; width:' + segWidth + 'px;" title="' + reg.name + ' (' + seg.start + '–' + seg.end + ')">' +
          "</div>";
      }
    });
    els.landmarkStrip.innerHTML = stripHtml;

    renderNoteLane(cur, nxt, totalWidth);
  }

  function centerStageOnKeys(keys, instant) {
    const scroll = els.pianoScroll;
    if (!scroll) return;

    const keyList = [];
    if (keys && typeof keys.forEach === "function") {
      keys.forEach(function (k) { keyList.push(k); });
    }

    let min = Infinity;
    let max = -Infinity;
    keyList.forEach(function (k) {
      const pos = State.keyPositions.get(k);
      if (!pos) return;
      if (pos.centerPx < min) min = pos.centerPx;
      if (pos.centerPx > max) max = pos.centerPx;
    });

    if (!keyList.length || min === Infinity) return;

    const innerWidth = els.localStageInner ? els.localStageInner.offsetWidth : 0;
    if (innerWidth <= scroll.clientWidth) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const targetCenter = (min + max) / 2;
    const left = Math.max(0, Math.min(innerWidth - scroll.clientWidth, targetCenter - scroll.clientWidth / 2));
    if (Math.abs(scroll.scrollLeft - left) < 8) return;
    scroll.scrollTo({ left: left, behavior: (reduce || instant) ? "auto" : "smooth" });
  }

  function keysAreInView(keys) {
    const scroll = els.pianoScroll;
    if (!scroll || !keys || !keys.length) return true;
    let min = Infinity;
    let max = -Infinity;
    keys.forEach(function (k) {
      const pos = State.keyPositions.get(k);
      if (!pos) return;
      if (pos.centerPx < min) min = pos.centerPx;
      if (pos.centerPx > max) max = pos.centerPx;
    });
    if (min === Infinity) return true;
    const pad = 48;
    const viewLeft = scroll.scrollLeft;
    const viewRight = viewLeft + scroll.clientWidth;
    return min >= viewLeft + pad && max <= viewRight - pad;
  }

  function keysToFollow() {
    const cur = currentFlatEvent();
    if (cur && !cur.isRest && cur.allKeys.length) return cur.allKeys.slice();
    const start = State.currentIndex;
    const end = State.loop ? State.loop.end : State.flatEvents.length - 1;
    for (let i = start; i <= end; i++) {
      const ev = State.flatEvents[i];
      if (ev && !ev.isRest && ev.allKeys.length) return ev.allKeys.slice();
    }
    return [40];
  }

  function bringCurrentKeysIntoView() {
    const keys = keysToFollow();
    if (keysAreInView(keys)) return;
    centerStageOnKeys(keys);
  }

  function phraseBarAnchorEl(barNum) {
    if (!els.phraseScroll || barNum == null) return null;
    const br = els.phraseScroll.querySelector('.phrase-bar-break[data-bar="' + barNum + '"]');
    if (br) return br;
    return els.phraseScroll.querySelector('.phrase-row[data-bar="' + barNum + '"]');
  }

  function scrollPhraseNowRowIntoView() {
    if (!els.phraseScroll) return;
    if (State.lastPhraseScrollIndex === State.currentIndex) return;

    const cur = currentFlatEvent();
    const barNum = cur ? cur.barNum : null;
    const now =
      els.phraseScroll.querySelector(".phrase-row.is-now") ||
      phraseBarAnchorEl(barNum);
    if (!now) return;

    const barChanged = State.lastPhraseScrollBar !== barNum;
    State.lastPhraseScrollIndex = State.currentIndex;
    State.lastPhraseScrollBar = barNum;

    const scroller = els.phraseScroll;
    const scrollRect = scroller.getBoundingClientRect();
    const pad = 20;
    const slack = 24;
    const anchor = phraseBarAnchorEl(barNum) || now;
    const offsetTop = function (el) {
      return el.getBoundingClientRect().top - scrollRect.top + scroller.scrollTop;
    };

    const nowTop = offsetTop(now);
    const nowBottom = nowTop + now.offsetHeight;
    const viewTop = scroller.scrollTop;
    const viewBottom = viewTop + scroller.clientHeight;
    const nowClipped = nowTop < viewTop + pad || nowBottom > viewBottom - pad;
    if (!barChanged && !nowClipped) return;

    const barDesired = Math.max(0, offsetTop(anchor) - pad);
    const keepNowVisible = Math.max(0, nowBottom - scroller.clientHeight + pad);
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const target = Math.min(maxScroll, Math.max(barDesired, keepNowVisible));

    if (Math.abs(scroller.scrollTop - target) < slack) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({
      top: target,
      left: scroller.scrollLeft,
      behavior: reduce ? "auto" : "smooth",
    });
  }

  function renderNoteLane(cur, nxt, totalWidth) {
    if (!els.noteLane) return;
    els.noteLane.style.width = totalWidth + "px";

    if (!cur) {
      els.noteLane.innerHTML = "";
      return;
    }

    if (cur.isRest) {
      els.noteLane.innerHTML = '<div class="rest-banner">Rest · Space or tap Next to continue</div>';
      return;
    }

    let html = "";
    const curL = cur.keysL || [];
    const curR = cur.keysR || [];

    curL.forEach(function (k) {
      const pos = State.keyPositions.get(k);
      if (!pos) return;
      const isSatisfied = State.playedKeys.has(k);
      html +=
        '<div class="note-target is-lh is-current' + (isSatisfied ? " is-satisfied" : "") + '" ' +
        'data-target-key="' + k + '" style="left:' + pos.centerPx + 'px;">' +
          "<span>L</span>" +
        "</div>";
    });

    curR.forEach(function (k) {
      const pos = State.keyPositions.get(k);
      if (!pos) return;
      const isSatisfied = State.playedKeys.has(k);
      html +=
        '<div class="note-target is-rh is-current' + (isSatisfied ? " is-satisfied" : "") + '" ' +
        'data-target-key="' + k + '" style="left:' + pos.centerPx + 'px;">' +
          "<span>R</span>" +
        "</div>";
    });

    if (nxt && !nxt.isRest) {
      const nxtL = nxt.keysL || [];
      const nxtR = nxt.keysR || [];

      nxtL.forEach(function (k) {
        const pos = State.keyPositions.get(k);
        if (!pos) return;
        html +=
          '<div class="note-target is-lh is-upcoming" style="left:' + pos.centerPx + 'px;" title="Upcoming Left Hand note">' +
            "<span>L</span>" +
          "</div>";
      });

      nxtR.forEach(function (k) {
        const pos = State.keyPositions.get(k);
        if (!pos) return;
        html +=
          '<div class="note-target is-rh is-upcoming" style="left:' + pos.centerPx + 'px;" title="Upcoming Right Hand note">' +
            "<span>R</span>" +
          "</div>";
      });
    }

    els.noteLane.innerHTML = html;
  }

  function eventHasKey(ev, key) {
    if (!ev) return false;
    return ev.keysL.indexOf(key) !== -1 || ev.keysR.indexOf(key) !== -1;
  }

  function collectLookaheadRows() {
    const rows = [];
    let endIndex = State.currentIndex;
    for (let i = 0; i < State.flatEvents.length; i++) {
      const ev = State.flatEvents[i];
      if (ev && !ev.isRest) {
        rows.push({ event: ev, index: i });
      }
      endIndex = i;
    }
    return { rows: rows, endIndex: endIndex };
  }

  function collectLoopRows() {
    const rows = [];
    if (!State.loop) return { rows: rows, endIndex: State.currentIndex };
    for (let i = State.loop.start; i <= State.loop.end; i++) {
      const ev = State.flatEvents[i];
      if (ev && !ev.isRest) {
        rows.push({ event: ev, index: i });
      }
    }
    return { rows: rows, endIndex: State.loop.end };
  }

  function collectPhraseRows() {
    return collectLookaheadRows();
  }

  function lastBarNum() {
    if (!State.flatEvents.length) return 1;
    return State.flatEvents[State.flatEvents.length - 1].barNum;
  }

  function currentBarNum() {
    const cur = currentFlatEvent();
    return cur ? cur.barNum : 1;
  }

  function selectionBarNum() {
    if (!State.selection) return null;
    if (State.selection.type === "bar") return State.selection.barNum;
    const ev = State.flatEvents[State.selection.index];
    return ev ? ev.barNum : null;
  }

  function selectionStepEvent() {
    if (!State.selection || State.selection.type !== "step") return null;
    return State.flatEvents[State.selection.index] || null;
  }

  function isStepSelected(index) {
    return !!(State.selection && State.selection.type === "step" && State.selection.index === index);
  }

  function isBarSelected(barNum) {
    return !!(State.selection && State.selection.type === "bar" && State.selection.barNum === barNum);
  }

  function loopAnchorBar() {
    if (State.loop) {
      const ev = State.flatEvents[State.loop.start];
      if (ev) return ev.barNum;
    }
    return selectionBarNum() || currentBarNum();
  }

  function loopStartIndex() {
    if (State.selection) {
      if (State.selection.type === "step") {
        const i = State.selection.index;
        if (i >= 0 && i < State.flatEvents.length) return i;
      }
      if (State.selection.type === "bar") {
        const i = firstIndexForBar(State.selection.barNum);
        if (i >= 0) return i;
      }
    }
    return firstIndexForBar(currentBarNum());
  }

  function maxLoopBarsFrom(startBar) {
    return Math.max(1, lastBarNum() - startBar + 1);
  }

  function clampLoopBarCount() {
    const max = maxLoopBarsFrom(loopAnchorBar());
    State.loopBarCount = Math.max(1, Math.min(max, State.loopBarCount || 1));
    return State.loopBarCount;
  }

  function firstIndexForBar(barNum) {
    for (let i = 0; i < State.flatEvents.length; i++) {
      if (State.flatEvents[i].barNum === barNum) return i;
    }
    return -1;
  }

  function lastIndexForBar(barNum) {
    for (let i = State.flatEvents.length - 1; i >= 0; i--) {
      if (State.flatEvents[i].barNum === barNum) return i;
    }
    return -1;
  }

  function applyLoopFromIndex(startIndex, count) {
    if (!State.flatEvents.length) return;
    if (startIndex < 0 || startIndex >= State.flatEvents.length) return;
    const startEv = State.flatEvents[startIndex];
    const startBar = startEv.barNum;
    const max = maxLoopBarsFrom(startBar);
    const n = Math.max(1, Math.min(max, count || 1));
    const endBar = startBar + n - 1;
    const end = lastIndexForBar(endBar);
    if (end < startIndex) return;
    State.loopBarCount = n;
    State.loop = { start: startIndex, end: end };
    if (State.currentIndex < startIndex || State.currentIndex > end) {
      if (State.practiceAdvanceTimer !== null) {
        clearTimeout(State.practiceAdvanceTimer);
        State.practiceAdvanceTimer = null;
      }
      State.currentIndex = startIndex;
      State.playedKeys.clear();
    }
    renderUI();
  }

  function loopBarCountLabel(count) {
    return count === 1 ? "1 bar" : count + " bars";
  }

  function phraseStatusText(rows) {
    if (State.loop) {
      const startEv = State.flatEvents[State.loop.start];
      const endEv = State.flatEvents[State.loop.end];
      const a = startEv ? startEv.barNum : "?";
      const b = endEv ? endEv.barNum : "?";
      if (a === b) return "Looping bar " + a;
      return "Looping bars " + a + "–" + b;
    }
    if (State.selection && State.selection.type === "bar") {
      return "Bar " + State.selection.barNum + " selected";
    }
    const selected = selectionStepEvent();
    if (selected) {
      return "Bar " + selected.barNum + " · step " + selected.eventNum + " selected";
    }
    if (!rows.length) return "No playable steps";
    return rows.length + (rows.length === 1 ? " step" : " steps");
  }

  function loopActionLabel() {
    if (State.selection && State.selection.type === "bar") {
      return "Loop from bar " + State.selection.barNum;
    }
    const selected = selectionStepEvent();
    if (selected) {
      return "Loop from bar " + selected.barNum + ", step " + selected.eventNum;
    }
    return "Loop from bar " + currentBarNum();
  }

  function updatePhraseToolbar(rows) {
    const looping = !!State.loop;
    const count = clampLoopBarCount();
    const max = maxLoopBarsFrom(loopAnchorBar());
    if (els.btnLoopAgain) els.btnLoopAgain.disabled = !looping;
    if (els.btnLoopClear) els.btnLoopClear.disabled = !looping;
    if (els.btnLoopThese) {
      els.btnLoopThese.disabled = State.flatEvents.length === 0;
      const label = loopActionLabel();
      els.btnLoopThese.title = label;
      els.btnLoopThese.setAttribute("aria-label", label);
    }
    if (els.btnLoopMinus) els.btnLoopMinus.disabled = count <= 1;
    if (els.btnLoopPlus) els.btnLoopPlus.disabled = count >= max;
    if (els.loopBarCount) els.loopBarCount.textContent = loopBarCountLabel(count);
    if (els.phraseStatus) els.phraseStatus.textContent = phraseStatusText(rows);
  }

  function syncPhraseScrollFromPiano() {
    if (!els.phraseScroll || !els.pianoScroll) return;
    if (syncingPhraseScroll) return;
    const x = els.pianoScroll.scrollLeft;
    lastPianoScrollX = x;
    if (els.phraseScroll.scrollLeft === x) {
      lastPhraseScrollX = x;
      return;
    }
    syncingPhraseScroll = true;
    els.phraseScroll.scrollLeft = x;
    lastPhraseScrollX = els.phraseScroll.scrollLeft;
    syncingPhraseScroll = false;
  }

  function syncPianoScrollFromPhrase() {
    if (!els.phraseScroll || !els.pianoScroll) return;
    if (syncingPhraseScroll) return;
    const x = els.phraseScroll.scrollLeft;
    if (x === lastPhraseScrollX) return;
    lastPhraseScrollX = x;
    syncingPhraseScroll = true;
    els.pianoScroll.scrollLeft = x;
    lastPianoScrollX = els.pianoScroll.scrollLeft;
    syncingPhraseScroll = false;
  }

  function phraseBarBreakHtml(barNum, tabIndex) {
    const selected = isBarSelected(barNum);
    return (
      '<div class="phrase-bar-break' + (selected ? " is-selected" : "") + '" ' +
        'role="option" tabindex="' + tabIndex + '" ' +
        'id="phrase-bar-' + barNum + '" ' +
        'data-bar="' + barNum + '" ' +
        'aria-label="Bar ' + barNum + '" ' +
        'aria-selected="' + (selected ? "true" : "false") + '">' +
        '<span class="phrase-bar-break-label">Bar ' + barNum + "</span>" +
      "</div>"
    );
  }

  function optionTabIndex(isSelected, assigned) {
    if (State.selection) return isSelected ? 0 : -1;
    if (!assigned.value) {
      assigned.value = true;
      return 0;
    }
    return -1;
  }

  function focusedPhraseTarget() {
    const active = document.activeElement;
    if (!active || !els.phraseInner || !els.phraseInner.contains(active)) return null;
    if (active.classList.contains("phrase-bar-break")) {
      return { type: "bar", barNum: Number(active.getAttribute("data-bar")) };
    }
    if (active.classList.contains("phrase-row")) {
      return { type: "step", index: Number(active.getAttribute("data-event-index")) };
    }
    return null;
  }

  function restorePhraseFocus(target) {
    if (!target || !els.phraseInner) return;
    const el = target.type === "bar"
      ? els.phraseInner.querySelector('.phrase-bar-break[data-bar="' + target.barNum + '"]')
      : els.phraseInner.querySelector('.phrase-row[data-event-index="' + target.index + '"]');
    if (el) el.focus({ preventScroll: true });
    return el;
  }

  function scrollPhraseOptionVertically(el) {
    const scroller = els.phraseScroll;
    if (!scroller || !el) return;
    const sRect = scroller.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const pad = 8;
    if (eRect.top < sRect.top + pad) {
      scroller.scrollTop -= sRect.top + pad - eRect.top;
    } else if (eRect.bottom > sRect.bottom - pad) {
      scroller.scrollTop += eRect.bottom - (sRect.bottom - pad);
    }
  }

  function phraseOptions() {
    if (!els.phraseInner) return [];
    return Array.prototype.slice.call(
      els.phraseInner.querySelectorAll('.phrase-row[role="option"], .phrase-bar-break[role="option"]')
    );
  }

  function setSelection(next, options) {
    const prev = State.selection;
    const same = prev && next && prev.type === next.type &&
      (next.type === "step" ? prev.index === next.index : prev.barNum === next.barNum);
    if (options && options.toggle && same) {
      State.selection = null;
    } else {
      State.selection = next;
    }
    renderPhrasePanel();
  }

  function selectPhraseElement(el, options) {
    if (!el || !els.phraseInner || !els.phraseInner.contains(el)) return;
    let target = null;
    if (el.classList.contains("phrase-bar-break")) {
      const barNum = Number(el.getAttribute("data-bar"));
      if (!Number.isFinite(barNum)) return;
      target = { type: "bar", barNum: barNum };
      setSelection(target, options);
    } else if (el.classList.contains("phrase-row")) {
      const index = Number(el.getAttribute("data-event-index"));
      if (!Number.isFinite(index)) return;
      target = { type: "step", index: index };
      setSelection(target, options);
    }
    if (target) {
      const focused = restorePhraseFocus(target);
      scrollPhraseOptionVertically(focused);
    }
  }

  function movePhraseSelection(delta) {
    const options = phraseOptions();
    if (!options.length) return;
    const active = document.activeElement;
    let from = options.indexOf(active);
    if (from < 0) {
      const selected = options.findIndex(function (el) {
        return el.getAttribute("aria-selected") === "true";
      });
      from = selected >= 0 ? selected : 0;
    }
    const next = options[Math.max(0, Math.min(options.length - 1, from + delta))];
    if (!next) return;
    selectPhraseElement(next);
  }

  function appendPhraseKeyMarks(row, rowIndex, rows, handClass, keys) {
    const prev = rowIndex > 0 ? rows[rowIndex - 1] : null;
    const next = rowIndex < rows.length - 1 ? rows[rowIndex + 1] : null;
    let html = "";
    keys.forEach(function (k) {
      const pos = State.keyPositions.get(k);
      if (!pos) return;
      const inPrev = eventHasKey(prev && prev.event, k);
      const inNext = eventHasKey(next && next.event, k);
      if (inPrev || inNext) {
        html += '<div class="phrase-hold ' + handClass + '" style="left:' + pos.centerPx + 'px;"></div>';
      }
      if (inPrev) {
        html += '<div class="phrase-mark ' + handClass + ' is-hold" style="left:' + pos.centerPx + 'px;"></div>';
      } else {
        html +=
          '<div class="phrase-mark ' + handClass + ' is-head" style="left:' + pos.centerPx + 'px;">' +
            "<span>" + (handClass === "is-lh" ? "L" : "R") + "</span>" +
          "</div>";
      }
    });
    return html;
  }

  function renderPhrasePanel() {
    if (!els.phraseInner) return;

    const totalWidth = els.localStageInner ? els.localStageInner.offsetWidth : 0;
    els.phraseInner.style.width = totalWidth ? totalWidth + "px" : "";

    const collected = collectPhraseRows();
    const rows = collected.rows;
    updatePhraseToolbar(rows);

    if (!rows.length) {
      const empty = "No playable steps";
      els.phraseInner.innerHTML = '<div class="phrase-empty">' + empty + "</div>";
      els.phraseInner.removeAttribute("aria-activedescendant");
      syncPhraseScrollFromPiano();
      return;
    }

    const restore = focusedPhraseTarget();
    const tabAssigned = { value: false };
    let html = "";
    rows.forEach(function (row, rowIndex) {
      let stateClass = "is-future";
      if (row.index < State.currentIndex) stateClass = "is-past";
      else if (row.index === State.currentIndex) stateClass = "is-now";
      if (State.loop && (row.index < State.loop.start || row.index > State.loop.end)) {
        stateClass += " is-outside";
      }

      const barNum = row.event.barNum;
      const prev = rows[rowIndex - 1];
      const next = rows[rowIndex + 1];
      const nextBarNum = next ? next.event.barNum : null;
      const isBarStart = !prev || prev.event.barNum !== barNum;
      const isBarEnd = nextBarNum !== null && nextBarNum !== barNum;
      if (isBarStart) stateClass += " is-bar-start";
      if (isBarEnd) stateClass += " is-bar-end";
      if (isStepSelected(row.index)) stateClass += " is-selected";
      if (isBarSelected(barNum)) stateClass += " is-in-selected-bar";

      if (rowIndex === 0) {
        html += phraseBarBreakHtml(barNum, optionTabIndex(isBarSelected(barNum), tabAssigned));
      }

      html +=
        '<div class="phrase-row ' + stateClass + '" role="option" tabindex="' + optionTabIndex(isStepSelected(row.index), tabAssigned) + '" ' +
          'id="phrase-step-' + row.index + '" ' +
          'data-event-index="' + row.index + '" data-bar="' + barNum + '" ' +
          'aria-label="Bar ' + barNum + ', step ' + row.event.eventNum + '" ' +
          'aria-selected="' + (isStepSelected(row.index) ? "true" : "false") + '">';
      html += appendPhraseKeyMarks(row, rowIndex, rows, "is-lh", row.event.keysL);
      html += appendPhraseKeyMarks(row, rowIndex, rows, "is-rh", row.event.keysR);
      html += "</div>";

      if (isBarEnd) {
        html += phraseBarBreakHtml(nextBarNum, optionTabIndex(isBarSelected(nextBarNum), tabAssigned));
      }
    });

    const selectedId = State.selection
      ? (State.selection.type === "bar"
        ? "phrase-bar-" + State.selection.barNum
        : "phrase-step-" + State.selection.index)
      : "";
    if (selectedId) {
      els.phraseInner.setAttribute("aria-activedescendant", selectedId);
    } else {
      els.phraseInner.removeAttribute("aria-activedescendant");
    }

    els.phraseInner.innerHTML = html;
    if (!els.phraseInner.querySelector('[tabindex="0"]')) {
      const first = els.phraseInner.querySelector('[role="option"]');
      if (first) first.setAttribute("tabindex", "0");
    }
    restorePhraseFocus(restore);
    syncPhraseScrollFromPiano();
    scrollPhraseNowRowIntoView();
  }

  function loopThese() {
    applyLoopFromIndex(loopStartIndex(), clampLoopBarCount());
  }

  function adjustLoopBars(delta) {
    const next = clampLoopBarCount() + delta;
    const max = maxLoopBarsFrom(loopAnchorBar());
    const count = Math.max(1, Math.min(max, next));
    State.loopBarCount = count;
    if (State.loop) {
      applyLoopFromIndex(State.loop.start, count);
      return;
    }
    updatePhraseToolbar(collectPhraseRows().rows);
  }

  function loopAgain() {
    if (!State.loop) return;
    if (State.practiceAdvanceTimer !== null) {
      clearTimeout(State.practiceAdvanceTimer);
      State.practiceAdvanceTimer = null;
    }
    State.currentIndex = State.loop.start;
    State.playedKeys.clear();
    renderUI();
    const cur = currentFlatEvent();
    if (cur && cur.isRest) {
      State.practiceAdvanceTimer = setTimeout(function () {
        State.practiceAdvanceTimer = null;
        if (currentFlatEvent() === cur) advanceEvent(1);
      }, 700);
    }
  }

  function clearLoop() {
    State.loop = null;
    renderUI();
  }

  function applyShowKeyNumbers(on) {
    State.showKeyNumbers = !!on;
    document.body.classList.toggle("show-key-numbers", State.showKeyNumbers);
    if (els.btnKeyNumbers) {
      els.btnKeyNumbers.setAttribute("aria-pressed", State.showKeyNumbers ? "true" : "false");
      els.btnKeyNumbers.textContent = State.showKeyNumbers ? "Hide key numbers" : "Show key numbers";
    }
    try {
      localStorage.setItem(KEY_NUMBERS_STORE, State.showKeyNumbers ? "1" : "0");
    } catch (err) {
      // Ignore storage failures; the toggle still works for this session.
    }
  }

  function loadShowKeyNumbers() {
    try {
      return localStorage.getItem(KEY_NUMBERS_STORE) === "1";
    } catch (err) {
      return false;
    }
  }

  function pieceMetaById(id) {
    return PIECES.find(function (p) { return p.id === id; }) || PIECES[0];
  }

  function loadSelectedPieceId() {
    try {
      const saved = localStorage.getItem(SELECTED_PIECE_STORE);
      if (saved && pieceMetaById(saved).id === saved) return saved;
    } catch (err) {
      // Ignore storage failures; fall back to the first catalog piece.
    }
    return PIECES[0].id;
  }

  function saveSelectedPieceId(id) {
    try {
      localStorage.setItem(SELECTED_PIECE_STORE, id);
    } catch (err) {
      // Ignore storage failures; the choice still applies for this session.
    }
  }

  function loadPieceJson(src) {
    return fetch(encodeURI(src)).then(function (response) {
      if (!response.ok) {
        throw new Error("Could not load " + src);
      }
      return response.json();
    });
  }

  function ensurePieceLoaded(meta) {
    if (pieceCache[meta.id]) return Promise.resolve(pieceCache[meta.id]);
    return loadPieceJson(meta.src).then(function (piece) {
      if (!piece) throw new Error("Score data is missing for " + meta.label + ".");
      pieceCache[meta.id] = piece;
      return piece;
    });
  }

  function barCountForPiece(piece) {
    const bars = piece && piece.bars;
    if (!bars || !bars.length) return 0;
    const last = bars[bars.length - 1];
    return last && last.n ? last.n : bars.length;
  }

  function updatePieceChrome(piece) {
    const title = (piece && piece.title) || "Practice";
    const composer = (piece && piece.composer) || "";
    const subtitle = (piece && piece.subtitle) || "Practice";
    if (els.pageTitle) els.pageTitle.textContent = title;
    if (els.pageSubtitle) {
      els.pageSubtitle.textContent = composer ? (composer + " · " + subtitle) : subtitle;
    }
    if (els.barTotal) els.barTotal.textContent = String(barCountForPiece(piece));
    document.title = title + " · Practice";
  }

  function populatePieceSelect() {
    if (!els.pieceSelect) return;
    els.pieceSelect.innerHTML = "";
    PIECES.forEach(function (meta) {
      const opt = document.createElement("option");
      opt.value = meta.id;
      opt.textContent = meta.label;
      els.pieceSelect.appendChild(opt);
    });
  }

  function applyPiece(piece) {
    State.piece = piece;
    window.selectedPiece = piece;
    State.flatEvents = buildFlatEvents(piece);
    if (els.btnPrev) els.btnPrev.disabled = false;
    if (els.btnNext) els.btnNext.disabled = false;
    if (els.btnReset) els.btnReset.disabled = false;
    updatePieceChrome(piece);
    restartPractice();
  }

  let pieceLoadSeq = 0;

  function selectPiece(id) {
    const meta = pieceMetaById(id);
    const seq = ++pieceLoadSeq;
    if (els.pieceSelect) {
      els.pieceSelect.value = meta.id;
      els.pieceSelect.disabled = true;
    }
    if (els.pageSubtitle) els.pageSubtitle.textContent = "Loading…";

    return ensurePieceLoaded(meta).then(function (piece) {
      if (seq !== pieceLoadSeq) return;
      applyPiece(piece);
      saveSelectedPieceId(meta.id);
    }).catch(function (err) {
      if (seq !== pieceLoadSeq) return;
      console.error(err);
      if (els.pageSubtitle) els.pageSubtitle.textContent = "Could not load this piece";
      showFatalError(err.message || "Unable to load score data.");
    }).then(function () {
      if (seq !== pieceLoadSeq) return;
      if (els.pieceSelect) els.pieceSelect.disabled = false;
    });
  }

  function updateHeaderInfo() {
    const cur = currentFlatEvent();
    if (!cur) return;
    if (els.barNum) els.barNum.textContent = String(cur.barNum);
    if (els.stepNum) els.stepNum.textContent = String(cur.eventNum);
    if (els.stepTotal) els.stepTotal.textContent = String(cur.totalInBar);
    const looping = !!State.loop;
    if (els.btnPrev) {
      els.btnPrev.disabled = looping
        ? State.currentIndex <= State.loop.start
        : State.currentIndex <= 0;
    }
    if (els.btnNext) {
      els.btnNext.disabled = looping
        ? false
        : State.currentIndex >= State.flatEvents.length - 1;
    }
  }

  function restartPractice() {
    if (State.practiceAdvanceTimer !== null) {
      clearTimeout(State.practiceAdvanceTimer);
      State.practiceAdvanceTimer = null;
    }
    State.currentIndex = 0;
    State.playedKeys.clear();
    State.loop = null;
    State.selection = null;
    State.homePianoOnRender = true;
    State.lastPhraseScrollIndex = null;
    State.lastPhraseScrollBar = null;
    renderUI();
  }

  function advanceEvent(delta) {
    if (State.practiceAdvanceTimer !== null) {
      clearTimeout(State.practiceAdvanceTimer);
      State.practiceAdvanceTimer = null;
    }

    let nextIdx;
    let wrapping = false;
    if (State.loop && delta > 0) {
      nextIdx = State.currentIndex + delta;
      if (nextIdx > State.loop.end) {
        nextIdx = State.loop.start;
        wrapping = true;
      } else {
        nextIdx = Math.min(State.loop.end, nextIdx);
      }
    } else if (State.loop && delta < 0) {
      nextIdx = Math.max(State.loop.start, State.currentIndex + delta);
    } else {
      nextIdx = Math.max(0, Math.min(State.flatEvents.length - 1, State.currentIndex + delta));
    }

    if (nextIdx === State.currentIndex && !wrapping) return;

    State.currentIndex = nextIdx;
    State.playedKeys.clear();

    renderUI();

    const cur = currentFlatEvent();
    if (cur && cur.isRest && delta > 0) {
      State.practiceAdvanceTimer = setTimeout(function () {
        State.practiceAdvanceTimer = null;
        if (currentFlatEvent() === cur) advanceEvent(1);
      }, 700);
    }
  }

  function allExpectedKeysHeld(expectedKeys) {
    if (!expectedKeys || expectedKeys.size === 0) return false;
    let allHeld = true;
    expectedKeys.forEach(function (k) {
      if (!State.currentlyPressedKeys.has(k)) allHeld = false;
    });
    return allHeld;
  }

  function handleKeyPress(key) {
    if (key < 1 || key > 88) return;
    WakeLock.request();
    State.currentlyPressedKeys.add(key);

    const cur = currentFlatEvent();
    if (!cur) return;

    const expectedKeys = new Set(cur.allKeys);

    if (expectedKeys.has(key) && allExpectedKeysHeld(expectedKeys)) {
      expectedKeys.forEach(function (k) {
        State.playedKeys.add(k);
      });
      renderUI();
      if (State.practiceAdvanceTimer !== null) clearTimeout(State.practiceAdvanceTimer);
      const completedIndex = State.currentIndex;
      State.practiceAdvanceTimer = setTimeout(function () {
        State.practiceAdvanceTimer = null;
        if (State.currentIndex === completedIndex) advanceEvent(1);
      }, 160);
      return;
    }

    if (!expectedKeys.has(key)) {
      const keyEl = document.querySelector('.lpk[data-key="' + key + '"]');
      if (keyEl) {
        keyEl.classList.add("is-wrong");
        setTimeout(function () {
          keyEl.classList.remove("is-wrong");
        }, 260);
      }
    }

    renderUI();
  }

  function handleKeyRelease(key) {
    if (key < 1 || key > 88) return;
    State.currentlyPressedKeys.delete(key);
    renderKeypressHighlights();
  }

  function renderKeypressHighlights() {
    document.querySelectorAll(".lpk[data-key]").forEach(function (el) {
      const k = Number(el.getAttribute("data-key"));
      el.classList.toggle("is-pressed", State.currentlyPressedKeys.has(k));
    });
  }

  const WakeLock = {
    async request() {
      if (!("wakeLock" in navigator) || State.wakeLock || document.visibilityState !== "visible") {
        return;
      }

      try {
        State.wakeLock = await navigator.wakeLock.request("screen");
        State.wakeLock.addEventListener("release", function () {
          State.wakeLock = null;
        });
      } catch (err) {
        State.wakeLock = null;
      }
    },

    handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        this.request();
      }
    },
  };

  function renderUI() {
    updateHeaderInfo();
    renderMinimap();
    renderLocalStage();
    renderPhrasePanel();
    requestAnimationFrame(function () {
      if (State.loop) {
        bringCurrentKeysIntoView();
      } else if (State.homePianoOnRender) {
        centerStageOnKeys([40], true);
        State.homePianoOnRender = false;
      }
      syncPhraseScrollFromPiano();
    });
  }

  const Midi = {
    preferPort: function (ports) {
      const list = Array.from(ports.values());
      if (!list.length) return null;
      const named = list.find(function (p) {
        return /piano|keyboard|keys|digital|roland|yamaha|casio|kawai|nord|midi/i.test(p.name || "");
      });
      return named || list[0];
    },

    bindInput: function (input) {
      if (this.currentInput) {
        this.currentInput.onmidimessage = null;
      }
      State.currentlyPressedKeys.clear();
      renderKeypressHighlights();
      this.currentInput = input || null;
      if (!this.currentInput) {
        State.selectedInputId = null;
        this.setStatus("none", "No MIDI input");
        return;
      }
      State.selectedInputId = this.currentInput.id;
      this.currentInput.onmidimessage = this.onMessage.bind(this);
      this.setStatus("ok", this.currentInput.name || "MIDI connected");
    },

    onMessage: function (event) {
      const data = event.data;
      if (!data || data.length < 2) return;
      const status = data[0] & 0xf0;
      const note = data[1];
      const velocity = data.length > 2 ? data[2] : 0;
      const key = regions.midiNoteToPianoKey(note);
      if (!key) return;

      if (status === 0x90 && velocity > 0) {
        handleKeyPress(key);
      } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
        handleKeyRelease(key);
      }
    },

    setStatus: function (status, text) {
      State.midiStatus = status;
      if (!els.midiChip) return;
      els.midiChip.textContent = text || status;
      els.midiChip.className = "midi-chip";
      if (status === "ok") els.midiChip.classList.add("is-ok");
      else if (status === "none" || status === "pending") els.midiChip.classList.add("is-warn");
      else if (status === "denied" || status === "unsupported") els.midiChip.classList.add("is-err");
    },

    refreshDevices: function () {
      if (!State.midiAccess || !els.midiSelect) return;
      const inputs = Array.from(State.midiAccess.inputs.values());
      els.midiSelect.innerHTML = "";

      if (!inputs.length) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No MIDI device";
        els.midiSelect.appendChild(opt);
        this.bindInput(null);
        return;
      }

      inputs.forEach(function (inp) {
        const opt = document.createElement("option");
        opt.value = inp.id;
        opt.textContent = inp.name || "MIDI Port " + inp.id;
        els.midiSelect.appendChild(opt);
      });

      const preferred = (State.selectedInputId && State.midiAccess.inputs.get(State.selectedInputId))
        || this.preferPort(State.midiAccess.inputs);
      if (preferred) {
        els.midiSelect.value = preferred.id;
        this.bindInput(preferred);
      }
    },

    connect: async function () {
      if (!navigator.requestMIDIAccess) {
        this.setStatus("unsupported", "Web MIDI not supported");
        return;
      }
      try {
        this.setStatus("pending", "Connecting MIDI…");
        State.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
        State.midiAccess.onstatechange = this.refreshDevices.bind(this);
        this.refreshDevices();
      } catch (err) {
        this.setStatus("denied", "MIDI permission denied");
      }
    },
  };

  function setupListeners() {
    document.addEventListener("visibilitychange", WakeLock.handleVisibilityChange.bind(WakeLock));

    window.addEventListener("resize", function () {
      renderLocalStage();
      renderPhrasePanel();
      if (State.loop) bringCurrentKeysIntoView();
      syncPhraseScrollFromPiano();
    });

    if (els.pianoScroll) {
      els.pianoScroll.addEventListener("scroll", syncPhraseScrollFromPiano);
    }
    if (els.phraseScroll) {
      els.phraseScroll.addEventListener("scroll", syncPianoScrollFromPhrase);
    }
    if (els.phraseInner) {
      els.phraseInner.addEventListener("click", function (e) {
        const option = e.target.closest('[role="option"]');
        if (!option || !els.phraseInner.contains(option)) return;
        selectPhraseElement(option, { toggle: true });
      });
      els.phraseInner.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          movePhraseSelection(1);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          movePhraseSelection(-1);
        } else if (e.key === "Home") {
          e.preventDefault();
          const options = phraseOptions();
          if (options[0]) selectPhraseElement(options[0]);
        } else if (e.key === "End") {
          e.preventDefault();
          const options = phraseOptions();
          if (options.length) selectPhraseElement(options[options.length - 1]);
        } else if (e.key === "Enter" || e.key === " ") {
          const option = e.target.closest('[role="option"]');
          if (!option || !els.phraseInner.contains(option)) return;
          e.preventDefault();
          selectPhraseElement(option, { toggle: true });
        } else if (e.key === "Escape" && State.selection) {
          e.preventDefault();
          State.selection = null;
          renderPhrasePanel();
        }
      });
    }

    if (els.btnLoopThese) {
      els.btnLoopThese.addEventListener("click", loopThese);
    }
    if (els.btnLoopMinus) {
      els.btnLoopMinus.addEventListener("click", function () {
        adjustLoopBars(-1);
      });
    }
    if (els.btnLoopPlus) {
      els.btnLoopPlus.addEventListener("click", function () {
        adjustLoopBars(1);
      });
    }
    if (els.btnLoopAgain) {
      els.btnLoopAgain.addEventListener("click", loopAgain);
    }
    if (els.btnLoopClear) {
      els.btnLoopClear.addEventListener("click", clearLoop);
    }

    if (els.btnPrev) els.btnPrev.addEventListener("click", function () {
      WakeLock.request();
      advanceEvent(-1);
    });
    if (els.btnNext) els.btnNext.addEventListener("click", function () {
      WakeLock.request();
      advanceEvent(1);
    });
    if (els.btnReset) {
      els.btnReset.addEventListener("click", function () {
        WakeLock.request();
        restartPractice();
      });
    }

    if (els.midiSelect) {
      els.midiSelect.addEventListener("change", function () {
        const id = els.midiSelect.value;
        if (!State.midiAccess || !id) {
          Midi.bindInput(null);
          return;
        }
        const input = State.midiAccess.inputs.get(id);
        Midi.bindInput(input);
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest("input, select, button, textarea, .phrase-inner")) return;

      if (e.key === " " || e.key === "ArrowRight" || e.key === "n" || e.key === "N") {
        e.preventDefault();
        WakeLock.request();
        advanceEvent(1);
      } else if (e.key === "ArrowLeft" || e.key === "Backspace" || e.key === "p" || e.key === "P") {
        e.preventDefault();
        WakeLock.request();
        advanceEvent(-1);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        WakeLock.request();
        restartPractice();
      }
    });

    if (els.localPiano) {
      els.localPiano.addEventListener("pointerdown", function (e) {
        const keyEl = e.target.closest(".lpk[data-key]");
        if (!keyEl) return;
        WakeLock.request();
        const key = Number(keyEl.getAttribute("data-key"));
        handleKeyPress(key);
      });

      window.addEventListener("pointerup", function () {
        if (State.currentlyPressedKeys.size > 0) {
          State.currentlyPressedKeys.forEach(function (k) { handleKeyRelease(k); });
          State.currentlyPressedKeys.clear();
        }
      });
    }

    if (els.btnKeyNumbers) {
      els.btnKeyNumbers.addEventListener("click", function () {
        applyShowKeyNumbers(!State.showKeyNumbers);
      });
    }

    if (els.pieceSelect) {
      els.pieceSelect.addEventListener("change", function () {
        selectPiece(els.pieceSelect.value);
      });
    }
  }

  function showFatalError(message) {
    if (els.noteLane) {
      els.noteLane.innerHTML = '<div class="rest-banner" role="alert">' + message + "</div>";
    }
    if (els.btnPrev) els.btnPrev.disabled = true;
    if (els.btnNext) els.btnNext.disabled = true;
    if (els.btnReset) els.btnReset.disabled = true;
  }

  function init() {
    applyShowKeyNumbers(loadShowKeyNumbers());
    populatePieceSelect();
    setupListeners();
    Midi.connect();
    selectPiece(loadSelectedPieceId());

    window.ClairDeLunePractice = {
      State: State,
      Config: Config,
      advanceEvent: advanceEvent,
      renderUI: renderUI,
      handleKeyPress: handleKeyPress,
      handleKeyRelease: handleKeyRelease,
      restartPractice: restartPractice,
      selectPiece: selectPiece,
    };
  }

  init();
})();
