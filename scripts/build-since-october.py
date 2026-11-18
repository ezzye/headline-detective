#!/usr/bin/env python3
"""Build the public aggregate from the private homepage archive (Python 3.11+)."""

import argparse
from collections import defaultdict
from datetime import datetime, time, timedelta
import json
from pathlib import Path
import re
import struct
from zoneinfo import ZoneInfo


SITE = Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE = SITE.parents[1] / "work" / "cfj-agenda-monitor"
OUTLETS = {
    "bbc": ("BBC News", "https://www.bbc.co.uk/news"),
    "itv": ("ITV News", "https://www.itv.com/news"),
    "channel4": ("Channel 4 News", "https://www.channel4.com/news/"),
}
SECTIONS = ("lead", "featured", "video")
TOPICS = ("immigration", "immigrationUK", "reform")
VIEWPORT = (1728, 906)
NO, POSSIBLE, YES = range(3)

# Applied to the archived display text, including headline-only carousel cards.
# These are topical cues reviewed against the provisional coding, not source extracts.
NON_UK = re.compile(
    r"\b(?:rwanda|senegal|canary islands|bolsonaro|white house|texas|tuvalu)\b", re.I
)
UNRESOLVED_NON_UK = re.compile(
    r"\boleshky\b.+\barrive in belarus\b"
    r"|\boleshky\b.+\barrived in the russian town of anapa\b|\bice architect\b", re.I
)
UNRESOLVED_UK = re.compile(
    r"\byouth mobility\b|\bprioritise british jobs\b|\bbritish plumber\b.+\bpoland\b"
    r"|\bhome office investigating\b.+\blawyer\b.+\bfines?\b", re.I
)
DIRECT_REFORM = re.compile(
    r"\breform (?:uk|msps?|mss?|mps?|councillors?|officials?)\b|\bnigel farage\b", re.I
)
UK_CONTEXT = re.compile(
    r"\b(?:uk|britain|british|mah?mood|oxfordshire|gosport|piddington"
    r"|andy burnham|burnham|rayner|home secretary|downing street|no 10|reform mp)\b"
    r"|\bmigrant dinghy in channel\b|\billegal.worker fines?\b|\b(?:global talent|talent visa)\b",
    re.I,
)
RECURRING_FEATURED = re.compile(r"\bfarage\b.+\bundercover\b.+\bforeign donations\b", re.I)


def card_text(card):
    return " ".join((card["headline"] + " " + card["standfirst"]).split())


def has_uk_context(card):
    return bool(UK_CONTEXT.search(card_text(card)) or "/news/meridian/" in (card["url"] or ""))


def classifications(card, headline_only_topic_urls, known_uk_story_urls):
    text = card_text(card)
    provisional = card["topic"]
    immigration = YES if provisional in ("immigration", "both") else NO
    reform = YES if provisional in ("reform", "both") or DIRECT_REFORM.search(text) else NO

    # A broad, headline-only Brexit card cannot inherit certainty from the same
    # link with an explicit immigration standfirst in other matched captures.
    if card["url"] in headline_only_topic_urls and not card["standfirst"].strip():
        immigration = POSSIBLE

    matched_non_uk = NON_UK.search(text)
    uk_context = has_uk_context(card) or card["url"] in known_uk_story_urls
    unknown_jurisdiction = immigration == YES and not (matched_non_uk or uk_context)
    uk = immigration if uk_context and not matched_non_uk else NO
    if provisional == "uncertain" and UNRESOLVED_UK.search(text):
        immigration = uk = POSSIBLE
    if provisional == "uncertain" and UNRESOLVED_NON_UK.search(text):
        # A cross-border rescue can be temporary evacuation; an appointment
        # involving an immigration official may concern that work only in passing.
        immigration = POSSIBLE
    return dict(zip(TOPICS, (immigration, uk, reform))), unknown_jurisdiction


def json_read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def image_size(path):
    """Read native PNG/JPEG dimensions. Some JPEGs were archived as .png."""
    with path.open("rb") as image:
        header = image.read(24)
        if header[:8] == b"\x89PNG\r\n\x1a\n" and header[12:16] == b"IHDR":
            return struct.unpack(">II", header[16:24])
        if header[:2] != b"\xff\xd8":
            return None
        image.seek(2)
        while image.read(1) == b"\xff":
            marker = image.read(1)
            while marker == b"\xff":
                marker = image.read(1)
            if not marker or marker in (b"\xd9", b"\xda"):
                break
            length = int.from_bytes(image.read(2), "big")
            if length < 2:
                break
            if marker[0] in (0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf):
                frame = image.read(5)
                if len(frame) == 5:
                    height, width = struct.unpack(">HH", frame[1:])
                    return width, height
                break
            image.seek(length - 2, 1)
    return None


def outlets_by_id(record):
    outlets = {outlet["id"]: outlet for outlet in record["outlets"]}
    if len(record["outlets"]) != len(OUTLETS) or outlets.keys() != OUTLETS.keys():
        raise ValueError(f"Expected all three outlets in {record['runId']}")
    return outlets


def exclusion_reason(record, directory, grace):
    outlets = outlets_by_id(record)
    failed = [outlet_id for outlet_id, outlet in outlets.items() if outlet["status"] == "failed"]
    if failed:
        return "failed", failed
    partial = [outlet for outlet in outlets.values() if outlet["status"] == "partial"]
    if partial:
        affected = [outlet["id"] for outlet in partial]
        if any("viewport" in outlet["error"].lower() and "1728x" in outlet["error"] for outlet in partial):
            return "partialViewport", affected
        if any(re.search(r"\b(?:breaking-news layout|special topical layout|election takeover)\b", outlet["error"], re.I) for outlet in partial):
            return "partialLayout", affected
        return "partialVisibility", affected

    slot = datetime.fromisoformat(record["scheduledFor"])
    if abs(datetime.fromisoformat(record["runStartedAt"]) - slot) > grace:
        return "outsideTimeWindow", list(OUTLETS)

    for outlet_id, outlet in outlets.items():
        edition = outlet["edition"].lower()
        edition_matches = {
            "bbc": "uk top stories" in edition,
            "itv": "national news" in edition and "no local area selected" in edition,
            "channel4": "latest" in edition and "featured" in edition,
        }
        if (
            outlet["status"] != "ok"
            or outlet["observedUrl"] != OUTLETS[outlet_id][1]
            or not edition_matches[outlet_id]
        ):
            return "editionOrScope", [outlet_id]
        sections = outlet["sections"]
        leads = [section for section in sections if section["kind"] == "lead"]
        if len(leads) != 1 or not 1 <= len(leads[0]["items"]) <= 12:
            return "editionOrScope", [outlet_id]
        bounds = outlet["viewport"]
        if (bounds["width"], bounds["height"]) != VIEWPORT:
            return "viewportMismatch", [outlet_id]
        if abs(datetime.fromisoformat(outlet["capturedAt"]) - slot) > grace:
            return "outsideTimeWindow", [outlet_id]
        for kind in ("dom", "screenshot"):
            metadata = outlet["files"].get(kind)
            if not metadata:
                return "missingEvidence", [outlet_id]
            evidence = directory / metadata["path"]
            if not evidence.is_file() or evidence.stat().st_size != metadata["bytes"]:
                return "missingEvidence", [outlet_id]
            if kind == "screenshot" and image_size(evidence) != VIEWPORT:
                return "viewportMismatch", [outlet_id]
    return None


def closed_slots(started, as_of, archive_slots, schedule, grace):
    day = started.date()
    while day <= as_of.date():
        for hour in schedule:
            slot = datetime.combine(day, time(hour), started.tzinfo)
            if started <= slot <= as_of and (as_of - slot >= grace or slot in archive_slots):
                yield slot
        day += timedelta(days=1)


def empty_counts():
    return dict(all=dict(min=0, max=0), firstScreen=dict(min=0, max=0))


def mark_presence(check, certainty, visibility):
    check["all"]["min"] |= certainty == YES
    check["all"]["max"] |= certainty >= POSSIBLE
    check["firstScreen"]["min"] |= certainty == YES and visibility is True
    check["firstScreen"]["max"] |= certainty >= POSSIBLE and visibility is not False


def add_check(counts, check):
    for field in ("all", "firstScreen"):
        for bound in ("min", "max"):
            counts[field][bound] += check[field][bound]


def count_checks(matched):
    outlets = {}
    for outlet_id, (name, _) in OUTLETS.items():
        observations = [outlets_by_id(record)[outlet_id] for record in matched]
        sections_seen = dict.fromkeys(SECTIONS, 0)
        unknown_visibility = dict.fromkeys(SECTIONS, 0)
        topics = {}
        for topic in TOPICS:
            topics[topic] = {
                **empty_counts(),
                "sections": {kind: empty_counts() for kind in SECTIONS},
                "uncertainTopicChecks": 0,
                "unknownVisibilityChecks": 0,
            }
        unknown_jurisdiction = 0
        cards = [
            card
            for outlet in observations
            for section in outlet["sections"]
            if section["kind"] in SECTIONS
            for card in section["items"]
        ]
        known_uk_story_urls = {
            card["url"] for card in cards
            if card["url"] and card["topic"] in ("immigration", "both") and has_uk_context(card)
        }
        headline_only_topic_urls = {
            card["url"] for card in cards
            if card["url"] and "brexit deal" in card["headline"].lower()
            and "won't push to rejoin eu" in card["headline"].lower()
            and "immigration" in card["standfirst"].lower()
        }
        for outlet in observations:
            sections = [section for section in outlet["sections"] if section["kind"] in SECTIONS]
            check = {topic: empty_counts() for topic in TOPICS}
            by_section = {topic: {kind: empty_counts() for kind in SECTIONS} for topic in TOPICS}
            uncertain_topics = set()
            uncertain_visibility = set()
            uncertain_sections = set()
            jurisdiction_unknown = False
            for kind in {section["kind"] for section in sections}:
                sections_seen[kind] += 1
            for section in sections:
                kind = section["kind"]
                for card in section["items"]:
                    visibility = card["firstViewport"]
                    if visibility is None:
                        uncertain_sections.add(kind)
                    classes, unresolved = classifications(card, headline_only_topic_urls, known_uk_story_urls)
                    jurisdiction_unknown |= unresolved
                    for topic, certainty in classes.items():
                        mark_presence(check[topic], certainty, visibility)
                        mark_presence(by_section[topic][kind], certainty, visibility)
                        if certainty == POSSIBLE:
                            uncertain_topics.add(topic)
                        if certainty >= POSSIBLE and visibility is None:
                            uncertain_visibility.add(topic)
            unknown_jurisdiction += jurisdiction_unknown
            for kind in uncertain_sections:
                unknown_visibility[kind] += 1
            for topic, totals in topics.items():
                add_check(totals, check[topic])
                for kind in SECTIONS:
                    add_check(totals["sections"][kind], by_section[topic][kind])
                totals["uncertainTopicChecks"] += topic in uncertain_topics
                totals["unknownVisibilityChecks"] += topic in uncertain_visibility
        outlets[outlet_id] = {
            "name": name,
            "observations": len(observations),
            "sectionObservations": sections_seen,
            "sectionUnknownVisibility": unknown_visibility,
            "immigrationUnknownJurisdiction": unknown_jurisdiction,
            "topics": topics,
        }
    return outlets


def recurring_featured(matched):
    checks_by_story = defaultdict(int)
    visible_checks_by_story = defaultdict(int)
    for record in matched:
        cards = [
            card
            for section in outlets_by_id(record)["channel4"]["sections"]
            if section["kind"] == "featured"
            for card in section["items"]
            if card["url"] and RECURRING_FEATURED.search(card_text(card))
        ]
        for story in {card["url"] for card in cards}:
            checks_by_story[story] += 1
        for story in {card["url"] for card in cards if card["firstViewport"] is True}:
            visible_checks_by_story[story] += 1
    if not checks_by_story:
        return None
    story = max(checks_by_story, key=lambda key: (checks_by_story[key], key))
    return {
        "outlet": OUTLETS["channel4"][0],
        "topic": "Reform UK",
        "title": "Farage undercover investigation",
        "appearances": checks_by_story[story],
        "firstScreenAppearances": visible_checks_by_story[story],
    }


def build(archive, as_of=None):
    config = json_read(archive / "config.json")
    ledger = json_read(archive / "ledger.json")
    zone = ZoneInfo(config["timezone"])
    as_of = (as_of or datetime.fromisoformat(ledger["asOf"])).astimezone(zone)
    started = datetime.fromisoformat(config["startsAt"]).astimezone(zone)
    grace = timedelta(minutes=config["lateAfterMinutes"])
    schedule = config["hours"]

    scheduled = defaultdict(list)
    unscheduled = 0
    for entry in ledger["runs"]:
        if datetime.fromisoformat(entry["runEndedAt"]) > as_of:
            continue
        directory = archive / "captures" / entry["runId"]
        record = json_read(directory / "record.json")
        for key in ("runId", "scheduledFor", "runStartedAt", "runEndedAt"):
            if record[key] != entry[key]:
                raise ValueError(f"Ledger disagrees with capture metadata for {entry['runId']}")
        if not record["scheduledFor"]:
            unscheduled += 1
            continue
        slot = datetime.fromisoformat(record["scheduledFor"]).astimezone(zone)
        scheduled[slot].append((record, directory))

    slots = list(closed_slots(started, as_of, scheduled, schedule, grace))
    if as_of == datetime.fromisoformat(ledger["asOf"]):
        due = [slot for slot in slots if as_of - slot >= grace]
        if len(due) != ledger["scheduledSlotsDue"]:
            raise ValueError("Computed due slots disagree with the archive schedule")
        missing = {slot for slot in due if slot not in scheduled}
        if missing != {datetime.fromisoformat(slot) for slot in ledger["uncapturedScheduledSlots"]}:
            raise ValueError("Computed historic gaps disagree with the archive ledger")

    matches, matched_slots, gaps = [], [], []
    duplicate_runs = 0
    for slot in slots:
        candidates = sorted(
            scheduled[slot],
            key=lambda entry: (
                abs(datetime.fromisoformat(entry[0]["runStartedAt"]) - slot),
                entry[0]["runStartedAt"],
            ),
        )
        reasons = [exclusion_reason(record, directory, grace) for record, directory in candidates]
        duplicate_runs += max(0, len(candidates) - 1)
        if None in reasons:
            matches.append(candidates[reasons.index(None)][0])
            matched_slots.append(slot)
        else:
            reason, affected = reasons[0] if reasons else ("missing", list(OUTLETS))
            gaps.append({"slot": slot.isoformat(), "reason": reason, "outlets": affected})

    missing_count = sum(gap["reason"] == "missing" for gap in gaps)
    return {
        "version": "cfj-since-october-v1",
        "coverage": {
            "startDate": started.date().isoformat(),
            "endDate": slots[-1].date().isoformat() if slots else as_of.date().isoformat(),
            "firstMatched": matched_slots[0].isoformat() if matched_slots else None,
            "lastMatched": matched_slots[-1].isoformat() if matched_slots else None,
            "asOf": as_of.isoformat(timespec="seconds"),
            "timezone": config["timezone"],
            "scheduledTimes": [f"{hour:02}:00" for hour in schedule],
            "scheduledSlots": len(slots),
            "matchedSlots": len(matched_slots),
            "missingSlots": missing_count,
            "excludedSlots": len(gaps) - missing_count,
            "partialSlots": sum(gap["reason"].startswith("partial") for gap in gaps),
            "failedSlots": sum(gap["reason"] == "failed" for gap in gaps),
            "unscheduledRuns": unscheduled,
            "duplicateRuns": duplicate_runs,
            "gaps": gaps,
        },
        "outlets": count_checks(matches),
        "recurringFeatured": recurring_featured(matches),
        "methodology": [
            "Only scheduled slots with comparable captures of all three UK homepages are counted. Completed captures are included through the cut-off, even if the 45-minute grace period is still open.",
            "The unit is a check with at least one qualifying card in the recorded lead group, featured column or video playlists. Several qualifying cards still count once overall. Section counts can overlap. The same story can count again at another check.",
            "First screen means a qualifying card was fully or partly visible at the initial 1,728 × 906 desktop viewport. These checks are a subset of the checks with a card anywhere in the monitored sections.",
            "Immigration includes explicit human migration, asylum, visa policy and lived experience across geographies. The UK-linked subset requires evidence of a UK policy or migration connection. Reform covers Reform UK and people identified through their role with the party.",
            "The lower number counts confirmed checks. The upper number also allows plausible unresolved topics and, for the first screen, cards whose visibility is unknown. Cases without evidence of a UK connection stay outside the UK-linked range.",
            "The recorded lead, featured and video sections differ by outlet. Coverage is limited to these sections and the desktop sessions archived, where personalisation was possible.",
            "Readership, continuous exposure, editorial intent and bias require separate evidence. Framing was outside the scope of this count.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--as-of", type=datetime.fromisoformat, help="Optional fixed cut-off with UTC offset. Defaults to the archive ledger time.")
    parser.add_argument("--output", type=Path, default=SITE / "since-october.json")
    args = parser.parse_args()
    if args.as_of and args.as_of.tzinfo is None:
        parser.error("--as-of needs an explicit UTC offset")
    aggregate = build(args.archive, args.as_of)
    args.output.write_text(json.dumps(aggregate, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
