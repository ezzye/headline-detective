"""Regression tests for the matched-check aggregate and its uncertainty rules."""

from datetime import datetime, timedelta
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import unittest
from zoneinfo import ZoneInfo


SPEC = spec_from_file_location("since_october", Path(__file__).with_name("build-since-october.py"))
aggregate = module_from_spec(SPEC)
SPEC.loader.exec_module(aggregate)


def card(headline, topic="immigration", visible=False, url=None):
    return {
        "headline": headline,
        "standfirst": "",
        "topic": topic,
        "firstViewport": visible,
        "url": url,
    }


def section(kind, *items):
    return {"kind": kind, "items": items}


def matched_record(*bbc_sections):
    return {"outlets": [
        {"id": "bbc", "sections": bbc_sections},
        {"id": "itv", "sections": (section("lead", card("Other", "other")),)},
        {"id": "channel4", "sections": (section("lead", card("Other", "other")),)},
    ]}


class AggregateTests(unittest.TestCase):
    def test_check_union_and_uncertainty(self):
        uk_policy = card("Changes to UK asylum rules", visible=True)
        concealed_policy = card("More UK visa approvals", visible=None)
        partly_reported_policy = card("Ministers discuss youth mobility", "uncertain", visible=None)
        global_policy = card("Tuvalu residents applying for relocation visa", visible=False)
        personal_story = card("Growing up as a refugee", visible=False)
        immigration_review = aggregate.count_checks([
            matched_record(section("lead", uk_policy, uk_policy), section("video", uk_policy)),
            matched_record(section("lead", partly_reported_policy)),
            matched_record(section("lead", concealed_policy, global_policy, personal_story)),
        ])["bbc"]
        total = immigration_review["topics"]["immigration"]
        uk = immigration_review["topics"]["immigrationUK"]
        self.assertEqual(total["all"], {"min": 2, "max": 3})
        self.assertEqual(total["firstScreen"], {"min": 1, "max": 3})
        self.assertEqual(total["sections"]["lead"]["all"], {"min": 2, "max": 3})
        self.assertEqual(total["sections"]["video"]["all"], {"min": 1, "max": 1})
        self.assertEqual(uk["all"], {"min": 2, "max": 3})
        self.assertEqual(uk["unknownVisibilityChecks"], 2)
        self.assertEqual(uk["uncertainTopicChecks"], 1)
        self.assertEqual(immigration_review["immigrationUnknownJurisdiction"], 1)
        self.assertEqual(immigration_review["sectionObservations"]["featured"], 0)

    def test_provisional_other_is_corrected_only_for_party_references(self):
        outlet = aggregate.count_checks([
            matched_record(section("video", card("Welfare reform", "other"))),
            matched_record(section("video", card("Reform UK councillors in the news", "other"))),
        ])["bbc"]
        self.assertEqual(outlet["topics"]["reform"]["all"], {"min": 1, "max": 1})
        self.assertEqual(outlet["topics"]["reform"]["firstScreen"], {"min": 0, "max": 0})

    def test_schedule_uses_london_clock_and_includes_already_logged_current_slot(self):
        zone = ZoneInfo("Europe/London")
        started = datetime(2026, 10, 24, 7, tzinfo=zone)
        as_of = datetime(2026, 10, 25, 8, 4, tzinfo=zone)
        current_slot = datetime(2026, 10, 25, 8, tzinfo=zone)
        slots = list(aggregate.closed_slots(started, as_of, {current_slot}, [8], timedelta(minutes=45)))
        self.assertEqual(
            [slot.isoformat() for slot in slots],
            ["2026-10-24T08:00:00+01:00", "2026-10-25T08:00:00+00:00"],
        )
        self.assertEqual(len(list(aggregate.closed_slots(started, as_of, {}, [8], timedelta(minutes=45)))), 1)


if __name__ == "__main__":
    unittest.main()
