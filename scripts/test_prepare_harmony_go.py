import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location("harmony_go", Path(__file__).with_name("prepare-harmony-go.py"))
harmony = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(harmony)


class HarmonyGoTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "original-go"
        self.cache = self.root / "cache"
        self.write("bin/go", "executable")
        self.write("VERSION", "go1.26.10\ntime 2026-10-01T00:00:00Z\n")
        self.write(harmony.PATCH_FILES[0], "gerrno, err := C.getnameinfo(sa, salen, b, C.size_t(len(b)), nil, 0, flags)\n")
        self.write(harmony.PATCH_FILES[1], "DATA runtime·tls_g+0(SB)/8, $16\n")
        self.write(harmony.PATCH_FILES[2], "static void\ninittls(void **tlsg, void **tlsbase)\n{\n"
                   "\tif (TLS_SLOT_APP) { pthread_key_create(&k, nil); }\n}\n\n"
                   "void (*x_cgo_inittls)(void **tlsg, void **tlsbase) = inittls;\n")

    def write(self, name, text):
        file = self.source / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text, encoding="utf-8")

    def test_patches_separate_copy_and_preserves_original_toolchain(self):
        original = {name: (self.source / name).read_bytes() for name in harmony.PATCH_FILES}
        target = harmony.prepare(self.source, self.cache)
        self.assertIn("C.socklen_t(len(b))", (target / harmony.PATCH_FILES[0]).read_text(encoding="utf-8"))
        self.assertIn("$-144", (target / harmony.PATCH_FILES[1]).read_text(encoding="utf-8"))
        self.assertIn("\n\treturn;\n}", (target / harmony.PATCH_FILES[2]).read_text(encoding="utf-8"))
        self.assertNotIn("pthread_key_create", (target / harmony.PATCH_FILES[2]).read_text(encoding="utf-8"))
        self.assertEqual(original, {name: (self.source / name).read_bytes() for name in harmony.PATCH_FILES})

    def test_reuses_completed_cache(self):
        target = harmony.prepare(self.source, self.cache)
        with patch.object(harmony.shutil, "copytree", side_effect=AssertionError("must reuse cache")):
            self.assertEqual(target, harmony.prepare(self.source, self.cache))

    def test_toolchain_version_change_uses_another_cache(self):
        target = harmony.prepare(self.source, self.cache)
        self.write("VERSION", "go1.26.11\n")
        self.assertNotEqual(target, harmony.prepare(self.source, self.cache))

    def test_unknown_source_fails_without_publishing_cache(self):
        self.write(harmony.PATCH_FILES[0], "unknown resolver")
        with self.assertRaisesRegex(ValueError, "Unsupported Go source"):
            harmony.prepare(self.source, self.cache)
        self.assertFalse(self.cache.exists())

    def test_interrupted_copy_leaves_no_reusable_or_temporary_cache(self):
        with patch.object(harmony.shutil, "copytree", side_effect=OSError("copy failed")):
            with self.assertRaisesRegex(OSError, "copy failed"):
                harmony.prepare(self.source, self.cache)
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_corrupted_cache_is_rejected_without_repairing_source(self):
        target = harmony.prepare(self.source, self.cache)
        (target / harmony.PATCH_FILES[0]).write_text("corrupt", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Invalid Harmony Go cache"):
            harmony.prepare(self.source, self.cache)

    def test_already_patched_source_remains_supported(self):
        for name, text in harmony.patched_sources(self.source).items():
            self.write(name, text)
        target = harmony.prepare(self.source, self.cache)
        self.assertEqual(harmony.patched_sources(target), harmony.patched_sources(self.source))

    @unittest.skipUnless(os.name == "posix", "Linux shell integration")
    def test_build_wrapper_selects_isolated_toolchain_without_auto_switching(self):
        executable = self.source / "bin/go"
        executable.write_text("#!/bin/sh\nif [ \"$1\" = env ]; then printf '%s\\n' \"$FIXTURE_GOROOT\"; "
                              "else test \"$GOTOOLCHAIN\" = local && printf 'isolated:%s\\n' \"$GOROOT\"; fi\n")
        executable.chmod(0o755)
        working = self.root / "harmony"
        working.mkdir()
        (working / "build.sh").write_bytes(b"set -e\r\ngo version\r\n")
        env = dict(os.environ, PATH=str(self.source / "bin") + os.pathsep + os.environ["PATH"],
                   FIXTURE_GOROOT=str(self.source), XDG_CACHE_HOME=str(self.root / "linux-cache"))
        result = subprocess.run(["bash", str(Path(__file__).with_name("harmony-kernel-build.sh").resolve())],
                                cwd=working, env=env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("isolated:" + str(self.root / "linux-cache/siyuan-harmony/go"), result.stdout)


if __name__ == "__main__":
    unittest.main()
