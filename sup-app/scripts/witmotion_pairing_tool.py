"""
WitMotion Sensor Pairing & QR Registration Tool
=================================================

Purpose
-------
For events where each participant gets TWO WitMotion BLE inclinometers/IMUs
(one "top" sensor, one "bottom" sensor), this script:

  1. Scans BLE advertisements to detect a sensor the moment you power it on
  2. Lets you confirm which discovered device is the sensor you just switched on
  3. Assigns it as "top" or "bottom" for that pair
  4. Repeats for the second sensor
  5. Generates a QR code encoding both sensors' ADVERTISED NAMES + pair number
  6. Logs every pair to CSV/JSON so you have a permanent record you can re-run
     without losing data or double-registering a sensor

Why the QR payload is name-based, not address-based
-----------------------------------------------------
This script runs on macOS, where `bleak` (like all of CoreBluetooth) is
subject to an OS-level restriction: no app on iOS OR macOS can ever read a
peripheral's real Bluetooth MAC address -- Apple hides it for privacy, with
no workaround at the library level. The "address" bleak reports here is a
macOS-specific CoreBluetooth UUID; an iPhone (or a different Mac) scanning
the exact same physical sensor will see a DIFFERENT identifier for it. Real
MAC addresses (which Android does expose to apps) still can't be used to
connect on iOS regardless of how accurately they're captured, since iOS has
no API for "connect to peripheral with MAC X" at all.

The one piece of information that IS identical no matter which device scans
it is the sensor's advertised local name (e.g. "WT901BLE67") -- literal
bytes in the BLE advertisement packet, not OS-assigned metadata. That's why
generate_qr() below encodes names, and why the app matches pairing QR codes
by name rather than address. See sup-app/docs/qr-pairing-plan.txt for the
full app-side design this feeds into.

Because cheap BLE IMU modules can share generic/duplicate advertised names,
this script tracks every name used so far (used_names) and warns loudly if
you select a device whose name was already claimed by an earlier pair --
see NAME COLLISION handling in select_sensor(). If you hit that warning
before printing QR codes, rename the physical unit via WitMotion's config
app (if supported) or make a note to handle that pair's live app-side
pairing manually.

Confirmed against real hardware: a pair of WT9011DCL units can broadcast the
byte-identical factory-default local name (both "WT901BLE67" here) -- not a
bleak/script bug, just how these ship. The scan listing also shows each
device's manufacturer-specific advertisement data (format_manufacturer_data())
and, when two visible devices share a name, tells you whether their
manufacturer_data differs -- if it does, that's a real per-unit identifier
the app could match on instead of name; if it's also identical (or absent),
renaming the physical units is the only fix.

Design notes
------------
- This does NOT connect/bond to the sensors. It just listens to BLE advertising
  packets, which is fast and doesn't interfere with the iOS app connecting later.
- Cheap BLE IMU modules often share generic/duplicate advertised names, so instead
  of matching by name, the script shows you the strongest-RSSI devices first
  (the sensor right in front of you) and makes you confirm before it's saved.
- IMPORTANT for scale (40+ people, 80+ sensors): do this pairing/registration pass
  BEFORE the event, one pair at a time, away from the crowd. With 80 phones +
  80 sensors all live in one room, RSSI-based "nearest device" detection becomes
  unreliable. Pre-register everything, physically label each sensor pair (e.g.
  a sticker "Pair 07 - TOP" / "Pair 07 - BOTTOM"), print the matching QR, and
  hand out pre-matched kits at the event. The QR then lets the app auto-fill the
  two sensor names instead of anyone scanning live on the day.

Requirements
------------
    pip install bleak qrcode[pil]

Tested against Python 3.9+. Works on Windows/macOS/Linux in any normal IDE
(VS Code, PyCharm, terminal). Needs a Bluetooth radio on the machine running it.

Usage
-----
    python witmotion_pairing_tool.py

Output:
    ./pairing_output/pairs_log.csv       <- master log, one row per pair
    ./pairing_output/pairs_log.json      <- same data, JSON (used to resume safely)
    ./pairing_output/qr/pair_001.png     <- one QR code per pair
"""

import asyncio
import csv
import json
import os
import re
import sys
from datetime import datetime, timezone

try:
    from bleak import BleakScanner
except ImportError:
    sys.exit("Missing dependency 'bleak'. Install with: pip install bleak")

try:
    import qrcode
except ImportError:
    sys.exit("Missing dependency 'qrcode'. Install with: pip install qrcode[pil]")


# ----------------------------- Config ---------------------------------------

OUTPUT_DIR = "pairing_output"
QR_DIR = os.path.join(OUTPUT_DIR, "qr")
CSV_PATH = os.path.join(OUTPUT_DIR, "pairs_log.csv")
JSON_PATH = os.path.join(OUTPUT_DIR, "pairs_log.json")

SCAN_SECONDS = 5.0   # how long each scan window lasts

# Optional: narrow the scan to your sensors' advertised name prefix, once you've
# confirmed it (run scan_devices() once and look at what shows up). Leave as
# None to see everything nearby.
NAME_FILTER = None

# Optional: if your WitMotion sensors advertise a BLE service UUID (e.g. the same
# FFE5 service used for GATT comms on WT9011DCL-family IMUs), you can filter on
# it here to cut noise from phones/earbuds/etc. Leave as None if unsure —
# not all peripherals include the service UUID in the advertisement itself.
SERVICE_UUID_FILTER = None   # e.g. "0000ffe5-0000-1000-8000-00805f9b34fb"


# ----------------------------- Naming convention ------------------------------
# Physical s'pots get renamed (via WitMotion's config app) to:
#   s'pot_top_0048.05-08 / s'pot_bot_0048.05-08
# i.e. s'pot_<role>_<4-digit kit code>.<2-digit batch>-<2 digits>. This is a
# sanity-check layer on top of the exact-name matching the app and this
# script's used_names collision guard already do -- parsing here never blocks
# anything, it just lets select_sensor() warn if a device's parsed role
# doesn't match the slot you're registering it for, or if a pair's two
# halves don't share the same kit code. Mirrors src/lib/spotNaming.ts.
SPOT_NAME_RE = re.compile(r"^s['’]pot_(top|bot)_(\d{4})\.(\d{2})-(\d{2})$", re.IGNORECASE)


def parse_spot_name(name):
    """Returns {"role": "top"|"bottom", "code", "batch", "suffix"} or None
    if the name doesn't match the s'pot_<role>_<code>.<batch>-<n> convention
    (e.g. a unit that hasn't been renamed from its factory default yet)."""
    m = SPOT_NAME_RE.match(name.strip())
    if not m:
        return None
    role_token, code, batch, suffix = m.groups()
    return {
        "role": "top" if role_token.lower() == "top" else "bottom",
        "code": code,
        "batch": batch,
        "suffix": suffix,
    }


# ----------------------------- Helpers ---------------------------------------

def ensure_dirs():
    os.makedirs(QR_DIR, exist_ok=True)


def load_existing_log():
    """Load prior pairs so re-running the script doesn't lose earlier pairs
    or let you accidentally reuse a sensor ID."""
    if os.path.exists(JSON_PATH):
        with open(JSON_PATH, "r") as f:
            return json.load(f)
    return []


def save_log(records):
    with open(JSON_PATH, "w") as f:
        json.dump(records, f, indent=2)

    fieldnames = [
        "pair_id", "top_id", "top_name", "top_mfg_data",
        "bottom_id", "bottom_name", "bottom_mfg_data", "timestamp",
    ]
    with open(CSV_PATH, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in records:
            writer.writerow({
                "pair_id": r["pair_id"],
                "top_id": r["top"]["id"],
                "top_name": r["top"]["name"],
                "top_mfg_data": r["top"].get("mfg_data", ""),
                "bottom_id": r["bottom"]["id"],
                "bottom_name": r["bottom"]["name"],
                "bottom_mfg_data": r["bottom"].get("mfg_data", ""),
                "timestamp": r["timestamp"],
            })


def already_used_ids(records):
    used = set()
    for r in records:
        used.add(r["top"]["id"])
        used.add(r["bottom"]["id"])
    return used


def already_used_names(records):
    """Advertised names already claimed by an earlier pair in this log.
    Used to warn on name collisions, since the QR payload (and the app's
    matching logic) key off name, not the macOS-only id — see module
    docstring for why."""
    used = set()
    for r in records:
        used.add(r["top"]["name"])
        used.add(r["bottom"]["name"])
    return used


def format_manufacturer_data(adv) -> str:
    """Hex-dump of any manufacturer-specific advertisement data, keyed by
    company ID. Cheap BLE IMU modules commonly ship with an identical
    factory-default local name across the whole batch (confirmed: two units
    both broadcasting exactly "WT901BLE67") — if there's a real per-unit
    identifier at all, it's most likely to be sitting here rather than in
    the name, since manufacturer data isn't shown/editable via the usual
    "rename this device" config tools and often gets set at the factory."""
    if not adv.manufacturer_data:
        return ""
    parts = []
    for company_id, payload in adv.manufacturer_data.items():
        parts.append(f"{company_id:04X}:{payload.hex()}")
    return " ".join(parts)


async def scan_devices():
    """Scan for SCAN_SECONDS and return (name, address, rssi, mfg_data) sorted
    strongest first."""
    kwargs = {"timeout": SCAN_SECONDS, "return_adv": True}
    if SERVICE_UUID_FILTER:
        kwargs["service_uuids"] = [SERVICE_UUID_FILTER]

    devices = await BleakScanner.discover(**kwargs)
    results = []
    for address, (device, adv) in devices.items():
        name = device.name or adv.local_name or "(unknown)"
        if NAME_FILTER and not name.upper().startswith(NAME_FILTER.upper()):
            continue
        rssi = adv.rssi if adv.rssi is not None else -999
        mfg_data = format_manufacturer_data(adv)
        results.append((name, address, rssi, mfg_data))
    results.sort(key=lambda x: x[2], reverse=True)  # strongest signal first
    return results


async def select_sensor(role_label, used_ids, used_names):
    """Prompt the operator to power on a sensor, scan, and pick which discovered
    device it is. Warns (but doesn't block) on both id reuse and name collision —
    a name collision matters more here, since the QR/app match by name."""
    print(f"\n--- Turn ON the {role_label} sensor now (keep any sensor you haven't "
          f"registered yet powered OFF). ---")
    input("Press Enter when it's powered on and ready to scan...")

    while True:
        print(f"Scanning for {SCAN_SECONDS:.0f}s...")
        results = await scan_devices()

        if not results:
            print("No BLE devices found. Move closer / check the sensor is on, then retry.")
            continue

        print(f"\nFound {len(results)} device(s), strongest signal first:")
        for i, (name, address, rssi, mfg_data) in enumerate(results):
            flags = []
            if address in used_ids:
                flags.append("ALREADY REGISTERED")
            if name in used_names:
                flags.append("NAME COLLISION with an earlier pair")
            flag = f"  [{', '.join(flags)}]" if flags else ""
            mfg_suffix = f"  mfg_data={mfg_data}" if mfg_data else ""
            print(f"  [{i}] {name:<20} {address}  RSSI={rssi}{mfg_suffix}{flag}")

        # Same name broadcast by more than one device in THIS scan — the exact
        # situation that breaks name-based matching at the app level. Check
        # whether manufacturer data at least tells them apart, since that's
        # the one thing the name-collision warning below can't see on its own.
        by_name = {}
        for name, address, rssi, mfg_data in results:
            by_name.setdefault(name, []).append((address, mfg_data))
        for name, entries in by_name.items():
            if len(entries) > 1:
                mfg_values = {mfg for _, mfg in entries}
                if len(mfg_values) > 1:
                    print(
                        f"\n  NOTE: {len(entries)} devices are all broadcasting the name '{name}', "
                        f"but their manufacturer_data differs — that's a usable unique identifier "
                        f"if the app is ever updated to match on it instead of name."
                    )
                else:
                    print(
                        f"\n  NOTE: {len(entries)} devices are all broadcasting the name '{name}' "
                        f"with {'identical' if mfg_values != {''} else 'no'} manufacturer_data too — "
                        f"nothing here distinguishes them. Renaming the physical units is the only fix."
                    )

        choice = input(
            f"\nSelect the {role_label} sensor by number (default 0 = strongest signal), "
            f"or 'r' to rescan: "
        ).strip()

        if choice.lower() == "r":
            continue
        if choice == "":
            choice = "0"

        try:
            idx = int(choice)
            name, address, rssi, mfg_data = results[idx]
        except (ValueError, IndexError):
            print("Invalid selection, try again.")
            continue

        if address in used_ids:
            confirm = input(
                f"{address} is already registered to a previous pair. Use anyway? (y/N): "
            ).strip().lower()
            if confirm != "y":
                continue

        if name in used_names:
            print(
                f"\n  *** WARNING: the name '{name}' is already used by another pair. ***\n"
                f"  The QR code and the app both match sensors by advertised name — if two\n"
                f"  sensors share a name, the app can't tell them apart automatically and\n"
                f"  will require the pilot participant to manually pick the right one.\n"
                f"  Consider renaming this unit in WitMotion's config app before printing\n"
                f"  its QR code, or note it now so you can flag it at the event.\n"
            )
            confirm = input(f"Proceed with duplicate name '{name}' anyway? (y/N): ").strip().lower()
            if confirm != "y":
                continue

        parsed = parse_spot_name(name)
        if parsed is None:
            print(
                f"\n  NOTE: '{name}' doesn't match the s'pot_<role>_<code>.<batch>-<n> "
                f"naming convention — has this unit been renamed yet in WitMotion's "
                f"config app? Proceeding anyway; the QR/app match by exact name "
                f"regardless of format."
            )
        elif parsed["role"] != role_label.lower():
            print(
                f"\n  *** WARNING: '{name}' looks like a {parsed['role'].upper()} sensor "
                f"by its name, but you're registering it as {role_label}. ***\n"
                f"  Double-check you grabbed the right physical unit before confirming.\n"
            )
            confirm = input(f"Proceed anyway? (y/N): ").strip().lower()
            if confirm != "y":
                continue

        confirm = input(f"Confirm: {role_label} = {name} ({address})? (Y/n): ").strip().lower()
        if confirm in ("", "y"):
            return {"id": address, "name": name, "mfg_data": mfg_data}
        # else loop back and rescan/reselect


def generate_qr(record):
    # Advertised names, not the macOS-only bleak address — see module
    # docstring. "id" values stay in the CSV/JSON log for the operator's own
    # record-keeping, but the app never needs them.
    payload = json.dumps({
        "pair_id": record["pair_id"],
        "top": record["top"]["name"],
        "bottom": record["bottom"]["name"],
    }, separators=(",", ":"))  # compact, easier for the app to decode reliably

    img = qrcode.make(payload)
    path = os.path.join(QR_DIR, f"pair_{record['pair_id']:03d}.png")
    img.save(path)
    return path, payload


async def main():
    ensure_dirs()
    records = load_existing_log()
    used_ids = already_used_ids(records)
    used_names = already_used_names(records)
    next_pair_id = (max((r["pair_id"] for r in records), default=0)) + 1

    print("=" * 60)
    print("WitMotion Sensor Pairing & QR Registration Tool")
    print("=" * 60)
    if records:
        print(f"Loaded {len(records)} existing pair(s) from {JSON_PATH}. "
              f"Continuing from pair {next_pair_id}.")

    while True:
        print(f"\n############  PAIR {next_pair_id}  ############")

        top = await select_sensor("TOP", used_ids, used_names)
        used_ids.add(top["id"])
        used_names.add(top["name"])

        bottom = await select_sensor("BOTTOM", used_ids, used_names)
        used_ids.add(bottom["id"])
        used_names.add(bottom["name"])

        top_parsed = parse_spot_name(top["name"])
        bottom_parsed = parse_spot_name(bottom["name"])
        if top_parsed and bottom_parsed and top_parsed["code"] != bottom_parsed["code"]:
            print(
                f"\n  *** WARNING: kit codes don't match — TOP is {top_parsed['code']}, "
                f"BOTTOM is {bottom_parsed['code']}. ***\n"
                f"  These might not be from the same physical kit. Double-check before "
                f"continuing — this pair will still be logged and QR'd as entered.\n"
            )

        record = {
            "pair_id": next_pair_id,
            "top": top,
            "bottom": bottom,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        records.append(record)
        save_log(records)

        qr_path, payload = generate_qr(record)
        print(f"\nPair {next_pair_id} registered.")
        print(f"   TOP    = {top['name']} ({top['id']})")
        print(f"   BOTTOM = {bottom['name']} ({bottom['id']})")
        print(f"   QR saved to: {qr_path}")
        print(f"   QR payload: {payload}")

        next_pair_id += 1

        cont = input("\nRegister another pair? (Y/n): ").strip().lower()
        if cont == "n":
            break

    print(f"\nDone. {len(records)} total pair(s) logged in {OUTPUT_DIR}/")


if __name__ == "__main__":
    asyncio.run(main())
