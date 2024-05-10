import os
import re
from argparse import ArgumentParser
from _pkg import Const as C
from _pkg import Utils as U

def generate_msg_from_repo(repo_name, args):
    thisRelease = args.tag.split("/")[-1]
    pat = re.search("v([0-9.]+)", thisRelease)
    if not pat:
        return None

    action_file = "cd.yml"
    print(U.generate_header_from_repo(repo_name, args.tag, args.lastestRelease, args.electronVersion, action_file, C.HEADER[repo_name]))


if __name__ == "__main__":
    parser = ArgumentParser(
        description="Automaticly generate information from issues by tag."
    )
    parser.add_argument("-t", "--tag", help="the tag to filter issues.")
    parser.add_argument("-b", "--lastestRelease", help="lastest Release")
    parser.add_argument("-e", "--electronVersion", help="Electron Release")
    parser.add_argument("repo", help="The repository name")
    args = parser.parse_args()

    try:
        generate_msg_from_repo(args.repo, args)
    except AssertionError:
        print(args.tag)
