"""OCR 发布资源校验与解包测试，不下载模型或编译内核。"""

import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location("prepare_ocr", Path(__file__).with_name("prepare-ocr.py"))
prepare = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare)


class ResourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def entry(self, file):
        return {"url": file.as_uri(), "sha256": hashlib.sha256(file.read_bytes()).hexdigest(), "size": file.stat().st_size}

    def test_checksum_failure_preserves_previous_resource(self):
        source = self.root / "source"
        source.write_bytes(b"invalid replacement")
        destination = self.root / "model"
        destination.write_bytes(b"previous model")
        entry = self.entry(source)
        entry["sha256"] = "0" * 64
        with patch.object(prepare.time, "sleep"):
            with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
                prepare.download(entry, destination)
        self.assertEqual(destination.read_bytes(), b"previous model")
        self.assertEqual(list(self.root.glob("*.tmp")), [])

    def test_windows_runtime_copies_only_libraries_and_licenses(self):
        archive = self.root / "runtime.zip"
        with zipfile.ZipFile(archive, "w") as output:
            for name, content in {"ort/lib/onnxruntime.dll": b"native", "ort/lib/onnxruntime_providers_shared.dll": b"provider", "ort/LICENSE": b"license", "../outside": b"unsafe"}.items():
                output.writestr(name, content)
        self.extract(archive, "windows-amd64", "onnxruntime.dll")
        destination = self.root / "stage/runtime/windows-amd64"
        self.assertEqual((destination / "onnxruntime.dll").read_bytes(), b"native")
        self.assertEqual((destination / "onnxruntime_providers_shared.dll").read_bytes(), b"provider")
        self.assertFalse((self.root / "outside").exists())

    def test_linux_runtime_selects_regular_library_without_symlinks(self):
        archive = self.root / "runtime.tgz"
        with tarfile.open(archive, "w:gz") as output:
            link = tarfile.TarInfo("ort/lib/libonnxruntime.so")
            link.type, link.linkname = tarfile.SYMTYPE, "libonnxruntime.so.1.24.3"
            output.addfile(link)
            content = b"native"
            library = tarfile.TarInfo("ort/lib/libonnxruntime.so.1.24.3")
            library.size = len(content)
            output.addfile(library, io.BytesIO(content))
        self.extract(archive, "linux-amd64", "libonnxruntime.so")
        self.assertEqual((self.root / "stage/runtime/linux-amd64/libonnxruntime.so").read_bytes(), b"native")

    def extract(self, archive, target, library):
        entry = self.entry(archive)
        entry["library"] = library
        with patch.object(prepare, "STAGE", self.root / "stage"), patch.object(prepare, "MANIFEST", {"runtime": {target: entry}}), patch.object(prepare.tempfile, "gettempdir", return_value=str(self.root / "cache")):
            prepare.prepare_runtime(target, False)


if __name__ == "__main__":
    unittest.main()
