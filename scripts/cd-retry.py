"""Retry transient Android dependency and prerelease publication failures in CD."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time


ANDROID_HTTP = re.compile(r'Could not (?:GET|HEAD) .*?Received status code (429|500|502|503|504)\b')
GITHUB_HTTP = re.compile(r'\bHTTP (500|502|503|504)\b')
PRERELEASE = re.compile(r'v\d+\.\d+\.\d+-(?:alpha|beta|rc)\.\d+')


class CommandFailure(Exception):
    def __init__(self, message, status=None, exit_code=1):
        super().__init__(message)
        self.status = status
        self.exit_code = exit_code


def retry(operation, name):
    for attempt in range(3):
        try:
            return operation()
        except CommandFailure as error:
            if not error.status or attempt == 2:
                raise
            delay = (60 if error.status == 429 else 10) * 2 ** attempt
            print(f'{name}: HTTP {error.status}; retry {attempt + 1}/2 in {delay}s', flush=True)
            time.sleep(delay)


def android(command):
    # Preserve the Gradle log and real exit code; do not retry compile/signing failures.
    status = None
    with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, errors='replace') as process:
        for line in process.stdout:
            print(line, end='', flush=True)
            if match := ANDROID_HTTP.search(line):
                # If both rate-limit and upstream failures are present, use the longer wait.
                if status != 429:
                    status = int(match[1])
        if code := process.wait():
            raise CommandFailure(f'Gradle exited with {code}', status, code)


class GitHub:
    def __init__(self, repo, tag):
        self.repo = repo
        self.tag = tag

    def gh(self, *args, missing_ok=False):
        result = subprocess.run(['gh', *args], text=True, capture_output=True)
        if result.returncode:
            error = result.stderr.strip() or result.stdout.strip()
            if missing_ok and error == 'release not found':
                return None
            match = GITHUB_HTTP.search(error)
            raise CommandFailure(error or 'GitHub CLI failed', int(match[1]) if match else None)
        return result.stdout

    def view(self):
        output = self.gh('release', 'view', self.tag, '-R', self.repo, '--json',
                         'databaseId,tagName,isDraft,isPrerelease', missing_ok=True)
        if output is None:
            return None
        release = json.loads(output)
        if release['tagName'] != self.tag or not release['isPrerelease']:
            raise ValueError('Refusing to modify a release that is not the expected prerelease')
        return release

    def assets(self, release):
        release_id = int(release['databaseId'])
        pages = self.gh('api', '--paginate', '--slurp',
                        f'repos/{self.repo}/releases/{release_id}/assets?per_page=100')
        assets = {}
        for asset in (asset for page in json.loads(pages) for asset in page):
            if asset['name'] in assets:
                raise ValueError(f'Duplicate release asset: {asset["name"]}')
            assets[asset['name']] = asset
        return assets

    def create(self, title, body):
        with tempfile.TemporaryDirectory() as tmp:
            notes = Path(tmp) / 'notes.md'
            notes.write_text(body, encoding='utf-8')
            self.gh('release', 'create', self.tag, '-R', self.repo, '--verify-tag',
                    '--draft', '--prerelease', '--title', title, '--notes-file', str(notes))

    def upload(self, asset):
        self.gh('release', 'upload', self.tag, str(asset), '-R', self.repo)

    def remove_starter(self, asset):
        self.gh('api', '--method', 'DELETE', f'repos/{self.repo}/releases/assets/{int(asset["id"])}')

    def publish(self, release):
        self.gh('api', '--method', 'PATCH', f'repos/{self.repo}/releases/{int(release["databaseId"])}',
                '-F', 'draft=false', '-F', 'prerelease=true')


def local_assets(directory, tag):
    base = f'siyuan-{tag[1:]}'
    names = {base + suffix for suffix in ('-linux.AppImage', '-linux.tar.gz', '-linux.deb',
             '-linux.rpm', '-mac.dmg', '-mac-arm64.dmg', '-win.exe', '.apk')}
    manifest = 'SHA256SUMS.txt'
    if {item.name for item in directory.iterdir()} != names | {manifest}:
        raise ValueError('Unexpected local prerelease asset set')
    expected = {}
    for name in sorted(names | {manifest}):
        with (directory / name).open('rb') as asset:
            expected[name] = 'sha256:' + hashlib.file_digest(asset, 'sha256').hexdigest()
    entries = (directory / manifest).read_text(encoding='utf-8').splitlines()
    if sorted(entries) != sorted(f'{expected[name][7:]}  {name}' for name in names):
        raise ValueError('Local release assets do not match the verified checksum manifest')
    return expected


def pending_assets(remote, expected, draft):
    if remote.keys() - expected.keys():
        raise ValueError('Unexpected assets already exist on this release')
    missing = []
    for name, digest in expected.items():
        asset = remote.get(name)
        if asset and asset['state'] == 'uploaded' and asset.get('digest') == digest:
            continue
        if not draft:
            raise ValueError(f'Published prerelease has an unverified asset: {name}')
        if asset is None or (asset['state'] == 'starter' and asset.get('size') == 0):
            missing.append(name)
        elif asset['state'] != 'uploaded' or asset.get('digest'):
            raise ValueError(f'Refusing to overwrite an existing release asset: {name}')
        # An uploaded asset with no digest yet is not overwritten; wait for metadata below.
    return missing


def publish_once(github, directory, expected, title, body):
    release = github.view()
    if release is None:
        github.create(title, body)
        release = github.view()
        if release is None:
            raise ValueError('Created release is not visible')
    draft = release['isDraft']
    remote = github.assets(release)
    for name in pending_assets(remote, expected, draft):
        if name in remote:
            # GitHub can leave a zero-byte starter after upload HTTP 502. Never clobber uploaded files.
            github.remove_starter(remote[name])
        github.upload(directory / name)
    if not draft:
        print(f'{github.tag} is already public and verified')
        return

    for attempt in range(12):
        remote = github.assets(release)
        pending_assets(remote, expected, True)
        if all(remote.get(name, {}).get('state') == 'uploaded' and
               remote[name].get('digest') == digest for name, digest in expected.items()):
            github.publish(release)
            return
        if attempt < 11:
            time.sleep(5)
    raise ValueError('Release assets or SHA-256 digests are incomplete')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    gradle = sub.add_parser('android')
    gradle.add_argument('args', nargs=argparse.REMAINDER)
    release = sub.add_parser('release')
    release.add_argument('directory', type=Path)
    args = parser.parse_args()
    try:
        if args.mode == 'android':
            if not args.args:
                parser.error('An Android Gradle command is required')
            retry(lambda: android(args.args), 'Android dependency resolution')
        else:
            tag = os.environ['GITHUB_REF_NAME']
            if not PRERELEASE.fullmatch(tag) or tag != f'v{os.environ["RELEASE_VERSION"]}':
                raise ValueError('Not the expected prerelease tag')
            directory = args.directory.resolve(strict=True)
            expected = local_assets(directory, tag)
            github = GitHub(os.environ['GITHUB_REPOSITORY'], tag)
            retry(lambda: publish_once(github, directory, expected, os.environ['RELEASE_TITLE'],
                                       os.environ['RELEASE_BODY']), 'GitHub prerelease')
    except CommandFailure as error:
        print(error, file=sys.stderr)
        return error.exit_code
    except (OSError, ValueError, KeyError) as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
