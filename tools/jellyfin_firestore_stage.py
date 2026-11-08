#!/usr/bin/env python3
"""Stage Jellyfin resume data in an isolated Firestore document.

Default: dry run. Live writes require --apply, an explicit Firebase UID and
Application Default Credentials configured outside this public repository.
Never writes watched/favorites or the parent profile document.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

UID_RE = re.compile(r"^[A-Za-z0-9_-]{6,128}$")
COLLECTOR = Path(__file__).with_name("jellyfin_resume_snapshot.py")


def validate_snapshot(payload):
    if payload.get("schemaVersion") != 1 or not isinstance(payload.get("items"), list):
        raise ValueError("Unsupported Jellyfin snapshot")
    items = []
    seen = set()
    for item in payload["items"]:
        if not isinstance(item, dict) or item.get("type") not in ("movie", "episode"):
            raise ValueError("Invalid item type")
        tmdb = str(item.get("tmdbId") or "")
        position = item.get("positionSeconds")
        duration = item.get("durationSeconds")
        if not tmdb.isdecimal() or not isinstance(position, (int, float)) or not isinstance(duration, (int, float)):
            raise ValueError("Invalid TMDB ID or progress")
        if not (0 < position < duration):
            continue
        entry = {"type": item["type"], "tmdbId": tmdb,
                 "positionSeconds": round(position, 1), "durationSeconds": round(duration, 1)}
        if item["type"] == "episode":
            season, episode = item.get("season"), item.get("episode")
            if type(season) is not int or type(episode) is not int or season < 0 or episode < 1:
                raise ValueError("Invalid episode coordinates")
            entry.update(season=season, episode=episode)
        key = (entry["type"], tmdb, entry.get("season"), entry.get("episode"))
        if key in seen:
            continue
        seen.add(key)
        items.append(entry)
    if len(items) > 2000:
        raise ValueError("Snapshot exceeds safety limit")
    return items


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write to Firestore (default is dry run)")
    parser.add_argument("--uid", help="Firebase Auth UID of the intended CineMood account")
    args = parser.parse_args()

    result = subprocess.run([sys.executable, str(COLLECTOR)], capture_output=True,
                            text=True, check=True, timeout=90)
    items = validate_snapshot(json.loads(result.stdout))
    print(json.dumps({"mode": "apply" if args.apply else "dry-run",
                      "items": len(items), "movies": sum(x["type"] == "movie" for x in items),
                      "episodes": sum(x["type"] == "episode" for x in items)}))
    if not args.apply:
        return
    uid = args.uid or os.environ.get("CINEMOOD_FIREBASE_UID", "")
    if not UID_RE.fullmatch(uid):
        raise SystemExit("Valid explicit Firebase UID required; no data written")
    if not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        raise SystemExit("Application Default Credentials file must be configured; no data written")
    from google.cloud import firestore

    client = firestore.Client(project="cinemood-c3215")
    profile = client.collection("profiles").document(uid)
    if not profile.get().exists:
        raise SystemExit("Target profile does not exist; refusing to create it")
    # Dedicated child document: never overwrites parent profile fields.
    target = profile.collection("integrations").document("jellyfinResume")
    target.set({"schemaVersion": 1, "source": "jellyfin",
                "updatedAt": datetime.now(timezone.utc).isoformat(), "items": items})
    print("Jellyfin resume snapshot saved to the existing Firebase profile integration document")


if __name__ == "__main__":
    main()
