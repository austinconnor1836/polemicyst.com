#!/usr/bin/env python3
"""
NCAA Tournament Historical Seed Win Probability Calculator

Computes win probabilities for each seed (1-16) by round using
historical tournament data from the 64-team era (1985-2024).
39 tournaments (2020 cancelled due to COVID).

Accepts an optional --seed argument (1-16) to focus on a specific seed.
Defaults to seed 1 if not specified.

Data sources:
  - NCAA.com historical tournament records
    https://www.ncaa.com/news/basketball-men/article/2025-02-05/records-every-seed-march-madness-1985-2024
  - Sports-Reference.com college basketball tournament data
    https://www.sports-reference.com/cbb/friv/ncaa-tourney-upsets.html
  - BracketResearch.com seed-by-seed championship history
    https://bracketresearch.com/the-dna-of-a-national-championship-team/seeds-of-ncaa-tournament-champions/
"""

import argparse
import json
import sys

# ---------------------------------------------------------------------------
# Historical aggregate results by seed per round (1985-2024, 39 tournaments)
# Format: { seed: { "round_name": (wins, total_games) } }
# 4 teams of each seed per tournament, 39 tournaments = 156 entries per seed
# ---------------------------------------------------------------------------
SEED_ROUND_RESULTS = {
    1: {
        "Round of 64": (150, 156),
        "Round of 32": (127, 150),
        "Sweet 16": (88, 127),
        "Elite 8": (56, 88),
        "Final Four": (33, 56),
        "Championship": (22, 33),
    },
    2: {
        "Round of 64": (148, 156),
        "Round of 32": (105, 148),
        "Sweet 16": (56, 105),
        "Elite 8": (26, 56),
        "Final Four": (13, 26),
        "Championship": (6, 13),
    },
    3: {
        "Round of 64": (137, 156),
        "Round of 32": (82, 137),
        "Sweet 16": (35, 82),
        "Elite 8": (14, 35),
        "Final Four": (6, 14),
        "Championship": (2, 6),
    },
    4: {
        "Round of 64": (131, 156),
        "Round of 32": (72, 131),
        "Sweet 16": (32, 72),
        "Elite 8": (14, 32),
        "Final Four": (5, 14),
        "Championship": (2, 5),
    },
    5: {
        "Round of 64": (104, 156),
        "Round of 32": (52, 104),
        "Sweet 16": (19, 52),
        "Elite 8": (7, 19),
        "Final Four": (3, 7),
        "Championship": (1, 3),
    },
    6: {
        "Round of 64": (103, 156),
        "Round of 32": (49, 103),
        "Sweet 16": (17, 49),
        "Elite 8": (8, 17),
        "Final Four": (3, 8),
        "Championship": (2, 3),
    },
    7: {
        "Round of 64": (97, 156),
        "Round of 32": (35, 97),
        "Sweet 16": (14, 35),
        "Elite 8": (4, 14),
        "Final Four": (1, 4),
        "Championship": (0, 1),
    },
    8: {
        "Round of 64": (81, 156),
        "Round of 32": (26, 81),
        "Sweet 16": (12, 26),
        "Elite 8": (5, 12),
        "Final Four": (3, 5),
        "Championship": (1, 3),
    },
    9: {
        "Round of 64": (75, 156),
        "Round of 32": (19, 75),
        "Sweet 16": (5, 19),
        "Elite 8": (2, 5),
        "Final Four": (1, 2),
        "Championship": (0, 1),
    },
    10: {
        "Round of 64": (59, 156),
        "Round of 32": (23, 59),
        "Sweet 16": (10, 23),
        "Elite 8": (3, 10),
        "Final Four": (1, 3),
        "Championship": (0, 1),
    },
    11: {
        "Round of 64": (56, 156),
        "Round of 32": (27, 56),
        "Sweet 16": (14, 27),
        "Elite 8": (5, 14),
        "Final Four": (4, 5),
        "Championship": (1, 4),
    },
    12: {
        "Round of 64": (52, 156),
        "Round of 32": (14, 52),
        "Sweet 16": (3, 14),
        "Elite 8": (1, 3),
        "Final Four": (0, 1),
        "Championship": (0, 0),
    },
    13: {
        "Round of 64": (25, 156),
        "Round of 32": (4, 25),
        "Sweet 16": (0, 4),
        "Elite 8": (0, 0),
        "Final Four": (0, 0),
        "Championship": (0, 0),
    },
    14: {
        "Round of 64": (19, 156),
        "Round of 32": (2, 19),
        "Sweet 16": (0, 2),
        "Elite 8": (0, 0),
        "Final Four": (0, 0),
        "Championship": (0, 0),
    },
    15: {
        "Round of 64": (8, 156),
        "Round of 32": (2, 8),
        "Sweet 16": (1, 2),
        "Elite 8": (0, 1),
        "Final Four": (0, 0),
        "Championship": (0, 0),
    },
    16: {
        "Round of 64": (2, 156),
        "Round of 32": (0, 2),
        "Sweet 16": (0, 0),
        "Elite 8": (0, 0),
        "Final Four": (0, 0),
        "Championship": (0, 0),
    },
}

# ---------------------------------------------------------------------------
# First-round upsets keyed by the FAVORED seed (1-8).
# Each entry records the lower-seeded team beating the higher-seeded team.
# Seeds 9-16 share the same data from the underdog perspective.
# ---------------------------------------------------------------------------
FIRST_ROUND_UPSETS = {
    1: [
        {"year": 2018, "winner": "UMBC", "winner_seed": 16, "loser": "Virginia", "score": "74-54", "round": "Round of 64"},
        {"year": 2023, "winner": "Fairleigh Dickinson", "winner_seed": 16, "loser": "Purdue", "score": "63-58", "round": "Round of 64"},
    ],
    2: [
        {"year": 1991, "winner": "Richmond", "winner_seed": 15, "loser": "Syracuse", "score": "73-69", "round": "Round of 64"},
        {"year": 1993, "winner": "Santa Clara", "winner_seed": 15, "loser": "Arizona", "score": "64-61", "round": "Round of 64"},
        {"year": 1997, "winner": "Coppin State", "winner_seed": 15, "loser": "South Carolina", "score": "78-65", "round": "Round of 64"},
        {"year": 2001, "winner": "Hampton", "winner_seed": 15, "loser": "Iowa State", "score": "58-57", "round": "Round of 64"},
        {"year": 2012, "winner": "Lehigh", "winner_seed": 15, "loser": "Duke", "score": "75-70", "round": "Round of 64"},
        {"year": 2012, "winner": "Norfolk State", "winner_seed": 15, "loser": "Missouri", "score": "86-84", "round": "Round of 64"},
        {"year": 2013, "winner": "Florida Gulf Coast", "winner_seed": 15, "loser": "Georgetown", "score": "78-68", "round": "Round of 64"},
        {"year": 2016, "winner": "Middle Tennessee", "winner_seed": 15, "loser": "Michigan State", "score": "90-81", "round": "Round of 64"},
        {"year": 2021, "winner": "Oral Roberts", "winner_seed": 15, "loser": "Ohio State", "score": "75-72", "round": "Round of 64"},
        {"year": 2022, "winner": "Saint Peter's", "winner_seed": 15, "loser": "Kentucky", "score": "85-79", "round": "Round of 64"},
        {"year": 2023, "winner": "Princeton", "winner_seed": 15, "loser": "Arizona", "score": "59-55", "round": "Round of 64"},
    ],
    3: [
        {"year": 1986, "winner": "Arkansas-Little Rock", "winner_seed": 14, "loser": "Notre Dame", "score": "90-83", "round": "Round of 64"},
        {"year": 1986, "winner": "Cleveland State", "winner_seed": 14, "loser": "Indiana", "score": "83-79", "round": "Round of 64"},
        {"year": 1987, "winner": "Austin Peay", "winner_seed": 14, "loser": "Illinois", "score": "68-67", "round": "Round of 64"},
        {"year": 1988, "winner": "Murray State", "winner_seed": 14, "loser": "NC State", "score": "78-75", "round": "Round of 64"},
        {"year": 1989, "winner": "Siena", "winner_seed": 14, "loser": "Stanford", "score": "80-78", "round": "Round of 64"},
        {"year": 1990, "winner": "Northern Iowa", "winner_seed": 14, "loser": "Missouri", "score": "74-71", "round": "Round of 64"},
        {"year": 1991, "winner": "Xavier", "winner_seed": 14, "loser": "Nebraska", "score": "89-84", "round": "Round of 64"},
        {"year": 1992, "winner": "East Tennessee State", "winner_seed": 14, "loser": "Arizona", "score": "87-80", "round": "Round of 64"},
        {"year": 1995, "winner": "Old Dominion", "winner_seed": 14, "loser": "Villanova", "score": "89-81", "round": "Round of 64"},
        {"year": 1995, "winner": "Weber State", "winner_seed": 14, "loser": "Michigan State", "score": "79-72", "round": "Round of 64"},
        {"year": 1997, "winner": "Chattanooga", "winner_seed": 14, "loser": "Georgia", "score": "73-70", "round": "Round of 64"},
        {"year": 1998, "winner": "Richmond", "winner_seed": 14, "loser": "South Carolina", "score": "62-61", "round": "Round of 64"},
        {"year": 1999, "winner": "Weber State", "winner_seed": 14, "loser": "North Carolina", "score": "76-74", "round": "Round of 64"},
        {"year": 2005, "winner": "Bucknell", "winner_seed": 14, "loser": "Kansas", "score": "64-63", "round": "Round of 64"},
        {"year": 2006, "winner": "Northwestern State", "winner_seed": 14, "loser": "Iowa", "score": "64-63", "round": "Round of 64"},
        {"year": 2010, "winner": "Ohio", "winner_seed": 14, "loser": "Georgetown", "score": "97-83", "round": "Round of 64"},
        {"year": 2013, "winner": "Harvard", "winner_seed": 14, "loser": "New Mexico", "score": "68-62", "round": "Round of 64"},
        {"year": 2014, "winner": "Mercer", "winner_seed": 14, "loser": "Duke", "score": "78-71", "round": "Round of 64"},
        {"year": 2015, "winner": "Georgia State", "winner_seed": 14, "loser": "Baylor", "score": "57-56", "round": "Round of 64"},
        {"year": 2015, "winner": "UAB", "winner_seed": 14, "loser": "Iowa State", "score": "60-59", "round": "Round of 64"},
        {"year": 2016, "winner": "Stephen F. Austin", "winner_seed": 14, "loser": "West Virginia", "score": "70-56", "round": "Round of 64"},
        {"year": 2021, "winner": "Abilene Christian", "winner_seed": 14, "loser": "Texas", "score": "53-52", "round": "Round of 64"},
        {"year": 2024, "winner": "Oakland", "winner_seed": 14, "loser": "Kentucky", "score": "80-76", "round": "Round of 64"},
    ],
    4: [
        {"year": 1985, "winner": "Navy", "winner_seed": 13, "loser": "LSU", "score": "78-55", "round": "Round of 64"},
        {"year": 1987, "winner": "Southwest Missouri State", "winner_seed": 13, "loser": "Clemson", "score": "65-60", "round": "Round of 64"},
        {"year": 1988, "winner": "Richmond", "winner_seed": 13, "loser": "Indiana", "score": "72-69", "round": "Round of 64"},
        {"year": 1991, "winner": "Penn State", "winner_seed": 13, "loser": "UCLA", "score": "74-69", "round": "Round of 64"},
        {"year": 1992, "winner": "SW Louisiana", "winner_seed": 13, "loser": "Oklahoma", "score": "87-83", "round": "Round of 64"},
        {"year": 1993, "winner": "Southern", "winner_seed": 13, "loser": "Georgia Tech", "score": "93-78", "round": "Round of 64"},
        {"year": 1995, "winner": "Manhattan", "winner_seed": 13, "loser": "Oklahoma", "score": "77-67", "round": "Round of 64"},
        {"year": 1996, "winner": "Princeton", "winner_seed": 13, "loser": "UCLA", "score": "43-41", "round": "Round of 64"},
        {"year": 1998, "winner": "Valparaiso", "winner_seed": 13, "loser": "Ole Miss", "score": "70-69", "round": "Round of 64"},
        {"year": 2001, "winner": "Indiana State", "winner_seed": 13, "loser": "Oklahoma", "score": "70-68", "round": "Round of 64"},
        {"year": 2001, "winner": "Kent State", "winner_seed": 13, "loser": "Indiana", "score": "77-73", "round": "Round of 64"},
        {"year": 2005, "winner": "Vermont", "winner_seed": 13, "loser": "Syracuse", "score": "60-57", "round": "Round of 64"},
        {"year": 2006, "winner": "Bradley", "winner_seed": 13, "loser": "Kansas", "score": "77-73", "round": "Round of 64"},
        {"year": 2008, "winner": "San Diego", "winner_seed": 13, "loser": "UConn", "score": "70-69", "round": "Round of 64"},
        {"year": 2009, "winner": "Cleveland State", "winner_seed": 13, "loser": "Wake Forest", "score": "84-69", "round": "Round of 64"},
        {"year": 2010, "winner": "Murray State", "winner_seed": 13, "loser": "Vanderbilt", "score": "66-65", "round": "Round of 64"},
        {"year": 2011, "winner": "Morehead State", "winner_seed": 13, "loser": "Louisville", "score": "62-61", "round": "Round of 64"},
        {"year": 2012, "winner": "Ohio", "winner_seed": 13, "loser": "Michigan", "score": "65-60", "round": "Round of 64"},
        {"year": 2013, "winner": "La Salle", "winner_seed": 13, "loser": "Kansas State", "score": "63-61", "round": "Round of 64"},
        {"year": 2016, "winner": "Hawaii", "winner_seed": 13, "loser": "California", "score": "77-66", "round": "Round of 64"},
        {"year": 2018, "winner": "Buffalo", "winner_seed": 13, "loser": "Arizona", "score": "89-69", "round": "Round of 64"},
        {"year": 2018, "winner": "Marshall", "winner_seed": 13, "loser": "Wichita State", "score": "81-75", "round": "Round of 64"},
        {"year": 2019, "winner": "UC Irvine", "winner_seed": 13, "loser": "Kansas State", "score": "70-64", "round": "Round of 64"},
        {"year": 2021, "winner": "Ohio", "winner_seed": 13, "loser": "Virginia", "score": "62-58", "round": "Round of 64"},
        {"year": 2021, "winner": "North Texas", "winner_seed": 13, "loser": "Purdue", "score": "78-69", "round": "Round of 64"},
        {"year": 2023, "winner": "Furman", "winner_seed": 13, "loser": "Virginia", "score": "68-67", "round": "Round of 64"},
        {"year": 2024, "winner": "Yale", "winner_seed": 13, "loser": "Auburn", "score": "78-76", "round": "Round of 64"},
    ],
    5: [
        {"year": 1985, "winner": "Kentucky", "winner_seed": 12, "loser": "Washington", "score": "66-58", "round": "Round of 64"},
        {"year": 1990, "winner": "Dayton", "winner_seed": 12, "loser": "Illinois", "score": "88-86", "round": "Round of 64"},
        {"year": 1994, "winner": "Tulsa", "winner_seed": 12, "loser": "UCLA", "score": "112-102", "round": "Round of 64"},
        {"year": 2001, "winner": "Gonzaga", "winner_seed": 12, "loser": "Virginia", "score": "86-85", "round": "Round of 64"},
        {"year": 2002, "winner": "Missouri", "winner_seed": 12, "loser": "Miami (FL)", "score": "93-80", "round": "Round of 64"},
        {"year": 2008, "winner": "Western Kentucky", "winner_seed": 12, "loser": "Drake", "score": "101-99", "round": "Round of 64"},
        {"year": 2010, "winner": "Cornell", "winner_seed": 12, "loser": "Temple", "score": "78-65", "round": "Round of 64"},
        {"year": 2011, "winner": "Richmond", "winner_seed": 12, "loser": "Vanderbilt", "score": "69-66", "round": "Round of 64"},
        {"year": 2016, "winner": "Yale", "winner_seed": 12, "loser": "Baylor", "score": "79-75", "round": "Round of 64"},
        {"year": 2016, "winner": "Little Rock", "winner_seed": 12, "loser": "Purdue", "score": "85-83", "round": "Round of 64"},
        {"year": 2019, "winner": "Murray State", "winner_seed": 12, "loser": "Marquette", "score": "83-64", "round": "Round of 64"},
        {"year": 2022, "winner": "New Mexico State", "winner_seed": 12, "loser": "UConn", "score": "70-63", "round": "Round of 64"},
        {"year": 2022, "winner": "Richmond", "winner_seed": 12, "loser": "Iowa", "score": "67-63", "round": "Round of 64"},
        {"year": 2024, "winner": "Grand Canyon", "winner_seed": 12, "loser": "Saint Mary's", "score": "75-66", "round": "Round of 64"},
    ],
    6: [
        {"year": 2006, "winner": "George Mason", "winner_seed": 11, "loser": "Michigan State", "score": "75-65", "round": "Round of 64"},
        {"year": 2016, "winner": "Gonzaga", "winner_seed": 11, "loser": "Seton Hall", "score": "68-52", "round": "Round of 64"},
        {"year": 2016, "winner": "Northern Iowa", "winner_seed": 11, "loser": "Texas", "score": "75-72", "round": "Round of 64"},
        {"year": 2016, "winner": "Wichita State", "winner_seed": 11, "loser": "Arizona", "score": "65-55", "round": "Round of 64"},
        {"year": 2018, "winner": "Loyola Chicago", "winner_seed": 11, "loser": "Miami", "score": "64-62", "round": "Round of 64"},
        {"year": 2021, "winner": "UCLA", "winner_seed": 11, "loser": "BYU", "score": "73-62", "round": "Round of 64"},
        {"year": 2024, "winner": "NC State", "winner_seed": 11, "loser": "Texas Tech", "score": "80-67", "round": "Round of 64"},
        {"year": 2024, "winner": "Duquesne", "winner_seed": 11, "loser": "BYU", "score": "71-67", "round": "Round of 64"},
        {"year": 2024, "winner": "Oregon", "winner_seed": 11, "loser": "South Carolina", "score": "87-73", "round": "Round of 64"},
    ],
    7: [
        {"year": 1998, "winner": "West Virginia", "winner_seed": 10, "loser": "Temple", "score": "82-52", "round": "Round of 64"},
        {"year": 2019, "winner": "Florida", "winner_seed": 10, "loser": "Nevada", "score": "70-61", "round": "Round of 64"},
        {"year": 2019, "winner": "Iowa", "winner_seed": 10, "loser": "Cincinnati", "score": "79-72", "round": "Round of 64"},
        {"year": 2019, "winner": "Minnesota", "winner_seed": 10, "loser": "Louisville", "score": "86-76", "round": "Round of 64"},
        {"year": 2021, "winner": "Rutgers", "winner_seed": 10, "loser": "Clemson", "score": "60-56", "round": "Round of 64"},
        {"year": 2024, "winner": "Colorado", "winner_seed": 10, "loser": "Florida", "score": "102-100", "round": "Round of 64"},
    ],
    8: [
        {"year": 2019, "winner": "Baylor", "winner_seed": 9, "loser": "Syracuse", "score": "78-69", "round": "Round of 64"},
        {"year": 2019, "winner": "UCF", "winner_seed": 9, "loser": "VCU", "score": "73-58", "round": "Round of 64"},
        {"year": 2019, "winner": "Washington", "winner_seed": 9, "loser": "Utah State", "score": "78-61", "round": "Round of 64"},
        {"year": 2019, "winner": "Oklahoma", "winner_seed": 9, "loser": "Ole Miss", "score": "95-72", "round": "Round of 64"},
        {"year": 2024, "winner": "Texas A&M", "winner_seed": 9, "loser": "Nebraska", "score": "98-83", "round": "Round of 64"},
        {"year": 2024, "winner": "Northwestern", "winner_seed": 9, "loser": "Florida Atlantic", "score": "77-65", "round": "Round of 64"},
    ],
}

# ---------------------------------------------------------------------------
# National champions by seed (1985-2024).
# Source: BracketResearch.com, NCAA.com year-by-year records.
# ---------------------------------------------------------------------------
CHAMPIONS_BY_SEED = {
    1: [
        {"year": 1987, "team": "Indiana"},
        {"year": 1990, "team": "UNLV"},
        {"year": 1992, "team": "Duke"},
        {"year": 1993, "team": "North Carolina"},
        {"year": 1994, "team": "Arkansas"},
        {"year": 1995, "team": "UCLA"},
        {"year": 1996, "team": "Kentucky"},
        {"year": 1999, "team": "UConn"},
        {"year": 2000, "team": "Michigan State"},
        {"year": 2001, "team": "Duke"},
        {"year": 2002, "team": "Maryland"},
        {"year": 2005, "team": "North Carolina"},
        {"year": 2007, "team": "Florida"},
        {"year": 2008, "team": "Kansas"},
        {"year": 2009, "team": "North Carolina"},
        {"year": 2010, "team": "Duke"},
        {"year": 2012, "team": "Kentucky"},
        {"year": 2013, "team": "Louisville"},
        {"year": 2015, "team": "Duke"},
        {"year": 2017, "team": "North Carolina"},
        {"year": 2018, "team": "Villanova"},
        {"year": 2019, "team": "Virginia"},
        {"year": 2021, "team": "Baylor"},
        {"year": 2022, "team": "Kansas"},
        {"year": 2024, "team": "UConn"},
    ],
    2: [
        {"year": 1986, "team": "Louisville"},
        {"year": 1991, "team": "Duke"},
        {"year": 1998, "team": "Kentucky"},
        {"year": 2004, "team": "UConn"},
        {"year": 2016, "team": "Villanova"},
    ],
    3: [
        {"year": 1989, "team": "Michigan"},
        {"year": 2003, "team": "Syracuse"},
        {"year": 2006, "team": "Florida"},
        {"year": 2011, "team": "UConn"},
    ],
    4: [
        {"year": 1997, "team": "Arizona"},
        {"year": 2023, "team": "UConn"},
    ],
    6: [
        {"year": 1988, "team": "Kansas"},
    ],
    7: [
        {"year": 2014, "team": "UConn"},
    ],
    8: [
        {"year": 1985, "team": "Villanova"},
    ],
}

# First-round opponent seed for each seed (standard NCAA bracket)
FIRST_ROUND_MATCHUP = {
    1: 16, 2: 15, 3: 14, 4: 13, 5: 12, 6: 11, 7: 10, 8: 9,
    9: 8, 10: 7, 11: 6, 12: 5, 13: 4, 14: 3, 15: 2, 16: 1,
}

ROUND_ORDER = [
    "Round of 64",
    "Round of 32",
    "Sweet 16",
    "Elite 8",
    "Final Four",
    "Championship",
]

DATA_SOURCES = [
    {
        "name": "NCAA.com",
        "url": "https://www.ncaa.com/news/basketball-men/article/2025-02-05/records-every-seed-march-madness-1985-2024",
        "description": "Official NCAA historical tournament records by seed",
    },
    {
        "name": "Sports-Reference.com",
        "url": "https://www.sports-reference.com/cbb/friv/ncaa-tourney-upsets.html",
        "description": "College basketball tournament upset history and statistics",
    },
    {
        "name": "BracketResearch.com",
        "url": "https://bracketresearch.com/the-dna-of-a-national-championship-team/seeds-of-ncaa-tournament-champions/",
        "description": "Championship winners by seed analysis",
    },
]

TOTAL_TOURNAMENTS = 39
TEAMS_PER_SEED = 4
TOTAL_TEAMS_PER_SEED = TOTAL_TOURNAMENTS * TEAMS_PER_SEED  # 156


def compute_seed_data(seed: int) -> dict:
    """Compute comprehensive probability data for a given seed."""
    rounds = SEED_ROUND_RESULTS[seed]
    round_data = []

    for round_name in ROUND_ORDER:
        wins, total = rounds[round_name]
        win_pct = (wins / total * 100) if total > 0 else 0
        reach_pct = (total / TOTAL_TEAMS_PER_SEED * 100) if TOTAL_TEAMS_PER_SEED > 0 else 0

        round_data.append({
            "round": round_name,
            "wins": wins,
            "losses": total - wins,
            "total_games": total,
            "win_percentage": round(win_pct, 1),
            "reach_percentage": round(reach_pct, 1),
        })

    return {
        "seed": seed,
        "total_tournaments": TOTAL_TOURNAMENTS,
        "total_teams": TOTAL_TEAMS_PER_SEED,
        "rounds": round_data,
    }


def compute_all_seeds_comparison() -> list:
    """Compute summary data for all seeds for comparison."""
    comparison = []
    for seed in range(1, 17):
        rounds = SEED_ROUND_RESULTS[seed]
        r64_wins, r64_total = rounds["Round of 64"]
        r64_pct = (r64_wins / r64_total * 100) if r64_total > 0 else 0

        champ_wins, _ = rounds["Championship"]
        titles = champ_wins

        reach_sweet16 = rounds["Sweet 16"][1] / TOTAL_TEAMS_PER_SEED * 100
        reach_final4 = rounds["Final Four"][1] / TOTAL_TEAMS_PER_SEED * 100

        comparison.append({
            "seed": seed,
            "r64_win_pct": round(r64_pct, 1),
            "sweet16_reach_pct": round(reach_sweet16, 1),
            "final4_reach_pct": round(reach_final4, 1),
            "championships": titles,
        })

    return comparison


def main():
    """Main entry point - outputs JSON data to stdout."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=1, choices=range(1, 17),
                        metavar="SEED", help="Seed number to focus on (1-16)")
    args = parser.parse_args()
    focus_seed = args.seed

    seed_data = compute_seed_data(focus_seed)
    all_seeds = compute_all_seeds_comparison()

    opponent_seed = FIRST_ROUND_MATCHUP[focus_seed]

    # For seeds 1-8, return their upset losses. For 9-16, return upset wins.
    if focus_seed <= 8:
        upset_key = focus_seed
        upset_context = "losses"
    else:
        upset_key = opponent_seed
        upset_context = "wins"

    seed_data["notable_upsets"] = FIRST_ROUND_UPSETS.get(upset_key, [])
    seed_data["upset_context"] = upset_context
    seed_data["championships"] = CHAMPIONS_BY_SEED.get(focus_seed, [])
    seed_data["opponent_seed"] = opponent_seed
    seed_data["data_range"] = "1985-2024"
    seed_data["sources"] = DATA_SOURCES
    seed_data["note"] = (
        f"Data covers the 64-team era (1985-2024). "
        f"The 2020 tournament was cancelled due to COVID-19. "
        f"39 total tournaments, 156 total {focus_seed}-seeds."
    )

    output = {
        "seed_focus": seed_data,
        "all_seeds_comparison": all_seeds,
    }

    json.dump(output, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
