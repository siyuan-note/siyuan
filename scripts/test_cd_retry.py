import hashlib
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('cd_retry', Path(__file__).with_name('cd-retry.py'))
cd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cd)


class Release:
    tag = 'v3.9.0-alpha.6'
    prerelease = {'databaseId': 1, 'isDraft': True}

    def __init__(self):
        self.release = None
        self.remote = {}
        self.calls = []

    def view(self):
        return self.release

    def assets(self, release):
        return self.remote.copy()

    def create(self, title, body):
        self.calls.append('create')
        self.release = self.prerelease.copy()

    def upload(self, path):
        self.calls.append(('upload', path.name))
        self.remote[path.name] = {'state': 'uploaded', 'digest': path.name + '-digest'}

    def remove_starter(self, asset):
        self.calls.append(('remove-starter', asset['id']))
        del self.remote[asset['name']]

    def publish(self, release):
        assert release is self.release
        self.calls.append('publish')
        self.release['isDraft'] = False


class RetryTests(unittest.TestCase):
    def test_android_observed_maven_limit_and_other_failures(self):
        with patch.object(cd.time, 'sleep') as sleep, patch('builtins.print'):
            for message, expected in [
                ("> Could not GET 'https://repo.maven.apache.org/item'. Received status code 429 from server: Too Many Requests", 429),
                ("> Could not HEAD 'https://repo.maven.apache.org/item'. Received status code 503 from server: Unavailable", 503),
                ('Execution failed for task :app:compileOfficialReleaseKotlin', None),
                ("> Could not GET 'https://repo.maven.apache.org/item'. Received status code 403 from server: Forbidden", None),
                ('Signing key alias returned error 429', None),
            ]:
                f = lambda: cd.android([sys.executable, '-c', f'import sys; print({message!r}); sys.exit(17)'])
                with self.subTest(message=message), self.assertRaises(cd.CommandFailure) as error:
                    cd.retry(f, 'Android')
                self.assertEqual(error.exception.exit_code, 17)
                self.assertEqual(error.exception.status, expected)
                if expected:
                    self.assertEqual([a.args[0] for a in sleep.call_args_list], [60, 120] if expected == 429 else [10, 20])
                else:
                    sleep.assert_not_called()
                sleep.reset_mock()

    def test_successful_gradle_output_never_retries(self):
        with patch.object(cd.time, 'sleep') as sleep, patch('builtins.print'):
            cd.retry(lambda: cd.android([sys.executable, '-c',
                                        "print('Could not GET a.pom. Received status code 429')"]), 'Android')
            sleep.assert_not_called()

    def test_github_cli_uses_only_explicit_5xx_and_exact_not_found(self):
        api = cd.GitHub('owner/repo', Release.tag)
        for status, expected in [(500, 500), (502, 502), (503, 503), (504, 504),
                                 (403, None), (404, None), (422, None)]:
            with self.subTest(status=status), patch.object(cd.subprocess, 'run', return_value=
                    subprocess.CompletedProcess([], 1, '', f'gh: error (HTTP {status})')):
                with self.assertRaises(cd.CommandFailure) as error:
                    api.view()
                self.assertEqual(error.exception.status, expected)
        with patch.object(cd.subprocess, 'run', return_value=
                subprocess.CompletedProcess([], 1, '', 'release not found')):
            self.assertIsNone(api.view())

    def test_release_recovers_after_ambiguous_success_without_repeating_side_effects(self):
        expected = {'a': 'a-digest', 'b': 'b-digest'}
        for method in ('create', 'upload', 'publish'):
            with self.subTest(method=method):
                api = Release()
                original = getattr(api, method)
                def operation(*args):
                    original(*args)
                    if not operation.failed:
                        operation.failed = True
                        raise cd.CommandFailure('Response lost (HTTP 500)', 500)
                operation.failed = False
                setattr(api, method, operation)
                with patch.object(cd.time, 'sleep') as sleep, patch('builtins.print'):
                    cd.retry(lambda: cd.publish_once(api, Path('.'), expected, 'title', 'body'), 'Release')
                sleep.assert_called_once_with(10)
                self.assertEqual(api.calls, ['create', ('upload', 'a'), ('upload', 'b'), 'publish'])
                self.assertFalse(api.release['isDraft'])

    def test_resumes_draft_and_repairs_only_empty_starter(self):
        api = Release()
        api.release = api.prerelease.copy()
        api.remote = {'a': {'state': 'uploaded', 'digest': 'a-digest'},
                      'b': {'id': 42, 'name': 'b', 'state': 'starter', 'size': 0}}
        cd.publish_once(api, Path('.'), {'a': 'a-digest', 'b': 'b-digest'}, 'title', 'body')
        self.assertEqual(api.calls, [('remove-starter', 42), ('upload', 'b'), 'publish'])

    def test_never_changes_nonmatching_remote_assets(self):
        for draft, remote in [
            (True, {'a': {'state': 'uploaded', 'digest': 'wrong'}}),
            (True, {'a': {'state': 'starter', 'size': 9}}),
            (True, {'other': {'state': 'uploaded', 'digest': 'other'}}),
            (False, {}),
            (False, {'a': {'state': 'uploaded'}}),
        ]:
            with self.subTest(draft=draft, remote=remote):
                api = Release()
                api.release = {'databaseId': 1, 'isDraft': draft}
                api.remote = remote
                with self.assertRaises(ValueError):
                    cd.publish_once(api, Path('.'), {'a': 'a-digest'}, 'title', 'body')
                self.assertEqual(api.calls, [])

    def test_waits_for_digest_and_never_publishes_an_incomplete_draft(self):
        api = Release()
        api.release = api.prerelease.copy()
        api.remote = {'a': {'state': 'uploaded'}}
        with patch.object(cd.time, 'sleep') as sleep:
            with self.assertRaisesRegex(ValueError, 'incomplete'):
                cd.publish_once(api, Path('.'), {'a': 'a-digest'}, 'title', 'body')
        self.assertEqual(sleep.call_count, 11)
        self.assertEqual(api.calls, [])

    def test_local_manifest_validates_all_eight_and_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            names = ['siyuan-3.9.0-alpha.6' + suffix for suffix in [
                '-linux.AppImage', '-linux.tar.gz', '-linux.deb', '-linux.rpm', '-mac.dmg',
                '-mac-arm64.dmg', '-win.exe', '.apk']]
            rows = []
            for name in names:
                (root / name).write_text(name)
                rows.append(f'{hashlib.sha256(name.encode()).hexdigest()}  {name}')
            (root / 'SHA256SUMS.txt').write_text('\n'.join(rows) + '\n')
            self.assertEqual(len(cd.local_assets(root, Release.tag)), 9)
            (root / names[0]).write_text('tampered')
            with self.assertRaisesRegex(ValueError, 'do not match'):
                cd.local_assets(root, Release.tag)

    def test_workflow_uses_retry_controller_without_mutating_previous_packages(self):
        workflow = (Path(__file__).resolve().parents[1] / '.github/workflows/cd.yml').read_text()
        for command in ['android ./gradlew --init-script', 'android ./gradlew assembleOfficialRelease',
                        'python3 source/scripts/cd-retry.py release release-assets']:
            self.assertIn(command, workflow)
        self.assertNotIn('--clobber', workflow)
        self.assertIn('persist-credentials: false\n          path: source', workflow)
        self.assertIn('group: cd-publish-${{ github.ref }}', workflow)


if __name__ == '__main__':
    unittest.main()
