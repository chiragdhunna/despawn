#!/usr/bin/env python3
"""Generates the Despawn logo set as pixel-grid SVGs (no font dependency).

Run:  python3 generate_logo.py
Out:  logo-dark.svg, logo-light.svg, logo-mark.svg, favicon.svg

Palette (see docs/UI_DESIGN.md):
  soot #1A140D, parchment #F2E6CE, amber #FFB000, deep amber #E09A00
"""

CELL = 4  # one pixel of the logo = 4 SVG units on the lockup

# ---- the mark: a page with a keyhole, bottom-right corner despawning --------
PAGE_COLS = range(3, 12)   # 9 cells wide
PAGE_ROWS = range(2, 14)   # 12 cells tall
FOLD_CUT = {(10, 2), (11, 2), (11, 3)}
FOLD_TINT = {(10, 3)}                      # drawn at reduced opacity
KEYHOLE = {(6, 4), (7, 4), (8, 4),
           (5, 5), (6, 5), (7, 5), (8, 5), (9, 5),
           (5, 6), (6, 6), (7, 6), (8, 6), (9, 6),
           (6, 7), (7, 7), (8, 7),
           (7, 8), (7, 9),
           (6, 10), (7, 10), (8, 10)}
DISSOLVED = {(11, 10), (11, 11), (11, 12), (11, 13),
             (10, 11), (10, 12), (10, 13),
             (9, 12), (9, 13), (8, 13),
             (11, 9), (9, 11), (7, 13)}    # last row = ragged edge
# (col, row, size in cells, opacity) drifting up-and-right, fading
PARTICLES = [(12, 9, 1, .80), (13, 7, 1, .60), (12, 11, 1, .55),
             (14, 9, 1, .42), (13, 12, 1, .32), (15, 6, .5, .30),
             (14, 12, .5, .28)]


def mark_rects(fill, particle_fill, ox=0, oy=0, cell=CELL):
    out = []
    for r in PAGE_ROWS:
        for c in PAGE_COLS:
            p = (c, r)
            if p in FOLD_CUT or p in KEYHOLE or p in DISSOLVED:
                continue
            op = ' fill-opacity=".55"' if p in FOLD_TINT else ''
            out.append(f'<rect x="{ox + c*cell:g}" y="{oy + r*cell:g}" width="{cell:g}" height="{cell:g}" fill="{fill}"{op}/>')
    for c, r, s, o in PARTICLES:
        out.append(f'<rect x="{ox + c*cell:g}" y="{oy + r*cell:g}" width="{s*cell:g}" height="{s*cell:g}" fill="{particle_fill}" fill-opacity="{o}"/>')
    return out


# ---- the wordmark: 5x7 bitmap letters, last letter despawning ----------------
GLYPHS = {
    'D': ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    'E': ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    'S': ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    'P': ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    'A': ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    'W': ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    'N': ["10001", "11001", "10101", "10101", "10011", "10001", "10001"],
}
WORD = "DESPAWN"
N_DISSOLVED = {(4, 5), (4, 6)}
WORD_PARTICLES = [(5.5, 4, 1, .7), (6.5, 2, 1, .5), (7.5, 0.5, .5, .35), (6, 6, .5, .4)]


def word_rects(fill, particle_fill, ox, oy, cell=CELL):
    out, x = [], 0
    for i, ch in enumerate(WORD):
        for r, row in enumerate(GLYPHS[ch]):
            for c, bit in enumerate(row):
                if bit != '1':
                    continue
                if i == len(WORD) - 1 and (c, r) in N_DISSOLVED:
                    continue
                out.append(f'<rect x="{ox + (x+c)*cell:g}" y="{oy + r*cell:g}" width="{cell:g}" height="{cell:g}" fill="{fill}"/>')
        x += 6  # 5 cols + 1 gap
    last_x = x - 6
    for c, r, s, o in WORD_PARTICLES:
        out.append(f'<rect x="{ox + (last_x + c)*cell:g}" y="{oy + r*cell:g}" width="{s*cell:g}" height="{s*cell:g}" fill="{particle_fill}" fill-opacity="{o}"/>')
    return out


def svg(w, h, body, title, bg=None, extra=""):
    bgrect = f'<rect width="{w}" height="{h}" rx="{bg[1]}" fill="{bg[0]}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'role="img" aria-label="{title}" shape-rendering="crispEdges">\n<title>{title}</title>{extra}\n'
            f'{bgrect}\n' + "\n".join(body) + '\n</svg>\n')


def lockup(page, word, particles):
    body = mark_rects(page, particles)
    body += word_rects(word, particles, ox=80, oy=18)
    return body


W_LOCK, H_LOCK = 264, 64

files = {
    "logo-dark.svg": svg(W_LOCK, H_LOCK, lockup("#FFB000", "#F2E6CE", "#FFB000"), "Despawn"),
    "logo-light.svg": svg(W_LOCK, H_LOCK, lockup("#1A140D", "#1A140D", "#E09A00"), "Despawn"),
}

# app icon: 512 square, mark centred inside the maskable safe zone
cell_big = 24  # 24 units per logo pixel on the 512 canvas
max_col = max([c + 1 for c in PAGE_COLS] + [p[0] + p[2] for p in PARTICLES])
ox = 256 - ((3 + max_col) / 2) * cell_big
oy = 256 - ((2 + 14) / 2) * cell_big
files["logo-mark.svg"] = svg(512, 512, mark_rects("#FFB000", "#FFB000", ox, oy, cell_big),
                             "Despawn app icon", bg=("#1A140D", 112))

# favicon: adapts to light/dark browser chrome
fav_style = ('<style>.p{fill:#FFB000}.q{fill:#FFB000}'
             '@media (prefers-color-scheme: light){.p{fill:#1A140D}.q{fill:#E09A00}}</style>')
fav = []
for line in mark_rects("PAGE", "PART", 0, 0, 2):
    fav.append(line.replace('fill="PAGE"', 'class="p"').replace('fill="PART"', 'class="q"'))
files["favicon.svg"] = svg(32, 32, fav, "Despawn", extra=fav_style)

if __name__ == "__main__":
    for name, content in files.items():
        with open(name, "w") as f:
            f.write(content)
        print("wrote", name, len(content), "bytes")
