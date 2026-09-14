#!/usr/bin/env python3
"""Downstream musical analysis helpers for relative-reading and chord-shape recognition.

This module consumes the authoritative semantic JSON output without reopening the MSCX file.
Demonstrates:
- Diatonic and semitone interval movement between sequential melodic notes
- Chord shapes, anchor pitches, and intervals
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List, Optional, Tuple

DIATONIC_STEPS = {"C": 0, "D": 1, "E": 2, "F": 3, "G": 4, "A": 5, "B": 6}


def diatonic_value(step: str, octave: int) -> int:
    """Calculate absolute zero-based diatonic index (C0 = 0, D0 = 1, ... C4 = 28, etc.)."""
    return octave * 7 + DIATONIC_STEPS[step.upper()]


def analyze_movement(note_a: dict, note_b: dict) -> dict:
    """Analyze melodic movement between two sequential notes from semantic JSON alone.
    
    Zero-based movement convention:
    - Same pitch = 0
    - C4 -> D4 = +1 diatonic step, +2 semitones
    - C4 -> E4 = +2 diatonic steps, +4 semitones
    """
    key_a = note_a["pianoKey"]
    key_b = note_b["pianoKey"]
    midi_a = note_a["midi"]
    midi_b = note_b["midi"]

    wp_a = note_a["writtenPitch"]
    wp_b = note_b["writtenPitch"]

    dia_a = diatonic_value(wp_a["step"], wp_a["octave"])
    dia_b = diatonic_value(wp_b["step"], wp_b["octave"])

    piano_key_delta = key_b - key_a
    semitones = midi_b - midi_a
    diatonic_steps = dia_b - dia_a

    if semitones > 0:
        direction = "up"
    elif semitones < 0:
        direction = "down"
    else:
        direction = "same"

    is_repeat = (midi_a == midi_b and wp_a["step"] == wp_b["step"] and wp_a["alter"] == wp_b["alter"])

    return {
        "from": wp_a.get("name", f"{wp_a['step']}{wp_a['octave']}"),
        "to": wp_b.get("name", f"{wp_b['step']}{wp_b['octave']}"),
        "pianoKeyDelta": piano_key_delta,
        "semitones": semitones,
        "diatonicSteps": diatonic_steps,
        "direction": direction,
        "isRepeat": is_repeat,
    }


def analyze_chord_shape(chord: dict) -> dict:
    """Analyze chord shape, lowest-note anchor, and interval vectors from semantic JSON."""
    notes = chord.get("notes", [])
    if not notes:
        return {"anchor": None, "semitoneShape": [], "diatonicShape": [], "pianoKeyShape": []}

    sorted_notes = sorted(notes, key=lambda n: n["midi"])
    anchor_note = sorted_notes[0]
    anchor_wp = anchor_note["writtenPitch"]
    anchor_name = anchor_wp.get("name", f"{anchor_wp['step']}{anchor_wp['octave']}")
    anchor_dia = diatonic_value(anchor_wp["step"], anchor_wp["octave"])
    anchor_midi = anchor_note["midi"]
    anchor_key = anchor_note["pianoKey"]

    semitone_shape = [n["midi"] - anchor_midi for n in sorted_notes]
    diatonic_shape = [
        diatonic_value(n["writtenPitch"]["step"], n["writtenPitch"]["octave"]) - anchor_dia
        for n in sorted_notes
    ]
    key_shape = [n["pianoKey"] - anchor_key for n in sorted_notes]

    return {
        "anchor": anchor_name,
        "noteCount": len(sorted_notes),
        "semitoneShape": semitone_shape,
        "diatonicShape": diatonic_shape,
        "pianoKeyShape": key_shape,
    }


def extract_voice_movements(semantic_data: dict, staff: int = 1, voice: int = 1) -> List[dict]:
    """Demonstrate sequential note movement analysis in a staff/voice timeline."""
    measures = semantic_data.get("measures", [])
    notes_in_line: List[dict] = []

    for m in measures:
        for ev in m.get("events", []):
            if ev.get("type") == "chord" and ev.get("staff") == staff and ev.get("voice") == voice:
                # For melodic line, pick the top note of chord
                if ev.get("notes"):
                    top_note = max(ev["notes"], key=lambda n: n["midi"])
                    notes_in_line.append(top_note)

    movements = []
    for i in range(len(notes_in_line) - 1):
        movements.append(analyze_movement(notes_in_line[i], notes_in_line[i + 1]))

    return movements


def demo_analysis(json_path: str) -> None:
    """Run analysis demo on converted JSON file."""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    semantic = data.get("semantic", {})
    if not semantic:
        print("No semantic block found in JSON.")
        return

    print("=== RELATIVE-READING MOVEMENT SAMPLES (Staff 1, Voice 1) ===")
    movements = extract_voice_movements(semantic, staff=1, voice=1)
    for idx, mov in enumerate(movements[:8]):
        print(
            f"  {mov['from']:>5} -> {mov['to']:<5} | "
            f"Key delta: {mov['pianoKeyDelta']:+2d} | "
            f"Semitones: {mov['semitones']:+2d} | "
            f"Diatonic steps: {mov['diatonicSteps']:+2d} | "
            f"Dir: {mov['direction']}"
        )

    print("\n=== CHORD SHAPE SAMPLES (First 5 Chords with >= 2 Notes) ===")
    chord_count = 0
    for m in semantic.get("measures", []):
        for ev in m.get("events", []):
            if ev.get("type") == "chord" and len(ev.get("notes", [])) >= 2:
                shape = analyze_chord_shape(ev)
                notes_str = ", ".join(n["writtenPitch"].get("name", "") for n in ev["notes"])
                print(
                    f"  M{m['number']} Staff {ev['staff']}: [{notes_str}] -> "
                    f"Anchor: {shape['anchor']}, "
                    f"Semitones: {shape['semitoneShape']}, "
                    f"Diatonic: {shape['diatonicShape']}"
                )
                chord_count += 1
                if chord_count >= 5:
                    break
        if chord_count >= 5:
            break


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze musical semantics from converted JSON.")
    parser.add_argument("file", help="Path to converted score JSON (schemaVersion 2)")
    args = parser.parse_args()

    demo_analysis(args.file)
    return 0


if __name__ == "__main__":
    sys.exit(main())
