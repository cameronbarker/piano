# MSCX to Semantic JSON Converter

A dependency-free Python 3 CLI tool that converts MuseScore `.mscx` files into an authoritative semantic model and backward-compatible legacy piano app JSON.

## Architectural Principles

1. **One Authoritative Semantic Model**: Single source of truth preserving exact musical semantics directly from MuseScore XML:
   - Written pitch spelling via TPC (Tonal Pitch Class) line of fifths decoding (`step`, `alter`, `octave`, `name`).
   - Physical piano key mapping (`1–88`, where Middle C / C4 = 40).
   - Independent voice timelines per staff.
   - Clefs, key signatures, and time signatures.
   - Explicit tie linkages resolved using MuseScore `<Spanner type="Tie">` location vectors (`measures`, `fractions`, `voices`, `notes`, `staves`).
   - Exact rational timing via `fractions.Fraction` without floating-point drift or integer floor rounding.
   - Tuplet hierarchy with arbitrary nesting support (e.g., compound 4:3 containing 3:2 tuplets).
   - Grace notes (`<acciaccatura/>`, `<appoggiatura/>`, etc.) and unsupported element logging.
2. **Reconciled Backward-Compatible Legacy Adapter**:
   - Generates the `bars` array required by the piano app (`L`, `R`, `Lh`, `Rh`, `w`, `Ld`, `Rd`, `x`).
   - Reproduces repeat collapsing semantics, accumulating repeat count `x` on identical attacks.
   - Preserves application-level section metadata (`sections`).
3. **Identity & Structural Validation Engine**:
   - Compares parsed objects against raw XML by measure, staff, voice, onset, pitch, and duration.
   - Verifies tie start/end pairing.
4. **Downstream Analysis Readiness**:
   - Exposes pure musical truth consumed by downstream analysis (`scripts/score_analysis.py`) for relative-reading movement and chord shapes without reopening XML.

---

## File Structure

- `scripts/mscx_to_json.py`: Main executable CLI and conversion engine.
- `scripts/score_analysis.py`: Downstream musical analysis functions (relative movement and chord shapes).
- `scripts/test_mscx_to_json.py`: Unit and integration test suite (includes regression check against legacy converter).
- `scripts/README.md`: This documentation.

---

## Command-Line Usage

### Basic Conversion
```bash
python3 scripts/mscx_to_json.py path/to/score.mscx -o output.json
```

### Conversion with Validation Report
```bash
python3 scripts/mscx_to_json.py path/to/score.mscx -o output.json --validate
```

### Inherit Authored Application Sections
```bash
python3 scripts/mscx_to_json.py path/to/score.mscx -o piece.json --sections-from existing_piece.json
```

### Manual Staff Selection Override
```bash
python3 scripts/mscx_to_json.py path/to/score.mscx -o piece.json --staffs "1,2"
```

### Downstream Analysis Demo
```bash
python3 scripts/score_analysis.py output.json
```

---

## Schema v2 Specification

The resulting JSON includes both top-level legacy fields for the existing piano visualizer and a nested `semantic` block:

```json
{
  "schemaVersion": 2,
  "id": "clair_de_lune",
  "title": "Clair de lune",
  "composer": "Claude Debussy",
  "tempo": 50,
  "sections": [
    { "title": "A · opening", "hint": "...", "start": 1, "end": 14 }
  ],
  "bars": [
    {
      "n": 1,
      "section": 0,
      "events": [
        { "rest": true, "w": 0.5 },
        { "L": [45, 48], "R": null, "Lh": "~~~~", "Rh": "", "x": 1, "Ld": 4.0, "w": 0.5 }
      ]
    }
  ],
  "semantic": {
    "division": 480,
    "metadata": {
      "id": "clair_de_lune",
      "title": "Clair de lune",
      "composer": "Claude Debussy",
      "subtitle": "from Suite bergamasque",
      "tempoBpm": 50
    },
    "staffSelection": {
      "rightStaff": 1,
      "leftStaff": 2,
      "source": "keyboard part 1 (Piano)"
    },
    "measures": [
      {
        "number": 1,
        "index": 0,
        "startTick": 0,
        "durationTicks": 2160,
        "nominalDurationTicks": 2160,
        "timeSignature": { "numerator": 9, "denominator": 8 },
        "keySignature": { "accidentals": -5 },
        "clefs": { "1": "treble", "2": "bass" },
        "events": [
          {
            "type": "chord",
            "tick": 240,
            "measureTick": 240,
            "durationTicks": 1920,
            "durationType": "half",
            "dots": 1,
            "staff": 2,
            "voice": 1,
            "hand": "L",
            "notes": [
              {
                "midi": 65,
                "tpc": 13,
                "pianoKey": 45,
                "writtenPitch": { "step": "F", "alter": 0, "octave": 4, "name": "F4" },
                "staff": 2,
                "hand": "L"
              }
            ]
          }
        ]
      }
    ],
    "warnings": []
  }
}
```

---

## Legacy Comparison Hard Gate (Clair de Lune)

Running `scripts/test_mscx_to_json.py` executes an automated structural comparison across all 72 bars of Debussy's *Clair de Lune* (`DCMLab-repos/debussy_clairdelune/l075-03_suite_clair.mscx`):
- **71 out of 72 bars**: **Exact Match** with identical event keys, hold marks, durations, and collapsed `x` repeat counts.
- **Bar 18**: **Intentional Bug Fix**:
  - *Old converter*: Had a grace note calculation bug that subtracted a fractional tick (`tick - 1.0 + grace_n * 0.001`), producing artificial corrupted wait times `w: 0.747919` and `w: 0.002081`.
  - *New converter*: Treats acciaccatura chords without distorting rhythmic beat timing, yielding clean musical wait intervals `w: 0.75`.

---

## Running the Test Suite

```bash
python3 -m unittest scripts/test_mscx_to_json.py -v
```
All 10 tests pass in ~0.2s with zero external dependencies.
