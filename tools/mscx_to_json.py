#!/usr/bin/env python3
"""Convert MuseScore .mscx scores into an authoritative semantic model and legacy JSON.

Features:
- Pure Python 3 standard library (no external dependencies).
- Authoritative semantic model preserving pitch spelling (TPC), piano key (1-88),
  independent voice timelines, tuplets with exact rational timing (fractions.Fraction),
  clefs, key/time signatures, and tie chains via MuseScore spanner locations.
- Reconciled legacy adapter producing backward-compatible `bars` (L, R, Lh, Rh, w, Ld, Rd, x).
- Identity-based and structural validation engine.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass, field
from fractions import Fraction
import json
import re
import sys
from typing import Any, Dict, List, Optional, Set, Tuple, Union
import xml.etree.ElementTree as ET

# -----------------------------------------------------------------------------
# Musical & Pitch Constants
# -----------------------------------------------------------------------------

DIVISION_DEFAULT = 480
MIDI_MIN = 21  # A0
MIDI_MAX = 108  # C8
KEY_MIN = 1
KEY_MAX = 88
MIDI_TO_KEY_OFFSET = 20

# Circle of fifths base for MuseScore TPC (Tonal Pitch Class):
# F=13, C=14, G=15, D=16, A=17, E=18, B=19
TPC_BASE = 13
TPC_STEPS = ["F", "C", "G", "D", "A", "E", "B"]
NATURAL_PCS: Dict[str, int] = {
    "C": 0,
    "D": 2,
    "E": 4,
    "F": 5,
    "G": 7,
    "A": 9,
    "B": 11,
}

# MuseScore durationType to whole-note fraction
DURATION_FRACTIONS: Dict[str, Fraction] = {
    "longa": Fraction(4, 1),
    "breve": Fraction(2, 1),
    "whole": Fraction(1, 1),
    "half": Fraction(1, 2),
    "quarter": Fraction(1, 4),
    "eighth": Fraction(1, 8),
    "16th": Fraction(1, 16),
    "32nd": Fraction(1, 32),
    "64th": Fraction(1, 64),
    "128th": Fraction(1, 128),
    "256th": Fraction(1, 256),
    "512th": Fraction(1, 512),
}

HOLD_LONG_QUARTERS = Fraction(3, 1)  # >= 3 quarters -> ~~~~
HOLD_SHORT_QUARTERS = Fraction(1, 1)  # >= 1 quarter or tied -> ~

KEYBOARD_RE = re.compile(
    r"piano|pianoforte|pno\.?|keyboard|klavier|clavier|clavichord|harpsichord|"
    r"cembalo|fortepiano",
    re.IGNORECASE,
)

UNSUPPORTED_ELEMENTS = {
    "GraceNote",
    "Lyrics",
    "Ornament",
    "Tremolo",
    "Trill",
    "Glissando",
    "Vibrato",
}


# -----------------------------------------------------------------------------
# XML & String Helpers
# -----------------------------------------------------------------------------

def local_name(tag: str) -> str:
    """Return XML tag without namespace."""
    if tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag


def first_child(el: ET.Element, name: str) -> Optional[ET.Element]:
    """Find first direct child with given local name."""
    for child in el:
        if local_name(child.tag) == name:
            return child
    return None


def all_children(el: ET.Element, name: str) -> List[ET.Element]:
    """Find all direct children with given local name."""
    return [child for child in el if local_name(child.tag) == name]


def text_of(el: Optional[ET.Element]) -> str:
    """Return stripped text of element, or empty string."""
    if el is None or el.text is None:
        return ""
    return el.text.strip()


def parse_fraction(value: str) -> Fraction:
    """Parse rational fraction string (e.g. '3/16', '-1/8', '0.5') to exact Fraction."""
    val = value.strip()
    if "/" in val:
        num, den = val.split("/", 1)
        return Fraction(int(num), int(den))
    return Fraction(val)


def slugify(value: str) -> str:
    """Create URL/ID slug from title string."""
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug or "piece"


# -----------------------------------------------------------------------------
# Musical Core Functions (TPC, Keys, Timing)
# -----------------------------------------------------------------------------

@dataclass(frozen=True)
class WrittenPitch:
    step: str
    alter: int
    octave: int

    def name(self) -> str:
        acc = ""
        if self.alter > 0:
            acc = "#" * self.alter
        elif self.alter < 0:
            acc = "b" * abs(self.alter)
        return f"{self.step}{acc}{self.octave}"


def decode_tpc(tpc: Optional[int], midi: Optional[int]) -> Optional[WrittenPitch]:
    """Decode MuseScore TPC (Tonal Pitch Class) and MIDI pitch into written pitch.
    
    TPC line of fifths anchors:
    ... Cb=7, Gb=8, Db=9, Ab=10, Eb=11, Bb=12,
        F=13, C=14, G=15, D=16, A=17, E=18, B=19,
        F#=20, C#=21, G#=22, D#=23, A#=24, E#=25, B#=26 ...
    """
    if tpc is None:
        return None
    offset = tpc - TPC_BASE
    step = TPC_STEPS[offset % 7]
    alter = offset // 7

    if midi is not None:
        natural_pc = NATURAL_PCS[step]
        # MIDI = (octave + 1) * 12 + natural_pc + alter
        octave = (midi - natural_pc - alter) // 12 - 1
    else:
        octave = 4  # default octave if MIDI not available

    return WrittenPitch(step=step, alter=alter, octave=octave)


def midi_to_piano_key(midi: int) -> int:
    """Map MIDI note number to physical 88-key piano key (1-88)."""
    key = midi - MIDI_TO_KEY_OFFSET
    if not (KEY_MIN <= key <= KEY_MAX):
        raise ValueError(f"MIDI note {midi} maps to impossible piano key {key} (must be 1..88)")
    return key


def duration_to_fraction(
    el: ET.Element,
    tuplet_ratio: Fraction,
    measure_fraction: Fraction,
) -> Fraction:
    """Calculate exact whole-note duration fraction for an element."""
    explicit = first_child(el, "duration")
    if explicit is not None and text_of(explicit):
        base_frac = parse_fraction(text_of(explicit))
        return base_frac * tuplet_ratio

    dtype = text_of(first_child(el, "durationType"))
    if dtype == "measure":
        return measure_fraction

    base_frac = DURATION_FRACTIONS.get(dtype)
    if base_frac is None:
        return Fraction(0, 1)

    dots_el = first_child(el, "dots")
    dots = int(text_of(dots_el) or "0") if dots_el is not None else 0
    if dots == 1:
        base_frac *= Fraction(3, 2)
    elif dots == 2:
        base_frac *= Fraction(7, 4)
    elif dots > 2:
        multiplier = Fraction(2 ** (dots + 1) - 1, 2 ** dots)
        base_frac *= multiplier

    return base_frac * tuplet_ratio


def fraction_to_ticks(frac: Fraction, division: int) -> int:
    """Convert whole-note fraction to integer score ticks.
    
    1 whole note = 4 quarter notes = 4 * division ticks.
    """
    if frac == 0:
        return 0
    quarter_notes = frac * 4
    ticks_frac = quarter_notes * division
    if ticks_frac.denominator != 1:
        # Round cleanly if infinitesimal, otherwise raise warning
        ticks_int = round(float(ticks_frac))
        if abs(float(ticks_frac) - ticks_int) > 1e-4:
            sys.stderr.write(
                f"Warning: non-integral score ticks {ticks_frac} under division {division}\n"
            )
        return max(1, ticks_int)
    return max(1, int(ticks_frac))


def fraction_to_quarters(frac: Fraction) -> float:
    """Convert whole-note fraction to quarter notes float for legacy output."""
    q = float(frac * 4)
    rounded = round(q, 6)
    if abs(rounded - round(rounded)) < 1e-9:
        return float(int(round(rounded)))
    return rounded


def is_grace_chord(chord: ET.Element) -> bool:
    """Check if chord is an ornament / grace note (acciaccatura, appoggiatura, etc.)."""
    for child in chord:
        tag = local_name(child.tag)
        if tag in (
            "acciaccatura",
            "appoggiatura",
            "grace4",
            "grace8",
            "grace16",
            "grace32",
        ):
            return True
    return False


# -----------------------------------------------------------------------------
# Semantic Data Model
# -----------------------------------------------------------------------------

@dataclass
class SemanticTie:
    id: str
    from_previous: bool
    to_next: bool


@dataclass
class SemanticNote:
    midi: int
    tpc: int
    piano_key: int
    written_pitch: WrittenPitch
    staff: int
    hand: str
    tie: Optional[SemanticTie] = None

    def to_dict(self) -> dict:
        d: Dict[str, Any] = {
            "midi": self.midi,
            "tpc": self.tpc,
            "pianoKey": self.piano_key,
            "writtenPitch": {
                "step": self.written_pitch.step,
                "alter": self.written_pitch.alter,
                "octave": self.written_pitch.octave,
                "name": self.written_pitch.name(),
            },
            "staff": self.staff,
            "hand": self.hand,
        }
        if self.tie:
            d["tie"] = {
                "id": self.tie.id,
                "fromPrevious": self.tie.from_previous,
                "toNext": self.tie.to_next,
            }
        return d


@dataclass
class SemanticChord:
    type: str = "chord"
    tick: int = 0
    measure_tick: int = 0
    fraction_onset: Fraction = Fraction(0, 1)
    fraction_duration: Fraction = Fraction(0, 1)
    duration_ticks: int = 0
    duration_type: Optional[str] = None
    dots: int = 0
    staff: int = 1
    voice: int = 1
    hand: str = "R"
    notes: List[SemanticNote] = field(default_factory=list)
    arpeggio: Optional[dict] = None
    articulations: List[str] = field(default_factory=list)
    tuplet: Optional[dict] = None
    grace: bool = False

    def to_dict(self) -> dict:
        d: Dict[str, Any] = {
            "type": "chord",
            "tick": self.tick,
            "measureTick": self.measure_tick,
            "durationTicks": self.duration_ticks,
            "durationType": self.duration_type,
            "dots": self.dots,
            "staff": self.staff,
            "voice": self.voice,
            "hand": self.hand,
            "notes": [note.to_dict() for note in self.notes],
        }
        if self.grace:
            d["grace"] = True
        if self.arpeggio:
            d["arpeggio"] = self.arpeggio
        if self.articulations:
            d["articulations"] = self.articulations
        if self.tuplet:
            d["tuplet"] = self.tuplet
        return d


@dataclass
class SemanticRest:
    type: str = "rest"
    tick: int = 0
    measure_tick: int = 0
    fraction_onset: Fraction = Fraction(0, 1)
    fraction_duration: Fraction = Fraction(0, 1)
    duration_ticks: int = 0
    duration_type: Optional[str] = None
    dots: int = 0
    staff: int = 1
    voice: int = 1
    hand: str = "R"
    tuplet: Optional[dict] = None

    def to_dict(self) -> dict:
        d: Dict[str, Any] = {
            "type": "rest",
            "tick": self.tick,
            "measureTick": self.measure_tick,
            "durationTicks": self.duration_ticks,
            "durationType": self.duration_type,
            "dots": self.dots,
            "staff": self.staff,
            "voice": self.voice,
            "hand": self.hand,
        }
        if self.tuplet:
            d["tuplet"] = self.tuplet
        return d


@dataclass
class SemanticMeasure:
    number: int
    index: int
    start_tick: int
    duration_ticks: int
    nominal_duration_ticks: int
    time_signature: dict
    key_signature: dict
    clefs: Dict[int, str]
    events: List[Union[SemanticChord, SemanticRest]] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "number": self.number,
            "index": self.index,
            "startTick": self.start_tick,
            "durationTicks": self.duration_ticks,
            "nominalDurationTicks": self.nominal_duration_ticks,
            "timeSignature": self.time_signature,
            "keySignature": self.key_signature,
            "clefs": {str(k): v for k, v in self.clefs.items()},
            "events": [ev.to_dict() for ev in self.events],
        }


@dataclass
class SemanticScore:
    id: str
    title: str
    composer: str
    subtitle: str
    division: int
    tempo_bpm: Optional[int]
    staff_selection: dict
    measures: List[SemanticMeasure] = field(default_factory=list)
    warnings: List[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "division": self.division,
            "metadata": {
                "id": self.id,
                "title": self.title,
                "composer": self.composer,
                "subtitle": self.subtitle,
                "tempoBpm": self.tempo_bpm,
            },
            "staffSelection": self.staff_selection,
            "measures": [m.to_dict() for m in self.measures],
            "warnings": self.warnings,
        }


# -----------------------------------------------------------------------------
# Staff Selection & State Tracking
# -----------------------------------------------------------------------------

class ScoreTimeTracker:
    """Track nominal time signature and measure fraction."""

    def __init__(self, division: int = DIVISION_DEFAULT) -> None:
        self.division = division
        self.sig_n = 4
        self.sig_d = 4

    def apply_timesig(self, el: ET.Element) -> None:
        n = text_of(first_child(el, "sigN"))
        d = text_of(first_child(el, "sigD"))
        if n:
            self.sig_n = int(n)
        if d:
            self.sig_d = int(d)

    def measure_fraction(self) -> Fraction:
        return Fraction(self.sig_n, self.sig_d)

    def nominal_ticks(self) -> int:
        return fraction_to_ticks(self.measure_fraction(), self.division)

    def as_dict(self) -> dict:
        return {"numerator": self.sig_n, "denominator": self.sig_d}


class ScoreKeyTracker:
    """Track active key signature."""

    def __init__(self) -> None:
        self.accidentals = 0

    def apply_keysig(self, el: ET.Element) -> None:
        raw = text_of(first_child(el, "accidental"))
        if raw:
            try:
                self.accidentals = int(raw)
            except ValueError:
                pass

    def as_dict(self) -> dict:
        return {"accidentals": self.accidentals}


@dataclass
class StaffCandidate:
    id: int
    element: ET.Element
    instrument_name: str
    part_index: int


def select_piano_staves(
    score: ET.Element,
    manual_staffs: Optional[str],
    warnings: List[dict],
) -> Tuple[int, Optional[int], str, Dict[int, str]]:
    """Select upper and lower piano staves.
    
    Returns:
        (upper_staff_id, lower_staff_id, source_description, staff_to_hand_map)
    """
    # Parse parts to identify keyboard instruments
    parts = all_children(score, "Part")
    keyboard_staff_ids: List[int] = []
    first_part_staff_ids: List[int] = []

    for p_idx, part in enumerate(parts):
        track_name = text_of(first_child(part, "trackName"))
        instr = first_child(part, "Instrument")
        long_name = text_of(first_child(instr, "longName")) if instr is not None else ""
        label = long_name or track_name
        is_keyboard = bool(KEYBOARD_RE.search(label))

        part_staves = []
        for staff_el in all_children(part, "Staff"):
            sid_str = staff_el.get("id")
            if sid_str and sid_str.isdigit():
                part_staves.append(int(sid_str))

        if p_idx == 0:
            first_part_staff_ids = part_staves

        if is_keyboard:
            keyboard_staff_ids.extend(part_staves)

    # Collect actual content Staff elements in Score
    content_staves = all_children(score, "Staff")
    content_ids: List[int] = []
    for s in content_staves:
        sid_str = s.get("id")
        if sid_str and sid_str.isdigit():
            content_ids.append(int(sid_str))

    # 1. Manual override
    if manual_staffs:
        tokens = [t.strip() for t in manual_staffs.split(",") if t.strip()]
        if len(tokens) == 1:
            u_id = int(tokens[0])
            return u_id, None, f"manual staff {u_id}", {u_id: "R"}
        elif len(tokens) >= 2:
            u_id, l_id = int(tokens[0]), int(tokens[1])
            return u_id, l_id, f"manual staffs {u_id},{l_id}", {u_id: "R", l_id: "L"}

    # 2. Detected keyboard part staves
    if len(keyboard_staff_ids) >= 2:
        u_id, l_id = keyboard_staff_ids[0], keyboard_staff_ids[1]
        return u_id, l_id, "keyboard part 1 (Piano)", {u_id: "R", l_id: "L"}
    elif len(keyboard_staff_ids) == 1:
        u_id = keyboard_staff_ids[0]
        return u_id, None, "keyboard part 1 (single staff)", {u_id: "R"}

    # 3. First part staves
    if len(first_part_staff_ids) >= 2:
        u_id, l_id = first_part_staff_ids[0], first_part_staff_ids[1]
        warnings.append({
            "code": "fallback-first-part",
            "message": "no explicit keyboard part name detected; using first part staves",
        })
        return u_id, l_id, "first part fallback", {u_id: "R", l_id: "L"}

    # 4. Fallback to first available content staves
    if len(content_ids) >= 2:
        u_id, l_id = content_ids[0], content_ids[1]
        warnings.append({
            "code": "fallback-content-staves",
            "message": "using first two content staves as fallback",
        })
        return u_id, l_id, "first two staves fallback", {u_id: "R", l_id: "L"}
    elif len(content_ids) == 1:
        u_id = content_ids[0]
        return u_id, None, "single content staff fallback", {u_id: "R"}

    raise ValueError("No musical staves found in score.")


# -----------------------------------------------------------------------------
# Spanner Tie Resolution
# -----------------------------------------------------------------------------

@dataclass
class RawTieLocation:
    delta_measures: int = 0
    delta_fractions: Fraction = Fraction(0, 1)
    delta_voices: int = 0
    delta_notes: int = 0
    delta_staves: int = 0


@dataclass
class RawTieSpanner:
    is_next: bool  # True if <next>, False if <prev>
    location: RawTieLocation


def parse_tie_spanners(note_el: ET.Element) -> List[RawTieSpanner]:
    """Extract <Spanner type="Tie"> details from note."""
    spanners: List[RawTieSpanner] = []
    for sp in all_children(note_el, "Spanner"):
        if sp.get("type") != "Tie":
            continue
        for child in sp:
            tag = local_name(child.tag)
            if tag in ("next", "prev"):
                is_next = (tag == "next")
                loc_el = first_child(child, "location")
                loc = RawTieLocation()
                if loc_el is not None:
                    m_str = text_of(first_child(loc_el, "measures"))
                    if m_str:
                        loc.delta_measures = int(m_str)
                    f_str = text_of(first_child(loc_el, "fractions"))
                    if f_str:
                        loc.delta_fractions = parse_fraction(f_str)
                    v_str = text_of(first_child(loc_el, "voices"))
                    if v_str:
                        loc.delta_voices = int(v_str)
                    n_str = text_of(first_child(loc_el, "notes"))
                    if n_str:
                        loc.delta_notes = int(n_str)
                    s_str = text_of(first_child(loc_el, "staves"))
                    if s_str:
                        loc.delta_staves = int(s_str)
                spanners.append(RawTieSpanner(is_next=is_next, location=loc))
            elif tag == "Tie":
                # Standalone <Tie/> element often indicates outgoing tie start
                pass
    return spanners


# -----------------------------------------------------------------------------
# Authoritative XML Parser
# -----------------------------------------------------------------------------

def parse_score_metadata(score: ET.Element) -> Tuple[str, str, str, str]:
    """Extract id, title, composer, subtitle from score metadata and VBox."""
    meta: Dict[str, str] = {}
    for el in all_children(score, "metaTag"):
        name = el.get("name")
        if name:
            meta[name] = text_of(el)

    movement = meta.get("movementTitle") or ""
    work = meta.get("workTitle") or ""
    title = movement or work or "Untitled"
    composer = meta.get("composer") or ""

    subtitle = ""
    if movement and work and movement.lower() != work.lower():
        subtitle = "from " + work

    # Also inspect VBox text styles if metadata was incomplete
    for staff in all_children(score, "Staff"):
        for vbox in all_children(staff, "VBox"):
            for text_el in all_children(vbox, "Text"):
                style = text_of(first_child(text_el, "style"))
                content = text_of(first_child(text_el, "text"))
                if style == "Title" and not movement and not work:
                    title = content
                elif style == "Subtitle" and not subtitle:
                    subtitle = content
                elif style == "Composer" and not composer:
                    composer = content

    piece_id = slugify(title)
    return piece_id, title, composer, subtitle


def parse_score(
    xml_path: str,
    manual_staffs: Optional[str] = None,
    id_override: Optional[str] = None,
    title_override: Optional[str] = None,
    composer_override: Optional[str] = None,
) -> SemanticScore:
    """Parse MSCX file into an authoritative SemanticScore."""
    tree = ET.parse(xml_path)
    root = tree.getroot()
    score_el = first_child(root, "Score")
    if score_el is None:
        raise ValueError("Invalid MuseScore file: <Score> element not found.")

    division_el = first_child(score_el, "Division")
    division = int(text_of(division_el) or str(DIVISION_DEFAULT))

    piece_id, title, composer, subtitle = parse_score_metadata(score_el)
    if id_override:
        piece_id = id_override
    if title_override:
        title = title_override
    if composer_override:
        composer = composer_override

    warnings: List[dict] = []
    upper_id, lower_id, staff_source, staff_hand_map = select_piano_staves(
        score_el, manual_staffs, warnings
    )
    selected_staff_ids = [upper_id] + ([lower_id] if lower_id is not None else [])

    # Index Measure elements by staff
    content_staves_by_id: Dict[int, ET.Element] = {}
    for s in all_children(score_el, "Staff"):
        sid_str = s.get("id")
        if sid_str and sid_str.isdigit():
            content_staves_by_id[int(sid_str)] = s

    measures_by_staff: Dict[int, List[ET.Element]] = {
        sid: all_children(content_staves_by_id[sid], "Measure")
        for sid in selected_staff_ids
        if sid in content_staves_by_id
    }
    num_measures = max(len(m_list) for m_list in measures_by_staff.values())

    time_tracker = ScoreTimeTracker(division)
    key_tracker = ScoreKeyTracker()
    clef_tracker: Dict[int, str] = {upper_id: "treble"}
    if lower_id is not None:
        clef_tracker[lower_id] = "bass"

    tempo_bpm: Optional[int] = None
    semantic_measures: List[SemanticMeasure] = []
    score_tick_cursor = 0

    # Store raw note registry for spanner tie linking:
    # Key: (measure_idx, staff_id, voice_idx, Fraction_onset, note_idx) -> NoteRef
    raw_notes_registry: Dict[Tuple[int, int, int, Fraction, int], dict] = {}
    tie_starts_to_resolve: List[dict] = []

    for m_idx in range(num_measures):
        measure_num = m_idx + 1

        # Scan measure-level time signature, key signature, and tempo
        for sid in selected_staff_ids:
            m_list = measures_by_staff.get(sid, [])
            if m_idx < len(m_list):
                m_el = m_list[m_idx]
                for voice_el in all_children(m_el, "voice"):
                    for child in voice_el:
                        tag = local_name(child.tag)
                        if tag == "TimeSig":
                            time_tracker.apply_timesig(child)
                        elif tag == "KeySig":
                            key_tracker.apply_keysig(child)
                        elif tag == "Tempo" and tempo_bpm is None:
                            raw_t = text_of(first_child(child, "tempo"))
                            if raw_t:
                                try:
                                    qps = parse_fraction(raw_t)
                                    tempo_bpm = int(round(float(qps) * 60.0))
                                except ValueError:
                                    pass

        nominal_ticks = time_tracker.nominal_ticks()
        measure_fraction = time_tracker.measure_fraction()

        # Check for measure duration override <len>
        actual_measure_fraction = measure_fraction
        for sid in selected_staff_ids:
            m_list = measures_by_staff.get(sid, [])
            if m_idx < len(m_list):
                len_el = first_child(m_list[m_idx], "len")
                if len_el is not None and text_of(len_el):
                    actual_measure_fraction = parse_fraction(text_of(len_el))
                    break

        actual_duration_ticks = fraction_to_ticks(actual_measure_fraction, division)

        measure_events: List[Union[SemanticChord, SemanticRest]] = []

        for sid in selected_staff_ids:
            hand = staff_hand_map.get(sid, "R")
            m_list = measures_by_staff.get(sid, [])
            if m_idx >= len(m_list):
                continue
            m_el = m_list[m_idx]

            voices = all_children(m_el, "voice")
            for v_idx, voice_el in enumerate(voices, start=1):
                voice_time = Fraction(0, 1)
                tuplet_stack: List[Tuple[int, int, str]] = []

                for el in voice_el:
                    tag = local_name(el.tag)

                    if tag == "Clef":
                        concert = text_of(first_child(el, "concertClefType"))
                        trans = text_of(first_child(el, "transposingClefType"))
                        subtype = text_of(first_child(el, "subtype"))
                        clef_val = concert or trans or subtype
                        clef_name = "treble" if clef_val == "G" else ("bass" if clef_val == "F" else clef_val)
                        clef_tracker[sid] = clef_name
                        continue

                    if tag == "Tuplet":
                        norm = int(text_of(first_child(el, "normalNotes")) or "3")
                        act = int(text_of(first_child(el, "actualNotes")) or "2")
                        base = text_of(first_child(el, "baseNote")) or "eighth"
                        if act > 0:
                            tuplet_stack.append((norm, act, base))
                        continue

                    if tag == "endTuplet":
                        if tuplet_stack:
                            tuplet_stack.pop()
                        continue

                    if tag in UNSUPPORTED_ELEMENTS:
                        warnings.append({
                            "type": "unsupported-element",
                            "element": tag,
                            "measure": measure_num,
                            "staff": sid,
                            "voice": v_idx,
                        })
                        continue

                    if tag not in ("Chord", "Rest"):
                        continue

                    # Tuplet ratio is exact Fraction across nested tuplets
                    tuplet_ratio = Fraction(1, 1)
                    tuplet_info: Optional[dict] = None
                    if tuplet_stack:
                        for norm, act, base in tuplet_stack:
                            tuplet_ratio *= Fraction(norm, act)
                        curr_norm, curr_act, curr_base = tuplet_stack[-1]
                        tuplet_info = {
                            "actual": curr_act,
                            "normal": curr_norm,
                            "baseNote": curr_base,
                        }

                    event_duration_frac = duration_to_fraction(
                        el, tuplet_ratio, actual_measure_fraction
                    )
                    event_duration_ticks = fraction_to_ticks(event_duration_frac, division)
                    event_measure_tick = fraction_to_ticks(voice_time, division)
                    event_score_tick = score_tick_cursor + event_measure_tick

                    dtype = text_of(first_child(el, "durationType")) or None
                    dots = int(text_of(first_child(el, "dots")) or "0")

                    if tag == "Rest":
                        rest = SemanticRest(
                            tick=event_score_tick,
                            measure_tick=event_measure_tick,
                            fraction_onset=voice_time,
                            fraction_duration=event_duration_frac,
                            duration_ticks=event_duration_ticks,
                            duration_type=dtype,
                            dots=dots,
                            staff=sid,
                            voice=v_idx,
                            hand=hand,
                            tuplet=tuplet_info,
                        )
                        measure_events.append(rest)
                        voice_time += event_duration_frac

                    elif tag == "Chord":
                        # Check for grace note / acciaccatura
                        grace = is_grace_chord(el)
                        if grace:
                            warnings.append({
                                "type": "unsupported-element",
                                "element": "acciaccatura",
                                "measure": measure_num,
                                "staff": sid,
                                "voice": v_idx,
                            })

                        # Arpeggio info
                        arpeggio_el = first_child(el, "Arpeggio")
                        arpeggio_dict = None
                        if arpeggio_el is not None:
                            arpeggio_subtype = text_of(first_child(arpeggio_el, "subtype"))
                            arpeggio_dict = {"present": True, "subtype": arpeggio_subtype or None}

                        # Articulations
                        articulations: List[str] = []
                        for art_el in all_children(el, "Articulation"):
                            sub = text_of(first_child(art_el, "subtype"))
                            if sub:
                                articulations.append(sub)

                        # Notes in chord
                        semantic_notes: List[SemanticNote] = []
                        raw_note_elements = all_children(el, "Note")

                        for n_idx, note_el in enumerate(raw_note_elements):
                            p_str = text_of(first_child(note_el, "pitch"))
                            t_str = text_of(first_child(note_el, "tpc"))
                            if not p_str:
                                continue
                            midi = int(p_str)
                            tpc = int(t_str) if t_str else 14
                            written = decode_tpc(tpc, midi) or WrittenPitch("C", 0, 4)
                            pkey = midi_to_piano_key(midi)

                            snote = SemanticNote(
                                midi=midi,
                                tpc=tpc,
                                piano_key=pkey,
                                written_pitch=written,
                                staff=sid,
                                hand=hand,
                            )
                            semantic_notes.append(snote)

                            # Register for spanner tie matching
                            spanners = parse_tie_spanners(note_el)
                            note_reg = {
                                "measure_idx": m_idx,
                                "staff": sid,
                                "voice": v_idx,
                                "fraction_onset": voice_time,
                                "note_idx": n_idx,
                                "midi": midi,
                                "tpc": tpc,
                                "semantic_note": snote,
                                "spanners": spanners,
                            }
                            raw_notes_registry[
                                (m_idx, sid, v_idx, voice_time, n_idx)
                            ] = note_reg

                            # Record outgoing tie starts
                            for sp in spanners:
                                if sp.is_next:
                                    tie_starts_to_resolve.append(note_reg)

                        chord = SemanticChord(
                            tick=event_score_tick,
                            measure_tick=event_measure_tick,
                            fraction_onset=voice_time,
                            fraction_duration=event_duration_frac,
                            duration_ticks=event_duration_ticks,
                            duration_type=dtype,
                            dots=dots,
                            staff=sid,
                            voice=v_idx,
                            hand=hand,
                            notes=semantic_notes,
                            arpeggio=arpeggio_dict,
                            articulations=articulations,
                            tuplet=tuplet_info,
                            grace=grace,
                        )
                        measure_events.append(chord)
                        if not grace:
                            voice_time += event_duration_frac

        # Sort measure events chronologically
        measure_events.sort(key=lambda ev: (ev.measure_tick, ev.staff, ev.voice))

        semantic_measure = SemanticMeasure(
            number=measure_num,
            index=m_idx,
            start_tick=score_tick_cursor,
            duration_ticks=actual_duration_ticks,
            nominal_duration_ticks=nominal_ticks,
            time_signature=time_tracker.as_dict(),
            key_signature=key_tracker.as_dict(),
            clefs=dict(clef_tracker),
            events=measure_events,
        )
        semantic_measures.append(semantic_measure)
        score_tick_cursor += actual_duration_ticks

    # -------------------------------------------------------------------------
    # Resolve MuseScore Tie Spanners via Linkage Locations
    # -------------------------------------------------------------------------
    tie_seq = 0
    resolved_pairs: Set[Tuple[int, int]] = set()

    for start_note in tie_starts_to_resolve:
        for spanner in start_note["spanners"]:
            if not spanner.is_next:
                continue

            loc = spanner.location
            target_measure_idx = start_note["measure_idx"] + loc.delta_measures
            target_onset = start_note["fraction_onset"] + loc.delta_fractions
            target_voice = start_note["voice"] + loc.delta_voices
            target_staff = start_note["staff"] + loc.delta_staves
            target_note_idx = start_note["note_idx"] + loc.delta_notes

            # Look up target note by exact location
            target_key = (
                target_measure_idx,
                target_staff,
                target_voice,
                target_onset,
                target_note_idx,
            )
            target = raw_notes_registry.get(target_key)

            if target is None:
                # If note_idx differed or omitted in spanner, match by pitch on target onset
                for (m_i, s_i, v_i, on_f, n_i), candidate in raw_notes_registry.items():
                    if (
                        m_i == target_measure_idx
                        and s_i == target_staff
                        and v_i == target_voice
                        and on_f == target_onset
                        and candidate["midi"] == start_note["midi"]
                    ):
                        target = candidate
                        break

            if target is not None:
                tie_seq += 1
                tie_id = f"tie-{tie_seq}"

                start_snote: SemanticNote = start_note["semantic_note"]
                target_snote: SemanticNote = target["semantic_note"]

                # Pitch identity validation
                if start_snote.midi != target_snote.midi:
                    warnings.append({
                        "type": "tie-pitch-mismatch",
                        "message": f"Tie connects differing pitches: {start_snote.midi} -> {target_snote.midi}",
                        "measure": start_note["measure_idx"] + 1,
                        "tieId": tie_id,
                    })

                # Chain continuity
                existing_start_tie = start_snote.tie
                start_from_prev = existing_start_tie.from_previous if existing_start_tie else False
                start_snote.tie = SemanticTie(
                    id=tie_id,
                    from_previous=start_from_prev,
                    to_next=True,
                )

                existing_target_tie = target_snote.tie
                target_to_next = existing_target_tie.to_next if existing_target_tie else False
                target_snote.tie = SemanticTie(
                    id=existing_target_tie.id if existing_target_tie else tie_id,
                    from_previous=True,
                    to_next=target_to_next,
                )
            else:
                warnings.append({
                    "type": "unresolved-tie",
                    "measure": start_note["measure_idx"] + 1,
                    "staff": start_note["staff"],
                    "voice": start_note["voice"],
                    "pitch": start_note["midi"],
                })

    return SemanticScore(
        id=piece_id,
        title=title,
        composer=composer,
        subtitle=subtitle,
        division=division,
        tempo_bpm=tempo_bpm,
        staff_selection={
            "rightStaff": upper_id,
            "leftStaff": lower_id,
            "source": staff_source,
        },
        measures=semantic_measures,
        warnings=warnings,
    )


# -----------------------------------------------------------------------------
# Reconciled Backward-Compatible Legacy Adapter
# -----------------------------------------------------------------------------

@dataclass
class LegacyAttack:
    onset_tick: float
    pitch: int
    duration_ticks: int
    tied: bool
    bar: int


def hold_marker(duration_ticks: int, tied: bool, division: int) -> str:
    """Generate legacy hold mark ('~~~~', '~', or '') strictly matching old converter."""
    quarters = duration_ticks / float(division)
    if quarters >= 3.0:
        return "~~~~"
    if tied or quarters >= 1.0:
        return "~"
    return ""


def collapse_repeats(events: List[dict]) -> List[dict]:
    """Collapse consecutive identical events by accumulating repeat count 'x'.
    
    Reproduces the exact repeat collapsing semantics from the original converter.
    """
    out: List[dict] = []
    for ev in events:
        if ev.get("rest"):
            out.append(dict(ev))
            continue
        if (
            out
            and not out[-1].get("rest")
            and out[-1].get("L") == ev.get("L")
            and out[-1].get("R") == ev.get("R")
            and out[-1].get("Lh") == ev.get("Lh")
            and out[-1].get("Rh") == ev.get("Rh")
            and out[-1].get("w") == ev.get("w")
            and out[-1].get("Ld") == ev.get("Ld")
            and out[-1].get("Rd") == ev.get("Rd")
        ):
            out[-1]["x"] = int(out[-1].get("x") or 1) + int(ev.get("x") or 1)
        else:
            out.append(dict(ev))
    return out


def group_hand_attacks(attacks: List[LegacyAttack], division: int) -> Dict[float, dict]:
    """Group attacks by measure onset tick, matching legacy visualizer."""
    grouped: Dict[float, dict] = {}
    for attack in attacks:
        bucket = grouped.setdefault(
            attack.onset_tick,
            {"keys": [], "duration": 0, "tied": False},
        )
        key = midi_to_piano_key(attack.pitch)
        if key not in bucket["keys"]:
            bucket["keys"].append(key)
        bucket["duration"] = max(bucket["duration"], attack.duration_ticks)
        bucket["tied"] = bucket["tied"] or attack.tied

    for bucket in grouped.values():
        bucket["keys"].sort()
        bucket["hold"] = hold_marker(bucket["duration"], bucket["tied"], division)
    return grouped


def derive_legacy_bar_events(
    right_attacks: List[LegacyAttack],
    left_attacks: List[LegacyAttack],
    division: int,
    measure_ticks: int,
) -> List[dict]:
    """Construct bar events for legacy visualizer from grouped hand attacks."""
    rh = group_hand_attacks(right_attacks, division)
    lh = group_hand_attacks(left_attacks, division)
    ticks = sorted(set(rh) | set(lh))

    if not ticks:
        return [{"rest": True, "w": fraction_to_quarters(Fraction(measure_ticks, division * 4))}]

    timed: List[Tuple[float, dict]] = []
    if ticks[0] > 0:
        timed.append((0.0, {"rest": True}))

    for t in ticks:
        r = rh.get(t)
        l = lh.get(t)
        r_keys = r["keys"] if r else []
        l_keys = l["keys"] if l else []
        if not r_keys and not l_keys:
            continue

        ev: Dict[str, Any] = {
            "L": l_keys or None,
            "R": r_keys or None,
            "Lh": (l["hold"] if l and l_keys else ""),
            "Rh": (r["hold"] if r and r_keys else ""),
            "x": 1,
        }
        if l_keys and l:
            ev["Ld"] = fraction_to_quarters(Fraction(l["duration"], division * 4))
        if r_keys and r:
            ev["Rd"] = fraction_to_quarters(Fraction(r["duration"], division * 4))
        timed.append((t, ev))

    events: List[dict] = []
    for i, (t, ev) in enumerate(timed):
        next_t = timed[i + 1][0] if i + 1 < len(timed) else float(measure_ticks)
        ev["w"] = fraction_to_quarters(Fraction(int(round(max(0.0, next_t - t))), division * 4))
        events.append(ev)

    return collapse_repeats(events) if events else [
        {"rest": True, "w": fraction_to_quarters(Fraction(measure_ticks, division * 4))}
    ]


def build_legacy_bars_from_semantic(
    semantic_score: SemanticScore,
    sections_metadata: Optional[List[dict]] = None,
) -> Tuple[List[dict], List[dict]]:
    """Derive legacy bars array and sections directly from authoritative semantic score."""
    division = semantic_score.division
    bars: List[dict] = []

    # Map sections by bar range
    sections: List[dict]
    if sections_metadata:
        sections = sections_metadata
    else:
        hint = "Converted from MuseScore. Proofread keys before practicing."
        src = semantic_score.staff_selection.get("source")
        if src:
            hint += f" Staff selection: {src}."
        sections = [
            {
                "title": "Score",
                "hint": hint,
                "start": 1,
                "end": len(semantic_score.measures),
            }
        ]

    def get_section_idx(bar_num: int) -> int:
        for idx, sec in enumerate(sections):
            if sec.get("start", 1) <= bar_num <= sec.get("end", len(semantic_score.measures)):
                return idx
        return 0

    # Cross-measure tie accumulation state:
    # Key: (staff, voice, midi) -> open attack continuing
    open_ties_by_hand: Dict[Tuple[str, int, int], LegacyAttack] = {}

    for m in semantic_score.measures:
        right_attacks: List[LegacyAttack] = []
        left_attacks: List[LegacyAttack] = []

        # Process chord events
        for ev in m.events:
            if not isinstance(ev, SemanticChord):
                continue

            hand = ev.hand
            for note in ev.notes:
                is_incoming = bool(note.tie and note.tie.from_previous)
                is_outgoing = bool(note.tie and note.tie.to_next)
                key = (hand, ev.voice, note.midi)

                if is_incoming and key in open_ties_by_hand:
                    prev_attack = open_ties_by_hand[key]
                    # If in same bar, extend duration
                    if prev_attack.bar == m.number:
                        prev_attack.duration_ticks += ev.duration_ticks
                        prev_attack.tied = prev_attack.tied or is_outgoing
                    if is_outgoing:
                        open_ties_by_hand[key] = prev_attack
                    else:
                        del open_ties_by_hand[key]
                    continue

                attack = LegacyAttack(
                    onset_tick=float(ev.measure_tick),
                    pitch=note.midi,
                    duration_ticks=ev.duration_ticks,
                    tied=is_outgoing,
                    bar=m.number,
                )
                if hand == "R":
                    right_attacks.append(attack)
                else:
                    left_attacks.append(attack)

                if is_outgoing:
                    open_ties_by_hand[key] = attack
                elif key in open_ties_by_hand:
                    del open_ties_by_hand[key]

        bar_events = derive_legacy_bar_events(
            right_attacks, left_attacks, division, m.duration_ticks
        )
        bars.append({
            "n": m.number,
            "section": get_section_idx(m.number),
            "events": bar_events,
        })

    return bars, sections


# -----------------------------------------------------------------------------
# Validation Engine (Structural, Identity, Ties, Timing)
# -----------------------------------------------------------------------------

@dataclass
class ValidationReport:
    valid: bool
    errors: List[dict]
    warnings: List[dict]
    stats: Dict[str, int]

    def to_dict(self) -> dict:
        return {
            "valid": self.valid,
            "errors": self.errors,
            "warnings": self.warnings,
            "stats": self.stats,
        }


def validate_semantic_score(
    score: SemanticScore,
    xml_path: str,
) -> ValidationReport:
    """Validate semantic score against source XML and internal consistency."""
    tree = ET.parse(xml_path)
    root = tree.getroot()
    score_el = first_child(root, "Score")
    assert score_el is not None

    errors: List[dict] = []
    warnings: List[dict] = list(score.warnings)

    measures_count = len(score.measures)
    total_chords = 0
    total_notes = 0
    total_rests = 0
    tie_starts = 0
    tie_ends = 0
    total_tuplets = 0
    total_arpeggios = 0

    # 1. Measure sequence validation
    for idx, m in enumerate(score.measures):
        if m.index != idx or m.number != idx + 1:
            errors.append({
                "type": "measure-sequence-error",
                "message": f"Measure index {m.index} or number {m.number} mismatch at {idx}",
            })

    # 2. Event & Note identity checks
    for m in score.measures:
        for ev in m.events:
            if isinstance(ev, SemanticChord):
                total_chords += 1
                if ev.tuplet:
                    total_tuplets += 1
                if ev.arpeggio:
                    total_arpeggios += 1
                for n in ev.notes:
                    total_notes += 1
                    # Verify MIDI to pianoKey formula
                    expected_key = n.midi - MIDI_TO_KEY_OFFSET
                    if n.piano_key != expected_key:
                        errors.append({
                            "type": "piano-key-mismatch",
                            "message": f"Note MIDI {n.midi} mapped to key {n.piano_key}, expected {expected_key}",
                            "measure": m.number,
                        })
                    # Verify TPC written pitch decoding consistency
                    decoded = decode_tpc(n.tpc, n.midi)
                    if decoded is None or decoded.step != n.written_pitch.step or decoded.alter != n.written_pitch.alter:
                        errors.append({
                            "type": "tpc-decoding-inconsistent",
                            "message": f"TPC {n.tpc} inconsistent with written pitch {n.written_pitch}",
                            "measure": m.number,
                        })
                    if n.tie:
                        if n.tie.to_next:
                            tie_starts += 1
                        if n.tie.from_previous:
                            tie_ends += 1
            elif isinstance(ev, SemanticRest):
                total_rests += 1
                if ev.tuplet:
                    total_tuplets += 1

    # 3. Source XML reconciliation
    raw_staves = all_children(score_el, "Staff")
    u_id = score.staff_selection["rightStaff"]
    l_id = score.staff_selection.get("leftStaff")
    selected_ids = {u_id}
    if l_id is not None:
        selected_ids.add(l_id)

    raw_note_count = 0
    raw_chord_count = 0
    raw_rest_count = 0
    raw_tie_spanners = 0

    for s in raw_staves:
        sid_str = s.get("id")
        if not (sid_str and sid_str.isdigit() and int(sid_str) in selected_ids):
            continue
        for m in all_children(s, "Measure"):
            for v in all_children(m, "voice"):
                for child in v:
                    tag = local_name(child.tag)
                    if tag == "Chord":
                        raw_chord_count += 1
                        for note in all_children(child, "Note"):
                            raw_note_count += 1
                            for sp in all_children(note, "Spanner"):
                                if sp.get("type") == "Tie":
                                    raw_tie_spanners += 1
                    elif tag == "Rest":
                        raw_rest_count += 1

    stats = {
        "measures": measures_count,
        "staffs": len(selected_ids),
        "notes": total_notes,
        "chords": total_chords,
        "rests": total_rests,
        "tieStarts": tie_starts,
        "tieEnds": tie_ends,
        "tuplets": total_tuplets,
        "arpeggios": total_arpeggios,
        "sourceNotes": raw_note_count,
        "sourceChords": raw_chord_count,
        "sourceRests": raw_rest_count,
    }

    if total_notes != raw_note_count:
        errors.append({
            "type": "note-count-mismatch",
            "message": f"Parsed notes ({total_notes}) != source notes ({raw_note_count})",
        })

    is_valid = (len(errors) == 0)
    return ValidationReport(valid=is_valid, errors=errors, warnings=warnings, stats=stats)


# -----------------------------------------------------------------------------
# Main Conversion Pipeline
# -----------------------------------------------------------------------------

def convert_mscx_to_json(
    xml_path: str,
    output_path: Optional[str] = None,
    sections_source_path: Optional[str] = None,
    manual_staffs: Optional[str] = None,
    validate: bool = True,
) -> Tuple[dict, ValidationReport]:
    """Execute complete MSCX conversion pipeline."""
    # 1. Authoritative Semantic Parsing
    semantic_score = parse_score(xml_path, manual_staffs=manual_staffs)

    # 2. Read sections metadata from existing piece if available
    sections_meta: Optional[List[dict]] = None
    if sections_source_path:
        try:
            with open(sections_source_path, "r", encoding="utf-8") as f:
                src_data = json.load(f)
                if isinstance(src_data.get("sections"), list):
                    sections_meta = src_data["sections"]
        except Exception as e:
            sys.stderr.write(f"Warning: could not read sections from {sections_source_path}: {e}\n")

    # 3. Derive backward-compatible legacy bars
    bars, sections = build_legacy_bars_from_semantic(semantic_score, sections_meta)

    # 4. Construct unified Schema v2 JSON
    output_json: Dict[str, Any] = {
        "schemaVersion": 2,
        "id": semantic_score.id,
        "title": semantic_score.title,
        "composer": semantic_score.composer,
    }
    if semantic_score.subtitle:
        output_json["subtitle"] = semantic_score.subtitle
    if semantic_score.tempo_bpm:
        output_json["tempo"] = semantic_score.tempo_bpm

    output_json["sections"] = sections
    output_json["bars"] = bars
    output_json["semantic"] = semantic_score.to_dict()

    # 5. Validation
    validation_report = validate_semantic_score(semantic_score, xml_path)

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(output_json, f, indent=2)

    return output_json, validation_report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert MuseScore .mscx file to authoritative semantic and legacy JSON."
    )
    parser.add_argument("file", help="Path to uncompressed MuseScore .mscx file")
    parser.add_argument("-o", "--output", help="Write output JSON to this file (default: stdout)")
    parser.add_argument("--sections-from", help="Optional path to existing piece.json to inherit authored sections")
    parser.add_argument("--staffs", help="Explicit MuseScore staff ids (e.g. '1' or '1,2')")
    parser.add_argument("--validate", action="store_true", help="Print validation report to stderr")
    parser.add_argument("--report-only", action="store_true", help="Only print validation report")

    args = parser.parse_args()

    try:
        out_data, val_report = convert_mscx_to_json(
            args.file,
            output_path=args.output,
            sections_source_path=args.sections_from,
            manual_staffs=args.staffs,
            validate=True,
        )
    except Exception as exc:
        sys.stderr.write(f"Conversion error: {exc}\n")
        import traceback
        traceback.print_exc()
        return 1

    if args.validate or args.report_only:
        sys.stderr.write(json.dumps(val_report.to_dict(), indent=2) + "\n")

    if not args.output and not args.report_only:
        print(json.dumps(out_data, indent=2))

    return 0 if val_report.valid else 2


if __name__ == "__main__":
    sys.exit(main())
