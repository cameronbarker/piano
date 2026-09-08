const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("./game-engine.js");

const piece = {
  tempo: 60,
  bars: [{
    n: 1,
    events: [
      { L: [40], w: 1, Ld: 2 },
      { R: [44, 47], w: 0.5 },
      { rest: true, w: 0.5 },
    ],
  }],
};

test("buildTimeline converts beats to absolute time", function () {
  const timeline = engine.buildTimeline(piece);
  assert.equal(timeline.events[1].timeMs, 1000);
  assert.equal(timeline.durationMs, 2000);
  assert.equal(timeline.events[0].notes[0].holdBeats, 2);
});

test("clock preserves position while speed changes", function () {
  let now = 0;
  const clock = engine.createClock(function () { return now; });
  clock.play();
  now = 500;
  assert.equal(clock.now(), 500);
  clock.setSpeed(0.5);
  now = 1500;
  assert.equal(clock.now(), 1000);
  clock.pause();
  now = 2500;
  assert.equal(clock.now(), 1000);
  clock.restart();
  assert.equal(clock.now(), 0);
});

test("judges hits, ignores duplicate attacks, and marks misses", function () {
  const timeline = engine.buildTimeline(piece);
  const session = engine.createSession(timeline);
  assert.equal(engine.judgeKeyPress(session, 40, 30).judgment, "Perfect");
  assert.equal(engine.judgeKeyPress(session, 40, 35), null);
  assert.equal(engine.judgeKeyPress(session, 44, 1100).judgment, "Good");
  engine.markMisses(session, 1300);
  assert.equal(session.hits, 2);
  assert.equal(session.misses, 1);
  assert.equal(engine.getAccuracy(session), 67);
});

test("one physical press resolves a duplicated cross-hand key", function () {
  const timeline = engine.buildTimeline({
    tempo: 60,
    bars: [{ n: 1, events: [{ L: [40], R: [40], w: 1 }] }],
  });
  const session = engine.createSession(timeline);
  const result = engine.judgeKeyPress(session, 40, 0);
  assert.equal(result.notes.length, 2);
  assert.equal(session.notes.every(function (note) { return note.status === "hit"; }), true);
});
