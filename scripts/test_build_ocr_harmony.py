"""鸿蒙 OCR 构建缓存和源码隔离测试，不编译内核。"""

import argparse
import importlib.util
import io
import struct
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("harmony_ocr", Path(__file__).with_name("build-ocr-harmony.py"))
harmony = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(harmony)


def patch_fixture(source):
    (source / "patched").write_text("adapted", encoding="utf-8")


class GitReader:
    def __init__(self, output):
        self.stdin = io.BytesIO()
        self.stdout = io.BytesIO(output)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.stdout.close()

    def wait(self):
        return 0


class SourceExportTests(unittest.TestCase):
    def test_export_reads_pinned_blobs_and_skips_submodules(self):
        tree = b"100644 blob abc\tcmake/source.txt\0" + b"160000 commit def\tcmake/external/onnx\0"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(harmony.subprocess, "check_output", side_effect=[harmony.REVISION, tree]) as read, \
                    patch.object(harmony.subprocess, "Popen", return_value=GitReader(b"abc blob 6\npinned\n")):
                harmony.export_source(root / "checkout", root / "export")
            self.assertEqual((root / "export/cmake/source.txt").read_text(), "pinned")
            self.assertFalse((root / "export/cmake/external/onnx").exists())
            self.assertEqual(read.call_args_list[1].args[0][5:], harmony.SOURCE_PATHS)

    def test_export_rejects_links_and_traversal(self):
        for tree in (b"120000 blob abc\tcmake/link\0", b"100644 blob abc\t../outside\0"):
            with self.subTest(tree=tree), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with patch.object(harmony.subprocess, "check_output", side_effect=[harmony.REVISION, tree]), \
                        patch.object(harmony.subprocess, "Popen", return_value=GitReader(b"")):
                    with self.assertRaisesRegex(ValueError, "Unsupported"):
                        harmony.export_source(root / "checkout", root / "export")
                self.assertFalse((root / "outside").exists())


class WorkDirectoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.args = argparse.Namespace(source=self.root / "checkout", ndk=self.root / "sdk",
                                       protoc=self.root / "protoc", arch="arm64-v8a")
        self.args.source.mkdir()
        (self.args.source / "original").write_text("upstream", encoding="utf-8")
        self.work = self.root / "work"

    def export_fixture(self, checkout, destination):
        destination.mkdir()
        (destination / "original").write_bytes((checkout / "original").read_bytes())

    def prepare(self):
        with patch.object(harmony, "export_source", side_effect=self.export_fixture), \
                patch.object(harmony, "patch_source", patch_fixture):
            return harmony.prepare_work_directory(self.work, self.args)

    def test_retry_preserves_sources_dependencies_and_build_outputs(self):
        source = self.prepare()
        generated = self.work / "build" / "_deps" / "dependency"
        generated.parent.mkdir(parents=True)
        generated.write_text("downloaded", encoding="utf-8")
        with patch.object(harmony, "export_source", side_effect=AssertionError("must reuse sources")), \
                patch.object(harmony, "patch_source", patch_fixture):
            self.assertEqual(harmony.prepare_work_directory(self.work, self.args), source)
        self.assertEqual(generated.read_text(), "downloaded")
        self.assertFalse((self.args.source / "patched").exists())

    def test_other_architecture_cannot_reuse_build_directory(self):
        self.prepare()
        self.args.arch = "x86_64"
        with self.assertRaisesRegex(ValueError, "configuration changed"):
            self.prepare()
        self.assertEqual((self.work / "source" / "original").read_text(), "upstream")

    def test_existing_unrecognized_directory_is_preserved(self):
        self.work.mkdir()
        original = self.work / "user-file"
        original.write_text("preserve", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Unrecognized or incomplete"):
            self.prepare()
        self.assertEqual(original.read_text(), "preserve")

    def test_failed_patch_cannot_be_reused_as_ready_source(self):
        def failing_patch(source):
            raise RuntimeError("patch failed")

        with patch.object(harmony, "export_source", side_effect=self.export_fixture), \
                patch.object(harmony, "patch_source", failing_patch):
            with self.assertRaisesRegex(RuntimeError, "patch failed"):
                harmony.prepare_work_directory(self.work, self.args)
        self.assertFalse((self.work / "siyuan-ocr-build.json").exists())
        with self.assertRaisesRegex(ValueError, "Unrecognized or incomplete"):
            self.prepare()


class RuntimeValidationTests(unittest.TestCase):
    def test_only_requested_architecture_and_loadable_api_are_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            library = root / "libonnxruntime.so"
            header = bytearray(20)
            header[:6] = b"\x7fELF\x02\x01"
            struct.pack_into("<HH", header, 16, 3, 183)
            library.write_bytes(header)
            symbols = "0x1 (SONAME) Library soname: [libonnxruntime.so]\n1: 100 20 FUNC GLOBAL DEFAULT 12 OrtGetApiBase@@VERS_1.24.3\n"
            with patch.object(harmony.subprocess, "check_output", return_value=symbols):
                harmony.validate_runtime(library, root, "arm64-v8a")
                with self.assertRaisesRegex(ValueError, "64-bit x86_64"):
                    harmony.validate_runtime(library, root, "x86_64")
            with patch.object(harmony.subprocess, "check_output", return_value=symbols.replace("[libonnxruntime.so]", "[libonnxruntime.so.1]")):
                with self.assertRaisesRegex(ValueError, "SONAME"):
                    harmony.validate_runtime(library, root, "arm64-v8a")
            with patch.object(harmony.subprocess, "check_output", return_value=symbols.replace("DEFAULT 12", "DEFAULT UND")):
                with self.assertRaisesRegex(ValueError, "export OrtGetApiBase"):
                    harmony.validate_runtime(library, root, "arm64-v8a")


if __name__ == "__main__":
    unittest.main()
