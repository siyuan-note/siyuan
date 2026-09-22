"""发布准备测试：版本更新、幂等性及本地临时仓库的提交和推送。"""

import argparse
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("prepare_release", Path(__file__).with_name("prepare-release.py"))
prepare = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare)


class PrepareTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.args = argparse.Namespace(repo=self.root / "main", android_dir=self.root / "android",
                                       harmony_dir=self.root / "harmony", version="3.8.6",
                                       android_code=None, harmony_code=None, execute=True)
        files = {
            self.args.repo / "app/package.json": '{"version": "3.8.5"}\r\n',
            self.args.repo / "kernel/util/working.go": 'var Mode = "dev"\r\nconst Ver = "3.8.5"\r\n',
            self.args.repo / "docs/RELEASE-VERIFICATION.zh-CN.md":
                '<!-- release-version: 3.8.5 -->\r\nv3.8.5 3.8.5-beta.1 siyuan-3.8.5.apk 3.8.50\r\n',
            self.args.android_dir / "build.gradle": 'siyuanVersionCode = 398\r\nsiyuanVersionName = "3.8.5"\r\n',
            self.args.harmony_dir / "AppScope/app.json5": '{"versionName": "3.8.5", "versionCode": 1000096}\r\n',
        }
        for name in ("AppxManifest.xml", "AppxManifest-arm64.xml"):
            files[self.args.repo / "app/appx" / name] = '<Identity\r\n Version="3.8.5.0"/><TargetDeviceFamily MinVersion="10.0.0.0"/>\r\n'
        for path, text in files.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(text.encode("utf-8"))

    def test_versions_and_document_update_idempotently(self):
        changes = prepare.plan(self.args)
        self.assertEqual(len(changes), 7)
        prepare.apply(changes)
        self.assertEqual(prepare.plan(self.args), [])
        self.assertIn('Mode = "prod"', prepare.read(self.args.repo / "kernel/util/working.go"))
        self.assertIn('siyuanVersionCode = 399', prepare.read(self.args.android_dir / "build.gradle"))
        self.assertIn('1000097', prepare.read(self.args.harmony_dir / "AppScope/app.json5"))
        self.assertIn('v3.8.6 3.8.6-beta.1 siyuan-3.8.6.apk 3.8.50',
                      prepare.read(self.args.repo / "docs/RELEASE-VERIFICATION.zh-CN.md"))
        for path, _, _ in changes:
            self.assertNotIn(b"\n", path.read_bytes().replace(b"\r\n", b""))

    def test_invalid_field_leaves_all_files_unchanged(self):
        path = self.args.harmony_dir / "AppScope/app.json5"
        path.write_text("{}", encoding="utf-8")
        with self.assertRaises(prepare.PreparationError):
            prepare.plan(self.args)
        self.assertIn('"3.8.5"', prepare.read(self.args.repo / "app/package.json"))

    def test_explicit_codes_and_downgrade_rejection(self):
        self.args.android_code = 450
        prepare.apply(prepare.plan(self.args))
        self.assertIn('450', prepare.read(self.args.android_dir / "build.gradle"))
        self.args.version = "3.8.4"
        with self.assertRaises(prepare.PreparationError):
            prepare.plan(self.args)

    def test_unchanged_code_for_new_version_is_rejected(self):
        self.args.android_code = 398
        with self.assertRaises(prepare.PreparationError):
            prepare.plan(self.args)

    def test_concurrent_edit_is_preserved(self):
        changes = prepare.plan(self.args)
        path = self.args.repo / "app/package.json"
        path.write_text("changed", encoding="utf-8")
        with self.assertRaises(prepare.PreparationError):
            prepare.apply(changes)
        self.assertEqual(path.read_text(), "changed")

    def init_repositories(self):
        for repo in (self.args.repo, self.args.android_dir, self.args.harmony_dir):
            prepare.git(repo, "init", "-b", "main")
            prepare.git(repo, "config", "user.name", "Release Test")
            prepare.git(repo, "config", "user.email", "test@example.invalid")
            prepare.git(repo, "config", "core.autocrlf", "false")
            prepare.git(repo, "config", "commit.gpgsign", "false")
            prepare.git(repo, "config", "tag.gpgsign", "false")
            prepare.git(repo, "add", ".")
            prepare.git(repo, "commit", "-m", "fixture")
            remote = self.root / (repo.name + ".git")
            subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
            prepare.git(repo, "remote", "add", "origin", str(remote))
            prepare.git(repo, "push", "origin", "main")

    def test_publish_and_retry_use_committed_android_version(self):
        self.init_repositories()
        changes = prepare.plan(self.args)
        repositories = prepare.publish_preflight(self.args, changes)
        prepare.apply(changes)
        with contextlib.redirect_stdout(io.StringIO()):
            prepare.publish(self.args, repositories)
            heads = [prepare.git(repo, "rev-parse", "HEAD") for repo, _ in repositories]
            prepare.publish(self.args, prepare.publish_preflight(self.args, prepare.plan(self.args)))
        self.assertEqual(heads, [prepare.git(repo, "rev-parse", "HEAD") for repo, _ in repositories])
        self.assertEqual(prepare.git(self.args.android_dir, "rev-parse", "v3.8.6"), heads[1])
        self.assertIn('"3.8.6"', prepare.git(self.args.android_dir, "show", "v3.8.6:build.gradle"))
        self.assertIn(heads[1], prepare.git(self.args.android_dir, "ls-remote", "origin", "refs/tags/v3.8.6"))

    def test_publish_rejects_untracked_files_before_modification(self):
        self.init_repositories()
        (self.args.android_dir / "untracked.txt").write_text("data")
        with self.assertRaises(prepare.PreparationError):
            prepare.publish_preflight(self.args, prepare.plan(self.args))

    def test_tag_rejects_dirty_version(self):
        self.init_repositories()
        prepare.apply(prepare.plan(self.args))
        with self.assertRaises(prepare.PreparationError):
            prepare.tag_android(self.args)

    def test_publish_rejects_existing_tag_before_version_change(self):
        self.init_repositories()
        prepare.git(self.args.android_dir, "tag", "v3.8.6")
        with self.assertRaises(prepare.PreparationError):
            prepare.publish_preflight(self.args, prepare.plan(self.args))
        self.assertIn('"3.8.5"', prepare.read(self.args.android_dir / "build.gradle"))

    def test_dry_run_does_not_write(self):
        argv = ["prepare-release.py", "3.8.6", "--repo", str(self.args.repo),
                "--android-dir", str(self.args.android_dir), "--harmony-dir", str(self.args.harmony_dir)]
        with patch.object(prepare.sys, "argv", argv), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(prepare.main(), 0)
        self.assertIn('"3.8.5"', prepare.read(self.args.repo / "app/package.json"))


if __name__ == "__main__":
    unittest.main()
