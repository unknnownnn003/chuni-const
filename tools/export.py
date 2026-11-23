"""Build the browser archive from the compact JP history database (read-only)."""

import argparse
import gzip
import hashlib
import json
import sqlite3
from collections import defaultdict
from pathlib import Path
from PIL import Image


def write_pack(path, data):
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode()
    content = gzip.compress(raw, compresslevel=9, mtime=0)
    name = f"{path.stem}-{hashlib.sha256(content).hexdigest()[:12]}.json.gz"
    (path.parent / name).write_bytes(content)
    return name


def genres(tree):
    if isinstance(tree, list):
        if len(tree) == 2 and tree[0] == "str" and isinstance(tree[1], str):
            yield tree[1]
        else:
            for item in tree:
                yield from genres(item)


def export(db, roots, out):
    conn = sqlite3.connect(db.resolve().as_uri() + "?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma query_only=on")
    assert conn.execute("select ready from complete").fetchone()[0] == 1
    out.mkdir(parents=True, exist_ok=True)
    images = out / "jackets"
    images.mkdir(exist_ok=True)
    versions = [
        list(r)
        for r in conn.execute(
            "select version,start_on,end_on from versions order by ordinal"
        )
    ]
    order = {v[0]: i for i, v in enumerate(versions)}
    songs, charts, parents, details = {}, {}, {}, defaultdict(list)

    def song(key, num):
        return songs.setdefault(
            key,
            dict(
                id=key,
                num=num,
                title=key,
                artist="",
                genres=[],
                cover=None,
                aliases=set(),
                charts=[],
            ),
        )

    def chart(key, parent, difficulty):
        parents[key] = parent
        if key not in charts:
            charts[key] = dict(
                id=key, d=difficulty, designers=set(), cells={}, marks={}
            )
            songs[parent]["charts"].append(charts[key])
        return charts[key]

    for r in conn.execute(
        "select m.* from music_versions m join versions using(version) order by ordinal,identity"
    ):
        s = song(r["identity"], r["music_id"])
        s.update(
            title=r["title"],
            artist=r["artist"],
            genres=list(genres(json.loads(r["genre"] or "null"))),
            cover=r["jacket_sha256"],
        )
        s["aliases"].update(filter(None, [r["title"], r["artist"], r["sort_name"]]))
    # Some package-only identities have no endpoint row. Preserve their independent IDs.
    for r in conn.execute(
        "select * from history_entities order by parent is not null,identity"
    ):
        if r["kind"] == "song":
            if r["identity"] not in songs:
                s = song(r["identity"], r["music_id"])
                row = conn.execute(
                    "select payload from history_revisions where identity=? order by revision limit 1",
                    (r["identity"],),
                ).fetchone()
                if row:
                    meta = json.loads(row[0])
                    s.update(
                        title=meta.get("title", s["id"]),
                        artist=meta.get("artist"),
                        cover=meta.get("jacket_sha256"),
                        genres=list(genres(meta.get("genreNames"))),
                    )
        else:
            chart(r["identity"], r["parent"], r["difficulty"])
    dictionary, codes = [None], {}
    for table in ["chart_versions", "worlds_end_versions"]:
        for r in conn.execute(f"select * from {table} order by version,chart_identity"):
            we = table == "worlds_end_versions"
            c = chart(
                r["chart_identity"], r["identity"], "WE" if we else r["difficulty"]
            )
            val = r["stars"] if we else r["selected_hundredths"]
            cell = (
                r["state"],
                val,
                r["tag"] if we else None,
                None if we else r["constant_status"],
                r["notes_designer"],
                None if we else r["display_level"],
            )
            if cell not in codes:
                codes[cell] = len(dictionary)
                dictionary.append(cell)
            c["cells"][order[r["version"]]] = codes[cell]
            if r["notes_designer"]:
                c["designers"].add(r["notes_designer"])
    for r in conn.execute(
        """select e.*,b.version from history_events e left join history_batches b using(batch) order by event"""
    ):
        key = r["identity"]
        parent = parents.get(key, key)
        if parent not in songs:
            raise ValueError(key)
        if (
            key in charts
            and r["kind"] in ("released", "removed", "restored")
            and r["field"] == "availability"
            and r["effective_on"]
        ):
            vi = next(
                (
                    i
                    for i, (_, start, end) in enumerate(versions)
                    if start <= r["effective_on"] <= end
                ),
                None,
            )
            if vi is not None:
                charts[key]["marks"].setdefault(vi, []).append(r["kind"])
        before, after = [
            json.loads(r[k]) if r[k] else None for k in ("before", "after")
        ]
        if r["field"] == "notes_designer" and key in charts:
            charts[key]["designers"].update(
                v for v in [before, after] if isinstance(v, str) and v
            )
        details[parent].append(
            [
                charts[key]["d"] if key in charts else "SONG",
                r["version"],
                r["effective_on"],
                r["earliest_on"],
                r["latest_on"],
                r["kind"],
                r["field"],
                before,
                after,
                r["batch"],
            ]
        )
    for c in charts.values():
        c["designers"] = sorted(c["designers"])
        seq = c["cells"]
        runs = []
        previous = 0
        for i in range(len(versions)):
            value = seq.get(i, 0)
            if value != previous:
                runs.extend([i, value])
                previous = value
        c["cells"] = runs
    paths = dict(conn.execute("select sha256,representative_path from jackets"))
    missing = []
    for digest in sorted({s["cover"] for s in songs.values()} - {None}):
        target = images / (digest[:20] + ".webp")
        if target.exists():
            continue
        rel = paths.get(digest)
        source = next(
            (root / rel for root in roots if rel and (root / rel).is_file()), None
        )
        if not source:
            missing.append(digest)
            continue
        if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
            raise ValueError(source)
        with Image.open(source) as im:
            im.thumbnail((208, 208))
            im.convert("RGB").save(target, "WEBP", quality=76, method=4)
    groups = defaultdict(dict)
    ordered = sorted(songs.values(), key=lambda s: (s["num"], s["id"]))
    rank = ["BAS", "ADV", "EXP", "MAS", "ULT", "WE"]
    for i, s in enumerate(ordered):
        s["cover"] = (
            s["cover"][:20] if s["cover"] and s["cover"] not in missing else None
        )
        s["aliases"] = sorted(s["aliases"] - {s["title"], s["artist"]})
        s["charts"].sort(key=lambda c: rank.index(c["d"]))
        s["group"] = i // 16
        groups[s["group"]][s["id"]] = details[s["id"]]
    packs = [write_pack(out / f"history{i}", groups[i]) for i in range(len(groups))]
    index = write_pack(
        out / "catalog",
        dict(versions=versions, songs=ordered, cells=dictionary, history=packs),
    )
    (out / "manifest.json").write_text(
        json.dumps(
            dict(
                index=index,
                songs=len(songs),
                charts=len(charts),
                versions=len(versions),
                missingJackets=len(missing),
            ),
            indent=2,
        )
        + "\n"
    )
    # Prune only obsolete generated packs, after the replacement manifest exists.
    for p in out.glob("*.json.gz"):
        if p.name not in {index, *packs}:
            p.unlink()
    print((out / "manifest.json").read_text())


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("database", type=Path)
    p.add_argument("--root", action="append", type=Path, required=True)
    p.add_argument("--out", type=Path, default=Path("site/data"))
    args = p.parse_args()
    export(args.database, args.root, args.out)
