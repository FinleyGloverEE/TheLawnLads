#!/usr/bin/env python3
"""
Draws the "Where we cover" map on the home page from OpenStreetMap data.

The map is a plain SVG written into index.html, so visitors' browsers don't contact
any map service (no Google Maps, no tile server) and the security policy stays as it is.
Colours and fonts come from site.css (the .map-* rules).

Run it again whenever the places in config.js `serviceAreas` change:

    pip install shapely fonttools brotli
    python3 _map/build-map.py

It reads the place names and centre points from config.js, downloads parish boundaries
(Nominatim) and the M69, A5 and A47 (OpenStreetMap API), then replaces the SVG between the
<!-- area-map --> markers in index.html. Downloads are cached in your temp folder, so
re-running is quick. The heading and paragraph next to the map are ordinary HTML in
index.html: update the list of places there by hand.

Map data © OpenStreetMap contributors, ODbL (the credit is under the map on the page).
"""
import json, math, os, re, sys, tempfile, time, urllib.parse, urllib.request
from shapely.geometry import shape, box, Point, LineString
from shapely.ops import unary_union, linemerge, transform
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(tempfile.gettempdir(), "lawnlads-map-cache")
UA = "TheLawnLads-map-builder/1.0 (+https://thelawnlads.co.uk)"

# ------------------------------------------------------------------ settings you might change
# Map frame (degrees). Everything covered has to fit inside it.
W_LON, E_LON, S_LAT, N_LAT = -1.446, -1.240, 52.4965, 52.6000

# Which side of its pin each place's label goes: r(ight), l(eft), t(op) or b(ottom).
# A place not listed gets "r". Move a label if it covers something.
LABEL_SIDE = {"Hinckley": "r", "Burbage": "l", "Barwell": "l", "Earl Shilton": "r",
              "Stoke Golding": "t", "Sapcote": "b"}
HOME = "Hinckley"   # drawn in orange

# Villages just outside, in grey, so people can see where the edge is. Any of these that
# is added to serviceAreas is drawn as covered instead. name: (lon, lat, text-anchor, dx, dy)
NEARBY = {
    "Stoney Stanton":     (-1.2806, 52.5482, "start", 12, 8),
    "Elmesthorpe":        (-1.3089, 52.5604, "start", 12, 8),
    "Aston Flamville":    (-1.3202, 52.5300, "middle", 0, 34),
    "Sharnford":          (-1.2928, 52.5224, "start", 12, 8),
    "Higham on the Hill": (-1.4384, 52.5558, "start", 12, 8),
}

# Roads: OpenStreetMap route relations, plus a name search to fill pieces they miss.
ROADS = {"m69": (13019988, None), "a5": (13054406, "A5"), "a47": (9633493, "A47")}
# Road number boxes: label, style, road, rough spot on the map (snapped onto the road).
SHIELDS = [("M69", "m", "m69", (650, 468)), ("A5", "a", "a5", (560, 770)), ("A47", "a", "a47", (190, 440))]

# Hinckley town has no parish (it's an "unparished area"), so OpenStreetMap has no boundary
# for it. It's worked out as what's left of the district after removing these parishes.
HINCKLEY_NEIGHBOURS = ["Burbage", "Barwell", "Earl Shilton", "Stoke Golding",
                       "Higham on the Hill", "Sutton Cheney", "Peckleton"]

# ------------------------------------------------------------------ downloads
_last_nominatim = [0.0]

def fetch(url, name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        if "nominatim" in url:   # usage policy: at most one request a second
            time.sleep(max(0, 1.1 - (time.time() - _last_nominatim[0])))
            _last_nominatim[0] = time.time()
        print("  downloading", name)
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=300) as r:
            data = r.read()
        with open(path, "wb") as f:
            f.write(data)
    with open(path, encoding="utf-8") as f:
        return json.load(f)

def nominatim(q, **extra):
    params = {"q": q, "format": "jsonv2", "polygon_geojson": 1, "limit": 40, **extra}
    slug = re.sub(r"[^a-z0-9]+", "-", (q + "-" + "-".join(map(str, extra.values()))).lower()).strip("-")
    return fetch("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params), "nominatim-" + slug + ".json")

def boundary(place, county="Leicestershire"):
    for r in nominatim(f"{place}, {county}", countrycodes="gb"):
        if r["osm_type"] == "relation" and r["category"] == "boundary" and r["geojson"]["type"] in ("Polygon", "MultiPolygon"):
            return shape(r["geojson"])
    return None

def relation_lines(rel_id):
    d = fetch(f"https://api.openstreetmap.org/api/0.6/relation/{rel_id}/full.json", f"relation-{rel_id}.json")
    nodes = {e["id"]: (e["lon"], e["lat"]) for e in d["elements"] if e["type"] == "node"}
    out = []
    for e in d["elements"]:
        hw = e.get("tags", {}).get("highway", "") if e["type"] == "way" else ""
        if hw and not hw.endswith("_link"):
            pts = [nodes[n] for n in e["nodes"] if n in nodes]
            if len(pts) > 1:
                out.append(LineString(pts))
    return out

def search_lines(ref):
    view = f"{W_LON - 0.03:.3f},{N_LAT + 0.02:.3f},{E_LON + 0.03:.3f},{S_LAT - 0.02:.3f}"
    return [shape(r["geojson"]) for r in nominatim(ref, viewbox=view, bounded=1)
            if r["geojson"]["type"] == "LineString" and r.get("category") == "highway"]

# ------------------------------------------------------------------ projection
frame = box(W_LON, S_LAT, E_LON, N_LAT)
KX = math.cos(math.radians((S_LAT + N_LAT) / 2))
SCALE = 1000 / ((E_LON - W_LON) * KX)          # the map is 1000 units wide
H = round((N_LAT - S_LAT) * SCALE)
MILE = 1.609344 / 111.32 * SCALE
KM = 1 / 111.32 * SCALE

def proj(x, y, z=None):
    return ((x - W_LON) * KX * SCALE, (N_LAT - y) * SCALE)

def pt(lon, lat):
    x, y = proj(lon, lat)
    return round(x), round(y)

def coords_d(coords, close=False):
    pts, prev = [], None
    for x, y in coords:
        q = (str(round(x)), str(round(y)))
        if q != prev:
            pts.append(q); prev = q
    if close and len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    return ("M" + " ".join(f"{a} {b}" for a, b in pts) + ("Z" if close else "")) if len(pts) > 1 else ""

def d_poly(g, tol=1.8):
    g = transform(proj, g).simplify(tol, preserve_topology=True)
    return "".join(coords_d(r.coords, close=True)
                   for p in (g.geoms if hasattr(g, "geoms") else [g])
                   for r in [p.exterior, *p.interiors])

def d_road(lines, tol=1.4, gap=50):
    """One tidy set of strokes for a road. OpenStreetMap draws dual carriageways and junctions
    as many short pieces; with a thick round-capped stroke they read as one road, so pieces are
    chained into long strokes, junction scraps dropped, and small gaps (pieces a route relation
    misses, usually roundabouts) bridged."""
    clip = box(-20, -20, 1020, H + 20)
    g = unary_union([transform(proj, l).intersection(clip) for l in lines])
    g = linemerge(g) if g.geom_type == "MultiLineString" else g
    pieces = [list(c.coords) for c in (g.geoms if hasattr(g, "geoms") else [g]) if c.geom_type == "LineString"]

    def heading(a, b):
        return math.atan2(b[1] - a[1], b[0] - a[0])

    # chain pieces that meet end to end, carrying on in the straightest direction
    unused = sorted(range(len(pieces)), key=lambda i: -LineString(pieces[i]).length)
    chains = []
    while unused:
        cur = pieces[unused.pop(0)]
        for _ in range(2):
            while True:
                end, before = cur[-1], cur[-2]
                h0, best = heading(before, end), None
                for i in unused:
                    p = pieces[i]
                    for cand in (p, p[::-1]):
                        if math.dist(cand[0], end) < 0.6:
                            turn = abs((heading(cand[0], cand[1]) - h0 + math.pi) % (2 * math.pi) - math.pi)
                            if turn < math.radians(70) and (best is None or turn < best[0]):
                                best = (turn, i, cand)
                if not best:
                    break
                unused.remove(best[1])
                cur = cur + best[2][1:]
            cur = cur[::-1]
        chains.append(cur)
    chains = [c for c in chains if LineString(c).length >= 8]

    # bridge dangling ends that nearly meet
    inside = box(10, 10, 990, H - 10)
    ends = []
    for i, c in enumerate(chains):
        for e in (c[0], c[-1]):
            p = Point(e)
            if inside.contains(p) and not any(j != i and LineString(o).distance(p) < 2 for j, o in enumerate(chains)):
                ends.append((p, i))
    pairs = sorted((a[0].distance(b[0]), ia, ib) for ia, a in enumerate(ends) for ib, b in enumerate(ends)
                   if ia < ib and a[1] != b[1] and a[0].distance(b[0]) < gap)
    used, bridges = set(), []
    for _, ia, ib in pairs:
        if ia not in used and ib not in used:
            used.update((ia, ib))
            bridges.append([ends[ia][0].coords[0], ends[ib][0].coords[0]])
    loose = {}
    for k, (_, i) in enumerate(ends):
        if k not in used:
            loose[i] = loose.get(i, 0) + 1
    keep = [c for i, c in enumerate(chains) if not (loose.get(i) == 2 and LineString(c).length < 60)] + bridges
    return "".join(coords_d(LineString(c).simplify(tol).coords) for c in keep)

# ------------------------------------------------------------------ label widths
FONT = TTFont(os.path.join(ROOT, "atkinson-hyperlegible-700-latin.woff2"))
CMAP, HMTX, UPM = FONT.getBestCmap(), FONT["hmtx"], FONT["head"].unitsPerEm

def text_w(s, size):
    return sum(HMTX[CMAP[ord(c)]][0] for c in s) * size / UPM

def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

# ------------------------------------------------------------------ build
def main():
    config = open(os.path.join(ROOT, "config.js"), encoding="utf-8").read()
    areas = [(m[0], float(m[1]), float(m[2])) for m in
             re.findall(r'\{\s*name:\s*"([^"]+)",\s*lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)\s*\}', config)]
    if not areas:
        sys.exit("Couldn't find serviceAreas in config.js")
    print("Places:", ", ".join(a[0] for a in areas))

    shapes = {}
    for name, lat, lon in areas:
        g = boundary(name)
        if g is None and name == "Hinckley":
            district = boundary("Hinckley and Bosworth")
            around = district.intersection(box(-1.50, 52.49, -1.28, 52.62))
            rest = around.difference(unary_union([boundary(n) for n in HINCKLEY_NEIGHBOURS]))
            g = [p for p in getattr(rest, "geoms", [rest]) if p.contains(Point(lon, lat))][0]
        if g is None:
            sys.exit(f"No boundary found for {name}. Check the spelling matches the parish name.")
        if not frame.contains(g.buffer(-0.001)):
            print(f"  warning: {name} goes outside the map frame; widen W_LON/E_LON/S_LAT/N_LAT")
        shapes[name] = g
    cover = unary_union(list(shapes.values()))

    roads = {}
    for key, (rel, ref) in ROADS.items():
        lines = relation_lines(rel) + (search_lines(ref) if ref else [])
        roads[key] = (lines, d_road(lines))

    def shield(label, cls, road, spot):
        g = transform(proj, unary_union(roads[road][0]))
        p = g.interpolate(g.project(Point(spot)))
        w = round(text_w(label, 24) + 20)
        return (f'<g class="map-shield {cls}"><rect x="{round(p.x) - w / 2:g}" y="{round(p.y) - 17}" width="{w}" height="34" rx="6"/>'
                f'<text x="{round(p.x)}" y="{round(p.y) + 8}">{label}</text></g>')

    def town(name, lat, lon):
        x, y = pt(lon, lat)
        size, pad, th, gap = 34, 13, 50, 16
        w = round(text_w(name, size) + 2 * pad)
        side = LABEL_SIDE.get(name, "r")
        rx, ry = {"r": (x + gap, y - th / 2), "l": (x - gap - w, y - th / 2),
                  "t": (x - w / 2, y - gap - th), "b": (x - w / 2, y + gap)}[side]
        rx, ry = round(rx), round(ry)
        home = name == HOME
        return (f'<g class="map-town{" home" if home else ""}">'
                f'<rect class="tag-shadow" x="{rx + 6}" y="{ry + 6}" width="{w}" height="{th}" rx="7"/>'
                f'<rect class="tag" x="{rx}" y="{ry}" width="{w}" height="{th}" rx="7"/>'
                f'<text x="{rx + w / 2:g}" y="{ry + 35}">{esc(name)}</text>'
                f'<circle class="pin" cx="{x}" cy="{y}" r="{12 if home else 9}"/></g>')

    names = [a[0] for a in areas]
    listed = ", ".join(names[:-1]) + " and " + names[-1] if len(names) > 1 else names[0]
    cover_d = d_poly(cover)
    exits = [("LEICESTER ↗", 985, 40, "end"), ("COVENTRY ↙", 330, H - 18, "start"), ("NUNEATON ←", 16, 600, "start")]
    sx, sy = 30, H - 34
    svg = "".join([
        f'<svg class="area-map-svg" viewBox="0 0 1000 {H}" role="img" aria-labelledby="area-map-title" focusable="false">',
        f'<title id="area-map-title">Map of the area The Lawn Lads covers: {esc(listed)}, with the M69, A5 and A47 marked</title>',
        '<defs>',
        f'<pattern id="map-grid" width="{KM:.1f}" height="{KM:.1f}" patternUnits="userSpaceOnUse">'
        f'<path class="map-grid-line" d="M{KM:.1f} 0H0V{KM:.1f}"/></pattern>',
        '<pattern id="map-lawn" width="64" height="64" patternUnits="userSpaceOnUse" patternTransform="rotate(-32)">'
        '<rect class="lawn-a" width="32" height="64"/><rect class="lawn-b" x="32" width="32" height="64"/></pattern>',
        f'<path id="map-cover-shape" d="{cover_d}"/>',
        *[f'<path id="map-road-{k}" d="{d}"/>' for k, (_, d) in roads.items()],
        '</defs>',
        f'<rect class="map-bg" width="1000" height="{H}" fill="url(#map-grid)"/>',
        '<use class="map-cover" href="#map-cover-shape" fill="url(#map-lawn)"/>',
        '<path class="map-parish" d="' + "".join(d_poly(g) for g in shapes.values()) + '"/>',
        '<use class="map-cover-edge" href="#map-cover-shape"/>',
        '<g class="map-roads">',
        *[f'<use class="casing {k}" href="#map-road-{k}"/>' for k in roads],
        *[f'<use class="road {k}" href="#map-road-{k}"/>' for k in roads],
        '</g>',
        '<g class="map-exits">' + "".join(f'<text x="{x}" y="{y}" text-anchor="{a}">{t}</text>' for t, x, y, a in exits) + '</g>',
        '<g class="map-shields">' + "".join(shield(*s) for s in SHIELDS) + '</g>',
        '<g class="map-nearby">' + "".join(
            f'<circle cx="{pt(lon, lat)[0]}" cy="{pt(lon, lat)[1]}" r="6"/>'
            f'<text x="{pt(lon, lat)[0] + dx}" y="{pt(lon, lat)[1] + dy}" text-anchor="{anchor}">{esc(n)}</text>'
            for n, (lon, lat, anchor, dx, dy) in NEARBY.items() if n not in names) + '</g>',
        '<g class="map-towns">' + "".join(town(*a) for a in areas) + '</g>',
        f'<g class="map-key"><path d="M{sx + 22} {sy - 150}l16 44h-32z"/>'
        f'<text x="{sx + 22}" y="{sy - 162}" text-anchor="middle">N</text>'
        f'<path class="scale" d="M{sx} {sy - 14}v14h{MILE:.0f}v-14"/>'
        f'<text x="{sx + MILE / 2:.0f}" y="{sy - 24}" text-anchor="middle">1 mile</text></g>',
        '</svg>',
    ])

    page = os.path.join(ROOT, "index.html")
    html = open(page, encoding="utf-8").read()
    start, end = "<!-- area-map", "<!-- /area-map -->"
    a, b = html.find(start), html.find(end)
    if a == -1 or b == -1:
        sys.exit("Couldn't find the <!-- area-map --> markers in index.html")
    a = html.index("-->", a) + 3
    indent = re.search(r"\n([ \t]*)" + re.escape(end), html).group(1)
    html = html[:a] + "\n" + indent + svg + "\n" + indent + html[b:]
    open(page, "w", encoding="utf-8").write(html)
    print(f"Map written to index.html ({len(svg) / 1024:.1f} KB)")

if __name__ == "__main__":
    main()
