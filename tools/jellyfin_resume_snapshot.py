#!/usr/bin/env python3
"""Read-only Jellyfin resume snapshot for CineMood. No credentials in output."""
import json
import os
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE = os.environ.get("JELLYFIN_URL", "http://127.0.0.1:8096").rstrip("/")
KEY_FILE = Path.home() / ".config/cinemood-sync/jellyfin-api-key"


def main():
    key = KEY_FILE.read_text(encoding="utf-8").strip()
    if not key:
        raise RuntimeError("Jellyfin API key is empty")
    authorization = (
        'MediaBrowser Client="CineMoodSync", Device="Hetzner", '
        'DeviceId="cinemood-sync", Version="1.0", Token="' + key + '"'
    )

    def get(path):
        request = Request(BASE + path, headers={"Authorization": authorization})
        with urlopen(request, timeout=15) as response:
            return json.load(response)

    users = get("/Users")
    if len(users) != 1:
        raise RuntimeError("Expected exactly one Jellyfin user; refusing ambiguous sync")
    uid = users[0]["Id"]
    query = urlencode({"Fields": "ProviderIds", "EnableUserData": "true", "Limit": 10000})
    items = get("/Users/" + uid + "/Items/Resume?" + query).get("Items", [])
    snapshot = []
    for item in items:
        if item.get("Type") not in ("Movie", "Episode"):
            continue
        user_data = item.get("UserData") or {}
        position = int(user_data.get("PlaybackPositionTicks") or 0)
        duration = int(item.get("RunTimeTicks") or 0)
        if position <= 0 or duration <= 0 or user_data.get("Played"):
            continue
        entry = {
            "type": item["Type"].lower(),
            "positionSeconds": round(position / 10000000, 1),
            "durationSeconds": round(duration / 10000000, 1),
            "jellyfinItemId": item["Id"],
        }
        if item["Type"] == "Movie":
            entry["tmdbId"] = (item.get("ProviderIds") or {}).get("Tmdb")
        else:
            entry["season"] = item.get("ParentIndexNumber")
            entry["episode"] = item.get("IndexNumber")
            series_id = item.get("SeriesId")
            if not series_id:
                continue
            series = get("/Users/" + uid + "/Items/" + series_id)
            entry["tmdbId"] = (series.get("ProviderIds") or {}).get("Tmdb")
        if not entry.get("tmdbId"):
            continue
        snapshot.append(entry)
    # Never publish this file without an authenticated, user-scoped transport.
    print(json.dumps({"schemaVersion": 1, "items": snapshot}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
