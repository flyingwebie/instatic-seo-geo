"""Bake Inter glyph outlines into src/og/fonts.generated.ts.

The social-image renderer runs inside the plugin sandbox (no font APIs,
no WebAssembly), so it draws glyphs from pre-decomposed quadratic outlines.
Run once when changing fonts or the character set:

    python3 -m venv /tmp/ogfont && /tmp/ogfont/bin/pip install fonttools
    /tmp/ogfont/bin/python scripts/og-font.py <Inter-Regular.ttf> <Inter-SemiBold.ttf> <Inter-Bold.ttf>

Inter is licensed under the SIL Open Font License 1.1 (see src/og/FONT-LICENSE.txt).
"""

import json
import sys
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.ttLib import TTFont

RANGES = [(0x20, 0x7E), (0xA0, 0xFF), (0x100, 0x17F)]
EXTRA = [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2026,
         0x20AC, 0x2122, 0x2190, 0x2192, 0x00B7, 0x2032, 0x2033]
CODEPOINTS = sorted({cp for a, b in RANGES for cp in range(a, b + 1)} | set(EXTRA))
MIN_KERN = 12  # font units; smaller pairs are invisible at social-image sizes
KERN_MAX_CP = 0x7E  # accented letters reuse their base letter's kerning at runtime


def outline(glyph_set, name):
    pen = DecomposingRecordingPen(glyph_set)
    glyph_set[name].draw(pen)
    out = []
    current = None
    for op, args in pen.value:
        if op == "moveTo":
            current = args[0]
            out.append("M%d,%d" % current)
        elif op == "lineTo":
            current = args[0]
            out.append("L%d,%d" % current)
        elif op == "qCurveTo":
            points = list(args)
            if points[-1] is None:  # closed contour of off-curve points only
                points = points[:-1]
                implied = ((points[-1][0] + points[0][0]) / 2, (points[-1][1] + points[0][1]) / 2)
                out.append("M%d,%d" % implied)
                points.append(implied)
            *offs, end = points
            for i, off in enumerate(offs):
                target = end if i == len(offs) - 1 else (
                    (off[0] + offs[i + 1][0]) / 2, (off[1] + offs[i + 1][1]) / 2)
                out.append("Q%d,%d,%d,%d" % (off[0], off[1], target[0], target[1]))
            current = end
        elif op == "curveTo":
            raise SystemExit("Cubic outlines are not supported; use the TrueType (glyf) build.")
        elif op in ("closePath", "endPath"):
            out.append("Z")
    return "".join(out)


def kerning(font, cmap, wanted):
    """Flatten GPOS 'kern' pair adjustments between the baked characters."""
    names = {cmap[cp]: cp for cp in wanted if cp in cmap}
    pairs = {}
    gpos = font["GPOS"].table if "GPOS" in font else None
    if not gpos:
        return pairs
    lookups = set()
    for record in gpos.FeatureList.FeatureRecord:
        if record.FeatureTag == "kern":
            lookups.update(record.Feature.LookupListIndex)
    for index in sorted(lookups):
        lookup = gpos.LookupList.Lookup[index]
        subtables = lookup.SubTable
        if lookup.LookupType == 9:
            subtables = [s.ExtSubTable for s in subtables]
        for sub in subtables:
            if getattr(sub, "LookupType", 2) != 2 and lookup.LookupType != 9:
                continue
            coverage = sub.Coverage.glyphs
            if sub.Format == 1:
                for i, first in enumerate(coverage):
                    if first not in names:
                        continue
                    for pvr in sub.PairSet[i].PairValueRecord:
                        if pvr.SecondGlyph in names and pvr.Value1 and getattr(pvr.Value1, "XAdvance", 0):
                            key = (names[first], names[pvr.SecondGlyph])
                            pairs.setdefault(key, pvr.Value1.XAdvance)
            elif sub.Format == 2:
                class1 = sub.ClassDef1.classDefs
                class2 = sub.ClassDef2.classDefs
                for first in coverage:
                    if first not in names:
                        continue
                    c1 = class1.get(first, 0)
                    for second in names:
                        c2 = class2.get(second, 0)
                        record = sub.Class1Record[c1].Class2Record[c2]
                        value = getattr(record.Value1, "XAdvance", 0) if record.Value1 else 0
                        if value:
                            pairs.setdefault((names[first], names[second]), value)
    return {k: v for k, v in pairs.items() if abs(v) >= MIN_KERN}


def components(font, name):
    """Plain-offset composite parts, or None when the glyph needs decomposing."""
    glyph = font["glyf"][name]
    if not glyph.isComposite():
        return None
    parts = []
    for comp in glyph.components:
        if hasattr(comp, "transform") or hasattr(comp, "firstPt"):
            return None  # scaled/rotated, or point-matched: keep the outline
        parts.append((comp.glyphName, comp.x, comp.y))
    return parts


def bake(path):
    font = TTFont(path)
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    hmtx = font["hmtx"]
    os2 = font["OS/2"]
    names = {}  # glyph name -> "outline" or "@a,dx,dy;b,dx,dy"
    order = []

    def add(name):
        if name in names:
            return
        parts = components(font, name)
        if parts is None:
            names[name] = outline(glyph_set, name)
        else:
            for part, _, _ in parts:
                add(part)
            names[name] = "@" + ";".join("%s,%d,%d" % p for p in parts)
        order.append(name)

    chars = {}
    for cp in CODEPOINTS:
        name = cmap.get(cp)
        if not name:
            continue
        add(name)
        chars[str(cp)] = [name, hmtx[name][0]]
    kern = kerning(font, cmap, [cp for cp in CODEPOINTS if cp <= KERN_MAX_CP])
    return {
        "unitsPerEm": font["head"].unitsPerEm,
        "ascender": os2.sTypoAscender,
        "descender": os2.sTypoDescender,
        "capHeight": getattr(os2, "sCapHeight", 0),
        "chars": chars,
        "outlines": {name: names[name] for name in order},
        "kern": ";".join("%d,%d,%d" % (a, b, v) for (a, b), v in sorted(kern.items())),
    }


def main():
    if len(sys.argv) != 4:
        raise SystemExit(__doc__)
    weights = dict(zip(["regular", "semibold", "bold"], sys.argv[1:]))
    data = {weight: bake(path) for weight, path in weights.items()}
    with open("src/og/fonts.generated.ts", "w") as out:
        out.write("// Generated by scripts/og-font.py from Inter 4.1 (SIL OFL 1.1). Do not edit.\n")
        out.write("export const FONTS = ")
        out.write(json.dumps(data, separators=(",", ":")))
        out.write(" as const;\n")
    for weight, font in data.items():
        print(weight, len(font["chars"]), "chars,", len(font["outlines"]), "outlines,", font["kern"].count(";") + 1, "kern pairs")


if __name__ == "__main__":
    main()
