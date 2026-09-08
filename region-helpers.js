(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.PianoRegions = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PIANO_REGIONS = [
    {
      id: 1,
      name: "Red",
      label: "Low Red",
      start: 4,
      end: 15,
      color: "#E53935",
      border: "#B71C1C",
      textInk: "#FFFFFF",
      lowPartial: [1, 2, 3],
    },
    {
      id: 2,
      name: "Orange",
      label: "Orange",
      start: 16,
      end: 27,
      color: "#FB8C00",
      border: "#E65100",
      textInk: "#161410",
    },
    {
      id: 3,
      name: "Yellow",
      label: "Yellow",
      start: 28,
      end: 39,
      color: "#FDD835",
      border: "#F57F17",
      textInk: "#161410",
    },
    {
      id: 4,
      name: "Green",
      label: "Green",
      start: 40,
      end: 51,
      color: "#43A047",
      border: "#1B5E20",
      textInk: "#FFFFFF",
      landmark: "Middle C (40)",
    },
    {
      id: 5,
      name: "Blue",
      label: "Blue",
      start: 52,
      end: 63,
      color: "#1E88E5",
      border: "#0D47A1",
      textInk: "#FFFFFF",
    },
    {
      id: 6,
      name: "Violet",
      label: "Violet",
      start: 64,
      end: 75,
      color: "#8E24AA",
      border: "#4A148C",
      textInk: "#FFFFFF",
    },
    {
      id: 7,
      name: "Pink",
      label: "High Pink",
      start: 76,
      end: 87,
      color: "#D81B60",
      border: "#880E4F",
      textInk: "#FFFFFF",
      highPartial: [88],
    },
  ];

  const REGION_MAP_BY_ID = new Map(PIANO_REGIONS.map(function (r) { return [r.id, r]; }));

  const THRESHOLDS = {
    SMALL_MOVE: 3,
    SIGNIFICANT_MOVE: 6,
    LARGE_JUMP: 12,
  };

  const REGION_POSITIONS = [
    { pos: 1, name: "C", isBlack: false },
    { pos: 2, name: "C#", isBlack: true },
    { pos: 3, name: "D", isBlack: false },
    { pos: 4, name: "D#", isBlack: true },
    { pos: 5, name: "E", isBlack: false },
    { pos: 6, name: "F", isBlack: false },
    { pos: 7, name: "F#", isBlack: true },
    { pos: 8, name: "G", isBlack: false },
    { pos: 9, name: "G#", isBlack: true },
    { pos: 10, name: "A", isBlack: false },
    { pos: 11, name: "A#", isBlack: true },
    { pos: 12, name: "B", isBlack: false },
  ];

  function midiNoteToPianoKey(midiNote) {
    if (typeof midiNote !== "number" || isNaN(midiNote)) return null;
    const note = Math.round(midiNote);
    if (note < 21 || note > 108) return null;
    return note - 20;
  }

  function pianoKeyToMidiNote(keyNumber) {
    if (typeof keyNumber !== "number" || isNaN(keyNumber)) return null;
    const key = Math.round(keyNumber);
    if (key < 1 || key > 88) return null;
    return key + 20;
  }

  function getRegionForPianoKey(keyNumber) {
    if (typeof keyNumber !== "number" || isNaN(keyNumber)) return null;
    const key = Math.round(keyNumber);
    if (key < 1 || key > 88) return null;

    if (key <= 15) return REGION_MAP_BY_ID.get(1);
    if (key <= 27) return REGION_MAP_BY_ID.get(2);
    if (key <= 39) return REGION_MAP_BY_ID.get(3);
    if (key <= 51) return REGION_MAP_BY_ID.get(4);
    if (key <= 63) return REGION_MAP_BY_ID.get(5);
    if (key <= 75) return REGION_MAP_BY_ID.get(6);
    return REGION_MAP_BY_ID.get(7);
  }

  function getPositionWithinRegion(keyNumber) {
    if (typeof keyNumber !== "number" || isNaN(keyNumber)) return null;
    const key = Math.round(keyNumber);
    if (key < 1 || key > 88) return null;
    const idx = (((key - 4) % 12) + 12) % 12;
    return REGION_POSITIONS[idx];
  }

  function getRegionColor(regionId) {
    const region = REGION_MAP_BY_ID.get(regionId);
    return region ? region.color : null;
  }

  function getRegionsForKeys(keys) {
    if (!keys || !keys.length) return [];
    const seen = new Set();
    const result = [];
    keys.forEach(function (k) {
      const reg = getRegionForPianoKey(k);
      if (reg && !seen.has(reg.id)) {
        seen.add(reg.id);
        result.push(reg);
      }
    });
    result.sort(function (a, b) { return a.id - b.id; });
    return result;
  }

  function getKeyDistance(fromKey, toKey) {
    if (typeof fromKey !== "number" || typeof toKey !== "number") return 0;
    return Math.abs(Math.round(toKey) - Math.round(fromKey));
  }

  function getKeyRange(keys) {
    if (!keys || !keys.length) return null;
    let min = Infinity;
    let max = -Infinity;
    keys.forEach(function (k) {
      if (typeof k === "number" && !isNaN(k) && k >= 1 && k <= 88) {
        if (k < min) min = k;
        if (k > max) max = k;
      }
    });
    if (min === Infinity) return null;
    return { min: min, max: max, count: keys.length };
  }

  function getRangeDistance(rangeA, rangeB) {
    if (!rangeA || !rangeB) return 0;
    if (rangeA.max < rangeB.min) return rangeB.min - rangeA.max;
    if (rangeB.max < rangeA.min) return rangeA.min - rangeB.max;
    return 0;
  }

  function getRangeCenter(range) {
    if (!range) return 0;
    return (range.min + range.max) / 2;
  }

  function centerWindowOnRange(focusRange, windowSize, opts) {
    const options = opts || {};
    const pianoStart = options.pianoStart || 1;
    const pianoEnd = options.pianoEnd || 88;
    const mustInclude = options.mustInclude || null;
    const pianoSpan = pianoEnd - pianoStart + 1;
    const size = Math.max(1, Math.min(pianoSpan, Math.round(windowSize) || 1));

    function clampWindow(start) {
      const maxStart = pianoEnd - size + 1;
      const clampedStart = Math.max(pianoStart, Math.min(maxStart, start));
      return { startKey: clampedStart, endKey: Math.min(pianoEnd, clampedStart + size - 1) };
    }

    let min = focusRange ? focusRange.min : null;
    let max = focusRange ? focusRange.max : null;

    if (mustInclude) {
      if (min == null) {
        min = mustInclude.min;
        max = mustInclude.max;
      } else {
        const unionMin = Math.min(min, mustInclude.min);
        const unionMax = Math.max(max, mustInclude.max);
        if (unionMax - unionMin + 1 <= size) {
          min = unionMin;
          max = unionMax;
        }
      }
    }

    if (min == null) {
      return clampWindow(40 - Math.floor((size - 1) / 2));
    }

    const extra = size - (max - min + 1);
    return clampWindow(min - Math.floor(extra / 2));
  }

  function calculateHandMovement(currentKeys, nextKeys, handName, thresholds) {
    const th = Object.assign({}, THRESHOLDS, thresholds || {});
    const curRange = getKeyRange(currentKeys);
    const nxtRange = getKeyRange(nextKeys);

    if (!curRange || !nxtRange) {
      return {
        hand: handName || "hand",
        currentRange: curRange,
        nextRange: nxtRange,
        distance: 0,
        direction: "none",
        level: "none",
        currentRegions: curRange ? getRegionsForKeys(currentKeys) : [],
        destinationRegions: nxtRange ? getRegionsForKeys(nextKeys) : [],
        crossesRegion: false,
        requiresJumpWarning: false,
      };
    }

    const curCenter = getRangeCenter(curRange);
    const nxtCenter = getRangeCenter(nxtRange);
    const centerDiff = nxtCenter - curCenter;
    const distance = Math.round(Math.abs(centerDiff));

    let direction = "none";
    if (centerDiff > 0.5) direction = "right";
    else if (centerDiff < -0.5) direction = "left";

    let level = "none";
    if (distance >= th.LARGE_JUMP) level = "jump";
    else if (distance >= th.SIGNIFICANT_MOVE) level = "move";
    else if (distance >= th.SMALL_MOVE) level = "reposition";

    const curRegions = getRegionsForKeys(currentKeys);
    const dstRegions = getRegionsForKeys(nextKeys);

    const curRegionIds = new Set(curRegions.map(function (r) { return r.id; }));
    const dstRegionIds = new Set(dstRegions.map(function (r) { return r.id; }));

    let crossesRegion = false;
    dstRegionIds.forEach(function (id) {
      if (!curRegionIds.has(id)) crossesRegion = true;
    });

    const requiresJumpWarning = distance >= th.LARGE_JUMP;

    return {
      hand: handName || "hand",
      currentRange: curRange,
      nextRange: nxtRange,
      distance: distance,
      direction: direction,
      level: level,
      currentRegions: curRegions,
      destinationRegions: dstRegions,
      crossesRegion: crossesRegion,
      requiresJumpWarning: requiresJumpWarning,
    };
  }

  return {
    PIANO_REGIONS: PIANO_REGIONS,
    THRESHOLDS: THRESHOLDS,
    REGION_POSITIONS: REGION_POSITIONS,
    midiNoteToPianoKey: midiNoteToPianoKey,
    pianoKeyToMidiNote: pianoKeyToMidiNote,
    getRegionForPianoKey: getRegionForPianoKey,
    getPositionWithinRegion: getPositionWithinRegion,
    getRegionColor: getRegionColor,
    getRegionsForKeys: getRegionsForKeys,
    getKeyDistance: getKeyDistance,
    getKeyRange: getKeyRange,
    getRangeDistance: getRangeDistance,
    centerWindowOnRange: centerWindowOnRange,
    calculateHandMovement: calculateHandMovement,
  };
});
