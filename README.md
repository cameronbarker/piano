# Piano practice

A browser app for learning pieces on a real MIDI piano by **seeing the keyboard as the score**.

Pick a piece, hold the highlighted keys together, then move to the next shape. The goal is not to decode staff notation or keep a metronome. The goal is to know *where to put your hands next*.

This README is the teaching north star. When we add features, come back here and ask: does this still teach piano this way?

---

## Teaching approach

Traditional lessons start with paper: clefs, key signatures, note values, and a pulse. The student decodes symbols, finds those notes on the instrument, and tries to stay in time.

We flip that.

**The piano is the score.** Notes are physical keys 1–88 (Middle C is 40), grouped into rainbow regions of about an octave: red, orange, yellow, green, blue, violet, pink. Green is the Middle C neighborhood. You locate a note by region and key, not by a treble-clef G or a ledger line.

**One freeze-frame at a time.** A step is every left- and right-hand key that attacks together. Highlights sit on those keys. L/R markers float above them. The next attack is already ghosted so you can prepare. Progress is gated on a correct shape, not on tempo.

**Upcoming as a quiet strip.** Every grip in the piece appears under the keyboard, lined up with the same keys, in the leftover window space. Keys that stay put become a column. Optionally loop one or more bars from the current bar: holding the last grip wraps to the first, and the keyboard pans so those keys stay in view. The piano is still the score; looping does not change the hold-to-advance rule.

**Hands are positions and travel.** Each hand is a cluster on the keyboard. If the next cluster is far away, we warn: “6 keys →” or “Jump 12 keys.” If nothing big is coming: “Hands in position.”

**Relative reading, not named theory first.** The next note is “from here, this far, this direction.” A chord is a shape from its lowest (anchor) note. Interval and chord-shape analysis already exists in `tools/score_analysis.py` so later UI can speak that language without reopening MuseScore files.

### What the learner must do

1. See the current shape (left hand + right hand keys).
2. Put those keys down together on a MIDI piano (or click them).
3. Notice where the next shape will be, especially if a hand has to jump.
4. Advance.

Wrong keys flash. Rests auto-advance. Space / arrows also step, so you can preview without playing.

### What we are not teaching yet

These matter, but they are not the current surface:

- Staff notation (clefs, accidentals, key signatures, ledger lines)
- Keeping a beat or performing in tempo
- Finger numbers
- Dynamics, articulation, and phrasing

Timing fields already live in the piece JSON (`tempo`, `w`, `Ld`, `Rd`). The live loop does not use them. That is intentional: **correct place first, time later.**

---

## Guardrails for future work

Use these when a change feels tempting.

**Do**

- Keep the unit of practice as a two-hand keyboard shape, then the next move.
- Prefer spatial landmarks (color regions, key numbers as an optional crutch, jump warnings) over abstract symbols.
- Show current and upcoming. The student should never have to hold the whole piece in working memory.
- Gate progress on “all expected keys held together” unless we are explicitly adding a later, clearly labeled timing mode.
- Reduce cognitive load: one step, one decision, obvious success.

**Do not**

- Make staff reading a prerequisite for using the app.
- Turn practice into a rhythm game (falling notes, fail-on-late) before place is solid.
- Hide the next target. Surprise jumps fight the pedagogy.
- Add theory vocabulary (chord names, scale degrees) as the primary cue. Shapes and distances come first; names can label a shape later.
- Advance automatically on a metronome click while the student is still hunting for keys.

If a feature helps someone *find and hold the next grip*, it belongs. If it mainly helps them *perform the page*, it is a later layer.

---

## How this differs from traditional lessons

| Traditional | This app |
| --- | --- |
| Read the staff, then find the keys | Look at the keys; the staff is optional later |
| Keep a pulse from the first attempt | Freeze until the shape is correct |
| Two staves coordinated in time | One combined L+R grip, then travel |
| Absolute pitch names and key signatures | Regions, key numbers, intervals from the last note |
| Teacher points and counts | MIDI confirms the hold; UI warns about jumps |

Closest cousins: a teacher pointing at the keyboard, or Synthesia-style guides — except this is not a timing game. It is a spatial, gated practice loop.

---

## Run the app

Static HTML. No build step.

1. Serve the repo root over `http://localhost` (Web MIDI needs a secure context; `file://` often will not get MIDI):

   ```bash
   python3 -m http.server
   ```

2. Open the practice page in a Chromium-based browser.
3. Connect a MIDI keyboard, choose it in the header, pick a piece.
4. Hold every highlighted key together to continue.

Keyboard shortcuts: Space / → / N next, ← / Backspace / P previous, R restart.

---

## Repo layout

| Path | Role |
| --- | --- |
| `index.html`, `app.js`, `styles.css` | Practice UI |
| `region-helpers.js` | Key 1–88 mapping, color regions, hand-travel cues |
| `pieces/` | Piece JSON used by the app |
| `tools/` | MuseScore `.mscx` → JSON converter and relative-reading analysis |

Converter details: [`tools/README.md`](tools/README.md).

A practice event looks like this:

```json
{ "L": [35, 39, 42], "R": [51], "Lh": "~~~~", "Rh": "~", "x": 1, "Ld": 4.0, "Rd": 1.0, "w": 1.0 }
```

`L` / `R` are piano key numbers. That is what the UI teaches. Hold marks and durations are preserved from the score so we can add time and sustain later without converting again.

---

## Add a piece

Convert an uncompressed MuseScore `.mscx` file:

```bash
python3 tools/mscx_to_json.py path/to/score.mscx -o "pieces/Title — Composer.json"
```

Then add an entry to the `PIECES` list in `app.js`. Proofread key mappings before practicing; the converter may fall back to the first two staves.

Python 3 standard library only. Flags, validation, and tests: [`tools/README.md`](tools/README.md).
