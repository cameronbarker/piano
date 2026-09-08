(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PianoGameEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_WINDOWS = { perfect: 50, good: 120, miss: 180 };

  function buildTimeline(piece) {
    if (!piece || !Array.isArray(piece.bars)) throw new Error("Piece must contain bars.");
    const tempo = Number(piece.tempo);
    if (!Number.isFinite(tempo) || tempo <= 0) throw new Error("Piece tempo must be positive.");

    const secondsPerBeat = 60 / tempo;
    const events = [];
    let beat = 0;

    piece.bars.forEach(function (bar, barIndex) {
      if (!bar || !Array.isArray(bar.events)) throw new Error("Invalid events in bar " + (barIndex + 1) + ".");
      bar.events.forEach(function (event, eventIndex) {
        const durationBeats = Number(event.w);
        if (!Number.isFinite(durationBeats) || durationBeats <= 0) {
          throw new Error("Invalid duration in bar " + bar.n + ", event " + (eventIndex + 1) + ".");
        }

        const notes = [];
        ["L", "R"].forEach(function (hand) {
          const keys = event[hand] || [];
          if (!Array.isArray(keys)) throw new Error("Invalid " + hand + " hand in bar " + bar.n + ".");
          keys.forEach(function (key) {
            if (!Number.isInteger(key) || key < 1 || key > 88) {
              throw new Error("Invalid piano key in bar " + bar.n + ", event " + (eventIndex + 1) + ".");
            }
            notes.push({
              id: events.length + ":" + hand + ":" + key,
              key: key,
              hand: hand,
              holdBeats: Math.max(0, Number(event[hand + "d"]) || durationBeats),
            });
          });
        });

        events.push({
          id: events.length,
          barIndex: barIndex,
          eventIndex: eventIndex,
          barNum: bar.n,
          eventNum: eventIndex + 1,
          totalInBar: bar.events.length,
          beatStart: beat,
          beatEnd: beat + durationBeats,
          timeMs: beat * secondsPerBeat * 1000,
          durationMs: durationBeats * secondsPerBeat * 1000,
          isRest: !!event.rest,
          notes: notes,
          source: event,
        });
        beat += durationBeats;
      });
    });

    return {
      tempo: tempo,
      secondsPerBeat: secondsPerBeat,
      durationBeats: beat,
      durationMs: beat * secondsPerBeat * 1000,
      events: events,
    };
  }

  function createSession(timeline) {
    const notes = [];
    timeline.events.forEach(function (event) {
      event.notes.forEach(function (note) {
        notes.push(Object.assign({}, note, {
          eventId: event.id,
          timeMs: event.timeMs,
          status: "pending",
          judgment: null,
          offsetMs: null,
        }));
      });
    });
    return {
      notes: notes,
      combo: 0,
      maxCombo: 0,
      hits: 0,
      misses: 0,
      score: 0,
      lastJudgment: null,
    };
  }

  function resetSession(session) {
    session.notes.forEach(function (note) {
      note.status = "pending";
      note.judgment = null;
      note.offsetMs = null;
    });
    session.combo = 0;
    session.maxCombo = 0;
    session.hits = 0;
    session.misses = 0;
    session.score = 0;
    session.lastJudgment = null;
    return session;
  }

  function markMisses(session, songTimeMs, windows) {
    const limits = Object.assign({}, DEFAULT_WINDOWS, windows || {});
    const newlyMissed = [];
    session.notes.forEach(function (note) {
      if (note.status === "pending" && songTimeMs - note.timeMs > limits.miss) {
        note.status = "missed";
        note.judgment = "Miss";
        session.misses += 1;
        session.combo = 0;
        session.lastJudgment = "Miss";
        newlyMissed.push(note);
      }
    });
    return newlyMissed;
  }

  function judgeKeyPress(session, key, songTimeMs, windows) {
    const limits = Object.assign({}, DEFAULT_WINDOWS, windows || {});
    let nearest = null;
    let nearestDistance = Infinity;

    session.notes.forEach(function (note) {
      if (note.status !== "pending" || note.key !== key) return;
      const distance = Math.abs(songTimeMs - note.timeMs);
      if (distance <= limits.miss && distance < nearestDistance) {
        nearest = note;
        nearestDistance = distance;
      }
    });
    if (!nearest) return null;

    const sameAttack = session.notes.filter(function (note) {
      return note.status === "pending" && note.key === key && note.eventId === nearest.eventId;
    });
    const judgment = nearestDistance <= limits.perfect ? "Perfect" : (nearestDistance <= limits.good ? "Good" : "Late");
    const points = judgment === "Perfect" ? 100 : (judgment === "Good" ? 70 : 40);

    sameAttack.forEach(function (note) {
      note.status = "hit";
      note.judgment = judgment;
      note.offsetMs = songTimeMs - note.timeMs;
      session.hits += 1;
      session.combo += 1;
      session.score += points;
    });
    session.maxCombo = Math.max(session.maxCombo, session.combo);
    session.lastJudgment = judgment;
    return { judgment: judgment, notes: sameAttack, offsetMs: songTimeMs - nearest.timeMs };
  }

  function getAccuracy(session) {
    const judged = session.hits + session.misses;
    return judged ? Math.round((session.hits / judged) * 100) : 100;
  }

  function createClock(nowProvider) {
    const now = nowProvider || function () { return performance.now(); };
    let playing = false;
    let speed = 1;
    let positionMs = 0;
    let startedAt = 0;

    return {
      isPlaying: function () { return playing; },
      getSpeed: function () { return speed; },
      now: function () {
        return playing ? positionMs + (now() - startedAt) * speed : positionMs;
      },
      play: function () {
        if (playing) return;
        startedAt = now();
        playing = true;
      },
      pause: function () {
        if (!playing) return;
        positionMs = this.now();
        playing = false;
      },
      restart: function () {
        positionMs = 0;
        startedAt = now();
      },
      seek: function (nextMs) {
        positionMs = Math.max(0, Number(nextMs) || 0);
        startedAt = now();
      },
      setSpeed: function (nextSpeed) {
        const value = Number(nextSpeed);
        if (!Number.isFinite(value) || value <= 0) return;
        positionMs = this.now();
        startedAt = now();
        speed = value;
      },
    };
  }

  return {
    DEFAULT_WINDOWS: DEFAULT_WINDOWS,
    buildTimeline: buildTimeline,
    createSession: createSession,
    resetSession: resetSession,
    markMisses: markMisses,
    judgeKeyPress: judgeKeyPress,
    getAccuracy: getAccuracy,
    createClock: createClock,
  };
});
