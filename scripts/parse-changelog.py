#!/usr/bin/env python3
from pathlib import Path
from argparse import ArgumentParser


def parse_latest_changelog(text: str) -> str:
    """Read the contents between the first `##` and the second `##`"""
    recording = False
    contents: list[str] = []
    for line in text.splitlines():
        if line.strip().startswith("## ") and recording is False:
            recording = True
        elif line.strip().startswith("## ") and recording is True:
            break
        if recording:
            contents.append(line)

    return "\n".join(contents[1:])


def get_changelog() -> str:
    parser = ArgumentParser(description="Get the latest change log from CHANG_LOGS.md")
    parser.add_argument("changelog_file", help="The path of CHANGE_LOGS.md")
    args = parser.parse_args()
    with Path(args.changelog_file).open() as f:
        return f.read()


if __name__ == '__main__':
    changelog = get_changelog()
    latest_changelog = parse_latest_changelog(changelog)
    print(latest_changelog)
