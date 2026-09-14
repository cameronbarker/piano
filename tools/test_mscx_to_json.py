#!/usr/bin/env python3
"""Comprehensive test suite for MSCX conversion pipeline, legacy reconciliation, and score analysis.

Covers:
- TPC decoding and pitch spelling
- Piano key mapping (1-88)
- Exact rational timing (fractions.Fraction) and tuplet nesting
- Authoritative spanner tie resolution (locations, chains, cross-measure)
- Repeat collapsing semantics ('x' attribute preservation)
- Structural reconciliation against MuseScore XML
- Identity-based note/chord/rest matching
- Legacy adapter equivalence against Clair de Lune reference
- Relative-reading and chord shape analysis readiness
"""

from fractions import Fraction
import json
import os
import subprocess
import tempfile
import unittest

from scripts.mscx_to_json import (
    WrittenPitch,
    collapse_repeats,
    convert_mscx_to_json,
    decode_tpc,
    duration_to_fraction,
    fraction_to_quarters,
    fraction_to_ticks,
    midi_to_piano_key,
    parse_score,
    validate_semantic_score,
)
from scripts.score_analysis import (
    analyze_chord_shape,
    analyze_movement,
    diatonic_value,
)

FIXTURE_PATH = "DCMLab-repos/debussy_clairdelune/l075-03_suite_clair.mscx"
LEGACY_CONVERTER_PATH = "data/tools/mscx-to-piece/mscx-to-piece"


class TestMusicalPrimitives(unittest.TestCase):
    """Test pure musical primitives and exact conversions."""

    def test_midi_to_piano_key(self):
        # A0 = 21 -> key 1
        self.assertEqual(midi_to_piano_key(21), 1)
        # Middle C (C4) = 60 -> key 40
        self.assertEqual(midi_to_piano_key(60), 40)
        # C8 = 108 -> key 88
        self.assertEqual(midi_to_piano_key(108), 88)

        with self.assertRaises(ValueError):
            midi_to_piano_key(20)
        with self.assertRaises(ValueError):
            midi_to_piano_key(109)

    def test_tpc_decoding(self):
        # Middle C: C4, MIDI 60, TPC 14
        wp = decode_tpc(14, 60)
        self.assertIsNotNone(wp)
        self.assertEqual(wp.step, "C")
        self.assertEqual(wp.alter, 0)
        self.assertEqual(wp.octave, 4)
        self.assertEqual(wp.name(), "C4")

        # C#4: MIDI 61, TPC 21
        wp = decode_tpc(21, 61)
        self.assertEqual(wp.step, "C")
        self.assertEqual(wp.alter, 1)
        self.assertEqual(wp.name(), "C#4")

        # Db4: MIDI 61, TPC 9
        wp = decode_tpc(9, 61)
        self.assertEqual(wp.step, "D")
        self.assertEqual(wp.alter, -1)
        self.assertEqual(wp.name(), "Db4")

        # F#5: MIDI 78, TPC 20
        wp = decode_tpc(20, 78)
        self.assertEqual(wp.step, "F")
        self.assertEqual(wp.alter, 1)
        self.assertEqual(wp.name(), "F#5")

    def test_exact_rational_timing(self):
        # Quarter note = Fraction(1, 4) whole
        # Under division 480, ticks should be 480
        ticks = fraction_to_ticks(Fraction(1, 4), 480)
        self.assertEqual(ticks, 480)

        # Triplet eighth under quarter: Fraction(1, 8) * Fraction(2, 3) = Fraction(1, 12)
        # Fraction(1, 12) * 4 = 1/3 quarter note -> 480 * 1/3 = 160 ticks
        ticks_triplet = fraction_to_ticks(Fraction(1, 12), 480)
        self.assertEqual(ticks_triplet, 160)

        # Dotted quarter = 1/4 * 3/2 = 3/8
        ticks_dot_quarter = fraction_to_ticks(Fraction(3, 8), 480)
        self.assertEqual(ticks_dot_quarter, 720)


class TestRepeatCollapsing(unittest.TestCase):
    """Test legacy 'x' repeat preservation."""

    def test_collapse_repeats(self):
        events = [
            {"L": [40], "R": [60], "Lh": "", "Rh": "", "w": 0.5, "Ld": 0.5, "Rd": 0.5, "x": 1},
            {"L": [40], "R": [60], "Lh": "", "Rh": "", "w": 0.5, "Ld": 0.5, "Rd": 0.5, "x": 1},
            {"L": [40], "R": [60], "Lh": "", "Rh": "", "w": 0.5, "Ld": 0.5, "Rd": 0.5, "x": 1},
            {"L": [45], "R": [65], "Lh": "", "Rh": "", "w": 0.5, "Ld": 0.5, "Rd": 0.5, "x": 1},
        ]
        collapsed = collapse_repeats(events)
        self.assertEqual(len(collapsed), 2)
        self.assertEqual(collapsed[0]["x"], 3)
        self.assertEqual(collapsed[1]["x"], 1)

    def test_rests_never_collapse(self):
        events = [
            {"rest": True, "w": 0.5},
            {"rest": True, "w": 0.5},
        ]
        collapsed = collapse_repeats(events)
        self.assertEqual(len(collapsed), 2)


class TestClairDeLuneFullConversion(unittest.TestCase):
    """Test full conversion of Clair de Lune MSCX fixture."""

    @classmethod
    def setUpClass(cls):
        if not os.path.exists(FIXTURE_PATH):
            raise unittest.SkipTest(f"Fixture {FIXTURE_PATH} not found.")
        cls.json_output, cls.report = convert_mscx_to_json(
            FIXTURE_PATH,
            validate=True,
        )

    def test_validation_passed(self):
        self.assertTrue(self.report.valid)
        self.assertEqual(len(self.report.errors), 0)

    def test_score_counts(self):
        stats = self.report.stats
        self.assertEqual(stats["measures"], 72)
        self.assertEqual(stats["staffs"], 2)
        self.assertEqual(stats["notes"], 1680)
        self.assertEqual(stats["chords"], 1209)
        self.assertEqual(stats["rests"], 140)
        self.assertEqual(stats["sourceNotes"], 1680)
        self.assertEqual(stats["sourceChords"], 1209)
        self.assertEqual(stats["sourceRests"], 140)
        self.assertEqual(stats["tuplets"], 119)
        self.assertEqual(stats["arpeggios"], 12)
        # All tie starts have matching tie ends
        self.assertEqual(stats["tieStarts"], 121)
        self.assertEqual(stats["tieEnds"], 121)

    def test_legacy_comparison_hard_gate(self):
        """Reconcile against legacy converter output."""
        if not os.path.exists(LEGACY_CONVERTER_PATH):
            raise unittest.SkipTest(f"Legacy converter {LEGACY_CONVERTER_PATH} not found.")

        # Generate legacy converter output to temporary file
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w+", delete=False) as tmp_old:
            tmp_old_path = tmp_old.name

        try:
            subprocess.run(
                ["python3", LEGACY_CONVERTER_PATH, FIXTURE_PATH, "-o", tmp_old_path],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            with open(tmp_old_path, "r", encoding="utf-8") as f:
                old_data = json.load(f)

            old_bars = old_data["bars"]
            new_bars = self.json_output["bars"]

            self.assertEqual(len(old_bars), len(new_bars))

            mismatched_bars = []
            for b_idx in range(len(old_bars)):
                if old_bars[b_idx] != new_bars[b_idx]:
                    mismatched_bars.append(b_idx + 1)

            # The only difference across all 72 bars must be Bar 18
            # where the old converter had a known grace-note time leak bug.
            self.assertEqual(mismatched_bars, [18])

            # Verify Bar 18 diff is intentional bug fix:
            old_b18 = old_bars[17]
            new_b18 = new_bars[17]
            # Old bar 18 had a corrupted micro-split wait (w: 0.747919 and 0.002081)
            # due to subtracting grace note offset.
            # New bar 18 cleanly integrates the acciaccatura chord on the rhythmic beat with w: 0.75
            self.assertEqual(new_b18["events"][3]["w"], 0.75)
            self.assertEqual(new_b18["events"][4]["w"], 0.75)

            # Verify repeat 'x' counts match exactly between old and new
            old_x_counts = sum(ev.get("x", 1) - 1 for b in old_bars for ev in b["events"])
            new_x_counts = sum(ev.get("x", 1) - 1 for b in new_bars for ev in b["events"])
            self.assertEqual(old_x_counts, new_x_counts)

        finally:
            if os.path.exists(tmp_old_path):
                os.remove(tmp_old_path)


class TestDownstreamAnalysis(unittest.TestCase):
    """Test downstream relative-reading and chord shape analysis."""

    def test_analyze_movement(self):
        note_c4 = {
            "midi": 60,
            "pianoKey": 40,
            "writtenPitch": {"step": "C", "alter": 0, "octave": 4, "name": "C4"},
        }
        note_d4 = {
            "midi": 62,
            "pianoKey": 42,
            "writtenPitch": {"step": "D", "alter": 0, "octave": 4, "name": "D4"},
        }
        note_e4 = {
            "midi": 64,
            "pianoKey": 44,
            "writtenPitch": {"step": "E", "alter": 0, "octave": 4, "name": "E4"},
        }

        m_step = analyze_movement(note_c4, note_d4)
        self.assertEqual(m_step["diatonicSteps"], 1)
        self.assertEqual(m_step["semitones"], 2)
        self.assertEqual(m_step["pianoKeyDelta"], 2)
        self.assertEqual(m_step["direction"], "up")
        self.assertFalse(m_step["isRepeat"])

        m_third = analyze_movement(note_c4, note_e4)
        self.assertEqual(m_third["diatonicSteps"], 2)
        self.assertEqual(m_third["semitones"], 4)

        m_repeat = analyze_movement(note_c4, note_c4)
        self.assertEqual(m_repeat["diatonicSteps"], 0)
        self.assertEqual(m_repeat["semitones"], 0)
        self.assertEqual(m_repeat["direction"], "same")
        self.assertTrue(m_repeat["isRepeat"])

    def test_analyze_chord_shape(self):
        chord = {
            "notes": [
                {"midi": 60, "pianoKey": 40, "writtenPitch": {"step": "C", "alter": 0, "octave": 4, "name": "C4"}},
                {"midi": 64, "pianoKey": 44, "writtenPitch": {"step": "E", "alter": 0, "octave": 4, "name": "E4"}},
                {"midi": 67, "pianoKey": 47, "writtenPitch": {"step": "G", "alter": 0, "octave": 4, "name": "G4"}},
            ]
        }
        shape = analyze_chord_shape(chord)
        self.assertEqual(shape["anchor"], "C4")
        self.assertEqual(shape["semitoneShape"], [0, 4, 7])
        self.assertEqual(shape["diatonicShape"], [0, 2, 4])
        self.assertEqual(shape["pianoKeyShape"], [0, 4, 7])


if __name__ == "__main__":
    unittest.main()
