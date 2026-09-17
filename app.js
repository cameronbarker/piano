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
  };

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
    return computeFilledWindow(40);
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
    centerStageOnKeys([40]);
  }

  function centerStageOnKeys(keys) {
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

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const innerWidth = els.localStageInner ? els.localStageInner.offsetWidth : 0;
    if (!keyList.length || min === Infinity || innerWidth <= scroll.clientWidth) {
      scroll.scrollLeft = 0;
      return;
    }

    const targetCenter = (min + max) / 2;
    const left = Math.max(0, targetCenter - scroll.clientWidth / 2);
    scroll.scrollTo({ left: left, behavior: reduce ? "auto" : "smooth" });
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
    if (els.btnPrev) els.btnPrev.disabled = State.currentIndex <= 0;
    if (els.btnNext) els.btnNext.disabled = State.currentIndex >= State.flatEvents.length - 1;
  }

  function restartPractice() {
    if (State.practiceAdvanceTimer !== null) {
      clearTimeout(State.practiceAdvanceTimer);
      State.practiceAdvanceTimer = null;
    }
    State.currentIndex = 0;
    State.playedKeys.clear();
    renderUI();
  }

  function advanceEvent(delta) {
    if (State.practiceAdvanceTimer !== null) {
      clearTimeout(State.practiceAdvanceTimer);
      State.practiceAdvanceTimer = null;
    }
    const nextIdx = Math.max(0, Math.min(State.flatEvents.length - 1, State.currentIndex + delta));
    if (nextIdx === State.currentIndex) return;

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

  function renderUI() {
    updateHeaderInfo();
    renderMinimap();
    renderLocalStage();
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
    window.addEventListener("resize", function () {
      renderLocalStage();
    });

    if (els.btnPrev) els.btnPrev.addEventListener("click", function () {
      advanceEvent(-1);
    });
    if (els.btnNext) els.btnNext.addEventListener("click", function () {
      advanceEvent(1);
    });
    if (els.btnReset) {
      els.btnReset.addEventListener("click", restartPractice);
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
      if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;

      if (e.key === " " || e.key === "ArrowRight" || e.key === "n" || e.key === "N") {
        e.preventDefault();
        advanceEvent(1);
      } else if (e.key === "ArrowLeft" || e.key === "Backspace" || e.key === "p" || e.key === "P") {
        e.preventDefault();
        advanceEvent(-1);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        restartPractice();
      }
    });

    if (els.localPiano) {
      els.localPiano.addEventListener("pointerdown", function (e) {
        const keyEl = e.target.closest(".lpk[data-key]");
        if (!keyEl) return;
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
