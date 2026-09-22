import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SPEC = importlib.util.spec_from_file_location("clean_release", Path(__file__).with_name("clean-release.py"))
CLEAN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLEAN)


class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.output = self.root / "Desktop/siyuan"
        self.output.mkdir(parents=True)
        (self.output / "release.app").write_bytes(b"signed package")
        self.build = self.root / "repo/app/build"
        self.build.mkdir(parents=True)
        (self.build / "release.app").write_bytes(b"signed package")

    def test_preview_preserves_artifacts(self):
        CLEAN.clean([(self.root, self.build)], [self.output])
        self.assertTrue((self.build / "release.app").exists())

    def test_execute_preserves_desktop(self):
        CLEAN.clean([(self.root, self.build)], [self.output], execute=True)
        self.assertFalse(self.build.exists())
        self.assertEqual((self.output / "release.app").read_bytes(), b"signed package")

    def test_protected_directory_and_ancestors_rejected_before_any_deletion(self):
        for path in (self.output, self.output.parent, self.output / "release.app"):
            with self.subTest(path=path), self.assertRaises(CLEAN.CleanupError):
                CLEAN.clean([(self.root, self.build), (self.root, path)], [self.output], execute=True)
            self.assertTrue(self.build.exists())

    def test_root_and_outside_rejected(self):
        for path in (self.root, self.root.parent):
            with self.subTest(path=path), self.assertRaises(CLEAN.CleanupError):
                CLEAN.clean([(self.root, path)], [], execute=True)

    def test_nested_link_only_removes_link(self):
        link = self.build / "external"
        try:
            link.symlink_to(self.output, target_is_directory=True)
        except OSError:
            if os.name != "nt":
                raise
            import _winapi
            _winapi.CreateJunction(str(self.output), str(link))
        CLEAN.clean([(self.root, self.build)], [self.output], execute=True)
        self.assertFalse(self.build.exists())
        self.assertTrue((self.output / "release.app").exists())

    def test_link_as_cleanup_root_rejected(self):
        link = self.root / "link"
        try:
            link.symlink_to(self.build, target_is_directory=True)
        except OSError:
            if os.name != "nt":
                raise
            import _winapi
            _winapi.CreateJunction(str(self.build), str(link))
        with self.assertRaises(CLEAN.CleanupError):
            CLEAN.clean([(self.root, link)], [self.output], execute=True)
        self.assertTrue(self.build.exists())

    def test_tracked_files_preserved(self):
        repo = self.root / "repo"
        subprocess.run(["git", "init", str(repo)], check=True, capture_output=True)
        marker = repo / "build.gradle"
        marker.touch()
        subprocess.run(["git", "-C", str(repo), "add", "app/build/release.app"], check=True)
        self.assertEqual(CLEAN.repository_targets(repo, "build.gradle", ["app/build"]), [])
        untracked = repo / "app/kernel.aar"
        untracked.write_bytes(b"kernel")
        targets = CLEAN.repository_targets(repo, "build.gradle", ["app/build", "app/kernel.aar"])
        CLEAN.clean(targets, [self.output], execute=True)
        self.assertTrue((self.build / "release.app").exists())
        self.assertFalse(untracked.exists())


if __name__ == "__main__":
    unittest.main()
