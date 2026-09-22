"""One-time migration: push your current staff/leave/transfers into the
new Firestore database. Run this ONCE, right after your first deploy (see
../DEPLOY.md) - running it again just re-adds the same rows a second time
(it always creates new documents, never checks for existing ones).

Usage (from Firebase/Google Cloud Shell, already authenticated to your
project - see DEPLOY.md):
    pip install --quiet firebase-admin
    python3 seed_firestore.py YOUR-PROJECT-ID
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import firebase_admin
from firebase_admin import credentials, firestore


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python3 seed_firestore.py YOUR-PROJECT-ID")
        raise SystemExit(1)
    project_id = sys.argv[1]

    firebase_admin.initialize_app(credentials.ApplicationDefault(), {"projectId": project_id})
    db = firestore.client()

    data = json.loads((Path(__file__).parent / "seed_data.json").read_text())
    for collection in ("staff", "leave", "transfers"):
        for doc in data.get(collection, []):
            db.collection(collection).add(doc)
        print(f"Seeded {len(data.get(collection, []))} docs into '{collection}'.")

    print("Done. Open the app - the roster builds itself within a few seconds.")


if __name__ == "__main__":
    main()
