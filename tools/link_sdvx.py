"""Refresh SDVX.IN links from locally saved /chunithm/_/json/songs*.json indexes."""

import argparse
import gzip
import json
import re
import unicodedata
from collections import defaultdict
from html import unescape
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "site" / "data"
DIFFICULTIES = ("mst", "exp", "ult", "adv", "bsc")


def normalize(text):
    return " ".join(
        unicodedata.normalize("NFKC", unescape(text or "")).casefold().split()
    )


def compact(text):
    return "".join(char for char in normalize(text) if char.isalnum())


def load_index(directory):
    by_title, by_compact_title = defaultdict(dict), defaultdict(dict)
    for path in sorted(directory.glob("*songs*.json")):
        rows = json.loads(path.read_bytes())
        for row in rows:
            if not row["title"]:
                continue
            levels = row["levels"]
            we = isinstance(levels, str)
            if we:
                difficulty = (
                    "we"
                    if re.fullmatch(r"\D+\d+", levels) and "_" not in levels
                    else None
                )
            else:
                difficulty = next(
                    (
                        diff
                        for diff in DIFFICULTIES
                        if re.fullmatch(r"[1-9]\d*\+?", levels.get(diff, ""))
                    ),
                    None,
                )
            # Include unavailable charts in matching to avoid mistaking an ambiguous title for a unique one.
            identifier = str(row["id"])
            entry = (identifier, difficulty, row)
            by_title[normalize(row["title"]), we][identifier] = entry
            by_compact_title[compact(row["title"]), we][identifier] = entry
    return by_title, by_compact_title


def match_links(db, directory):
    by_title, by_compact_title = load_index(directory)
    links = {}
    for song in db["songs"]:
        charts = song["charts"]
        we = bool(charts) and all(chart["d"] == "WE" for chart in charts)
        matches = list(by_title[normalize(song["title"]), we].values())
        artist = normalize(song["artist"])
        if not matches and compact(song["title"]):
            matches = [
                entry
                for entry in by_compact_title[compact(song["title"]), we].values()
                if artist and normalize(entry[2]["artist"]) == artist
            ]
        same_artist = [
            entry for entry in matches if normalize(entry[2]["artist"]) == artist
        ]
        if same_artist:
            matches = same_artist
        if we:
            levels = {
                f"{cell[2]}{cell[1]}"
                for chart in charts
                for code in chart["cells"][1::2]
                if (cell := db["cells"][code]) and cell[0] == "present"
            }
            matches = [
                entry for entry in matches if entry[2]["levels"].strip("_") in levels
            ]
        if len(matches) == 1 and matches[0][1]:
            links[song["id"]] = list(matches[0][:2])
    return links


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("index_directory", type=Path)
    args = parser.parse_args()
    manifest = json.loads((DATA / "manifest.json").read_bytes())
    db = json.loads(gzip.decompress((DATA / manifest["index"]).read_bytes()))
    links = match_links(db, args.index_directory)
    if not links:
        parser.error("No SDVX.IN links matched the local catalog")
    rows = [
        f"  {json.dumps(key)}: {json.dumps(value)}"
        for key, value in sorted(links.items())
    ]
    (DATA / "sdvx-links.json").write_text(
        "{\n" + ",\n".join(rows) + "\n}\n", encoding="utf-8", newline="\n"
    )
    print(f"{len(links)} of {len(db['songs'])} songs have a matched SDVX.IN chart")
