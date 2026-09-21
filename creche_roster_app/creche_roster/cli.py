"""Command line: `python -m creche_roster init` and `python -m creche_roster build`."""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

from .engine import build_roster
from .excel_io import make_template, read_inputs, write_workbook
from .models import InputError
from .parsing import parse_date
from .pdf_out import write_pdf

DEFAULT_FILE = "Roster_Planner.xlsx"


def _cmd_init(args) -> int:
    path = Path(args.path)
    if path.exists() and not args.force:
        print(f"{path} already exists. Use --force to overwrite it.", file=sys.stderr)
        return 1
    start = parse_date(args.start) if args.start else None
    make_template(path, start)
    print(f"Created {path}. Replace the placeholder names and numbers, then run:")
    print(f"  python -m creche_roster build {path}")
    return 0


def _cmd_build(args) -> int:
    path = Path(args.path)
    if not path.exists():
        print(f"{path} not found. Create a starter file with: python -m creche_roster init", file=sys.stderr)
        return 1
    try:
        inputs = read_inputs(path)
        roster = build_roster(inputs)
    except InputError as e:
        print("The input workbook needs fixing:", file=sys.stderr)
        print(e, file=sys.stderr)
        return 1
    try:
        write_workbook(path, roster, backup=not args.no_backup)
    except PermissionError:
        print(f"Cannot write {path}. Close it in Excel and run again.", file=sys.stderr)
        return 1
    pdf_path = None
    if not args.no_pdf:
        pdf_path = Path(args.pdf) if args.pdf else path.with_suffix(".pdf")
        try:
            write_pdf(roster, pdf_path)
        except PermissionError:
            print(f"Cannot write {pdf_path}. Close it and run again.", file=sys.stderr)
            return 1

    weeks = len(roster.weeks)
    print(f"Generated {weeks} week(s) in {path}" + (f" and {pdf_path}" if pdf_path else "") + ".")
    breaches = roster.breaches
    warnings = [c for c in roster.checks if c.level == "WARNING"]
    if breaches:
        print(f"\n{len(breaches)} HARD-RULE BREACH(ES):")
        for c in breaches[:10]:
            print(f"  - {c.message}")
        if len(breaches) > 10:
            print(f"  ... and {len(breaches) - 10} more (see the Checks tab)")
    else:
        print("Hard rules: all met.")
    for c in warnings:
        print(f"  Note: {c.message}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="creche_roster", description="Creche staff roster generator")
    sub = parser.add_subparsers(dest="cmd")

    p_init = sub.add_parser("init", help="create a starter workbook")
    p_init.add_argument("path", nargs="?", default=DEFAULT_FILE)
    p_init.add_argument("--start", help="first Monday, e.g. 21/09/2026 (default: next Monday)")
    p_init.add_argument("--force", action="store_true", help="overwrite an existing file")
    p_init.set_defaults(func=_cmd_init)

    p_build = sub.add_parser("build", help="generate the roster into the workbook and a PDF")
    p_build.add_argument("path", nargs="?", default=DEFAULT_FILE)
    p_build.add_argument("--pdf", help="PDF path (default: next to the workbook)")
    p_build.add_argument("--no-pdf", action="store_true")
    p_build.add_argument("--no-backup", action="store_true", help="do not write Roster_Planner.xlsx.bak")
    p_build.set_defaults(func=_cmd_build)

    args = parser.parse_args(argv)
    if not args.cmd:
        args = parser.parse_args(["build"] + (argv or []))
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
