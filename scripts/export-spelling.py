"""Export conservative US/GB spelling pairs from a locally built, pinned ESDB.

Developer-only update tool; normal builds use the checked-in JSON snapshot.
Run ESDB's combine.py create-db first. No network or third-party Python modules.
"""
import argparse
import collections
import json
from pathlib import Path
import re
import sqlite3

REVISION = "1e5b7d3a72f47a71da5d28686c1dd4b397178485"


def same_family(us, gb):
    pattern = re.sub(r"or|iz", lambda m: "ou?r" if m[0] == "or" else "i[zs]", us)
    return us != gb and re.fullmatch(pattern, gb) is not None


def export(db):
    # Include all common senses when looking for conflicts, even if they do not
    # belong to either conversion family. Identity mappings are evidence too.
    rows = db.execute("""
        select distinct v.*, g.base_pos, g.defn_note, g.usage_note, g.group_rank
          from words_w_variant_info v join groups g using (group_id)
         where v.spelling in ('_', 'A', 'B') and v.variant_level <= 1
           and exists (select 1 from scowl_data s
                        where s.group_id = v.group_id and s.pos = v.pos
                          and s.size <= 60 and s.category = ''
                          and s.region in ('', 'US', 'GB') and s.tag = '')
    """)
    groups = collections.defaultdict(list)
    for row in rows:
        groups[(row["group_id"], row["pos"])].append(row)
    targets = {dialect: collections.defaultdict(set) for dialect in ("us", "gb")}
    blocked = set()
    candidates = set()
    for group in groups.values():
        words = {row["word"] for row in group if re.fullmatch(r"[a-z]{3,64}", row["word"])}
        forms = {
            dialect: {row["word"] for row in group if row["spelling"] in ("_", code)}
            for dialect, code in (("us", "A"), ("gb", "B"))
        }
        unsafe = any(row["base_pos"] not in ("n", "v", "n_v", "aj", "av", "aj_av")
                     or any(row[key] for key in ("defn_note", "usage_note", "group_rank", "entry_rank"))
                     for row in group)
        if unsafe or not all(forms.values()):
            blocked.update(words)
        for dialect in targets:
            for word in words:
                targets[dialect][word].update(forms[dialect])
        if not unsafe:
            for us in forms["us"] & words:
                for gb in forms["gb"] & words:
                    if same_family(us, gb):
                        candidates.add((us, gb))
    # A safe pair must agree across every common sense and reverse uniquely.
    pairs = sorted((us, gb) for us, gb in candidates
                   if us not in blocked and gb not in blocked
                   and targets["gb"][us] == {gb} and targets["us"][gb] == {us})
    return pairs, len(candidates)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "data/spelling-variants.json")
    args = parser.parse_args()
    with sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        pairs, candidates = export(db)
    snapshot = {
        "source": "https://github.com/en-wl/wordlist",
        "revision": REVISION,
        "maxSize": 60,
        "maxVariantLevel": 1,
        "families": ["or/our", "ize/ise and derived forms"],
        "candidatePairs": candidates,
        "pairs": pairs,
    }
    args.output.write_bytes((json.dumps(snapshot, ensure_ascii=True, indent=2) + "\n").encode("utf8"))
    print(f"Exported {len(pairs)} reciprocal, unambiguous pairs from {candidates} family candidates.")
