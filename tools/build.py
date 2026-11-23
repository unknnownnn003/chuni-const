"""Validate and build the static site. No runtime dependencies."""

import argparse
import gzip
import hashlib
import json
import shutil
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
DATA = SITE / "data"


def packed(name):
    data = (DATA / name).read_bytes()
    assert hashlib.sha256(data).hexdigest()[:12] in name
    return json.loads(gzip.decompress(data))


def validate(database=None):
    m = json.loads((DATA / "manifest.json").read_text())
    db = packed(m["index"])
    versions = db["versions"]
    songs = db["songs"]
    cells = db["cells"]
    charts = {}
    assert len(versions) == m["versions"] and len(songs) == m["songs"]
    assert sorted(v[1] for v in versions) == [v[1] for v in versions]
    for i in range(len(versions)):
        assert (SITE / "assets" / f"v{i}.webp").is_file()
    chunks = [packed(n) for n in db["history"]]
    total_events = 0
    for s in songs:
        total_events += len(chunks[s["group"]][s["id"]])
        assert s["title"]
        if s["cover"]:
            assert (DATA / "jackets" / f"{s['cover']}.webp").is_file()
        for c in s["charts"]:
            assert c["id"] not in charts
            runs = c["cells"]
            starts = runs[::2]
            assert len(runs) % 2 == 0 and starts == sorted(set(starts))
            assert all(0 <= i < len(versions) for i in starts)
            decoded = {}
            val = 0
            changes = dict(zip(starts, runs[1::2]))
            for i, version in enumerate(versions):
                val = changes.get(i, val)
                if val:
                    decoded[version[0]] = cells[val]
            charts[c["id"]] = decoded
    assert len(charts) == m["charts"]
    if database:
        conn = sqlite3.connect(Path(database).resolve().as_uri() + "?mode=ro", uri=True)
        expected = set()
        for table, fields in [
            (
                "chart_versions",
                "selected_hundredths,null,constant_status,notes_designer,display_level",
            ),
            ("worlds_end_versions", "stars,tag,null,notes_designer,null"),
        ]:
            for key, version, *cell in conn.execute(
                f"select chart_identity,version,state,{fields} from {table}"
            ):
                assert charts[key][version] == cell, (key, version, cell)
                expected.add((key, version))
        assert sum(map(len, charts.values())) == len(expected)
        assert (
            total_events
            == conn.execute("select count(*) from history_events").fetchone()[0]
        )
        conn.close()
    print(
        f"{len(songs)} songs, {len(charts)} charts, {sum(map(len, charts.values()))} chart snapshots, {total_events} history events verified"
    )


def build():
    out = ROOT / "dist"
    out.mkdir(exist_ok=True)
    html = (SITE / "index.html").read_text("utf-8-sig")
    for filename in ["style.css", "app.js"]:
        source = SITE / filename
        name = f"{source.stem}-{hashlib.sha256(source.read_bytes()).hexdigest()[:12]}{source.suffix}"
        shutil.copyfile(source, out / name)
        html = html.replace(f'"{filename}"', f'"{name}"')
    for dirname in ["assets", "data"]:
        shutil.copytree(SITE / dirname, out / dirname, dirs_exist_ok=True)
    (out / "index.html").write_text(html, "utf8")
    (out / ".nojekyll").touch()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--database")
    args = parser.parse_args()
    validate(args.database)
    build()
