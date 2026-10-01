"""OCR 发布资源校验与解包测试，不下载模型或编译内核。"""

import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import struct
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SPEC = importlib.util.spec_from_file_location("prepare_ocr", Path(__file__).with_name("prepare-ocr.py"))
prepare = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare)


def windows_dll(machine=0x8664, imports=None, exports=()):
    """生成只含导入、导出表的 PE 测试夹具，不包含可执行代码。"""
    data = bytearray(16384)
    data[:2] = b"MZ"
    struct.pack_into("<I", data, 0x3c, 0x80)
    data[0x80:0x84] = b"PE\0\0"
    struct.pack_into("<HH", data, 0x84, machine, 1)
    struct.pack_into("<HH", data, 0x94, 240, 0x2000)
    optional = 0x98
    struct.pack_into("<H", data, optional, 0x20b)
    struct.pack_into("<IIII", data, optional + 240 + 8, 15872, 0x1000, 15872, 0x200)
    cursor = 0x400

    def allocate(value):
        nonlocal cursor
        offset = cursor
        data[offset:offset + len(value)] = value
        cursor += (len(value) + 7) // 8 * 8
        return offset, offset + 0xe00

    if exports:
        header, address = allocate(bytes(40))
        struct.pack_into("<II", data, optional + 112, address, 40)
        _, functions = allocate(struct.pack("<" + "I" * len(exports), *([0x1100] * len(exports))))
        names = [allocate(name.encode() + b"\0")[1] for name in exports]
        _, pointers = allocate(struct.pack("<" + "I" * len(names), *names))
        _, ordinals = allocate(struct.pack("<" + "H" * len(names), *range(len(names))))
        struct.pack_into("<IIIIII", data, header + 16, 1, len(names), len(names), functions, pointers, ordinals)
    if imports:
        header, address = allocate(bytes((len(imports) + 1) * 20))
        struct.pack_into("<II", data, optional + 120, address, (len(imports) + 1) * 20)
        for index, (name, symbols) in enumerate(imports.items()):
            _, name_address = allocate(name.encode() + b"\0")
            thunks = [(1 << 63) | symbol if isinstance(symbol, int) else allocate(b"\0\0" + symbol.encode() + b"\0")[1]
                      for symbol in symbols]
            _, lookup = allocate(struct.pack("<" + "Q" * (len(thunks) + 1), *thunks, 0))
            struct.pack_into("<IIIII", data, header + index * 20, lookup, 0, 0, name_address, lookup)
    return bytes(data)


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
        source = self.crt_source()
        native = windows_dll(imports={"MSVCP140.dll": ["cpp"], "VCRUNTIME140_1.dll": ["unwind"]})
        with zipfile.ZipFile(archive, "w") as output:
            for name, content in {"ort/lib/onnxruntime.dll": native, "ort/lib/onnxruntime_providers_shared.dll": windows_dll(), "ort/LICENSE": b"license", "../outside": b"unsafe"}.items():
                output.writestr(name, content)
        with patch.dict(os.environ, {"SIYUAN_OCR_VC_REDIST_DIR": str(source.parent.parent)}):
            self.extract(archive, "windows-amd64", "onnxruntime.dll")
        destination = self.root / "stage/runtime/windows-amd64"
        self.assertEqual((destination / "onnxruntime.dll").read_bytes(), native)
        self.assertEqual((destination / "onnxruntime_providers_shared.dll").read_bytes(), windows_dll())
        self.assertTrue((destination / "MICROSOFT-VC-RUNTIME-NOTICE.txt").is_file())
        hashes = json.loads((destination / "vc-runtime-files.json").read_text())
        self.assertEqual(set(hashes), {"msvcp140.dll", "msvcp140_1.dll", "vcruntime140.dll", "vcruntime140_1.dll"})
        for name, digest in hashes.items():
            self.assertEqual((destination / name).read_bytes(), (source / name).read_bytes())
            self.assertEqual(digest, prepare.digest(source / name))
        self.assertFalse((destination / "unused.dll").exists())
        self.assertFalse((self.root / "outside").exists())

    def crt_source(self, architecture="x64", machine=0x8664, version="14.44.35211"):
        source = self.root / "redist" / version / architecture / "Microsoft.VC143.CRT"
        source.mkdir(parents=True)
        files = {
            "msvcp140.dll": windows_dll(machine, {"VCRUNTIME140.dll": ["runtime"], "MSVCP140_1.dll": ["dot"]}, ["cpp"]),
            "msvcp140_1.dll": windows_dll(machine, exports=["dot"]),
            "vcruntime140.dll": windows_dll(machine, exports=["runtime"]),
            "vcruntime140_1.dll": windows_dll(machine, exports=["unwind"]),
            "unused.dll": b"not a runtime",
        }
        for name, content in files.items():
            (source / name).write_bytes(content)
        return source

    def test_windows_crt_directory_supports_both_architectures_and_versions(self):
        older = self.crt_source(version="14.9.999")
        x64 = self.crt_source(version="14.44.35211")
        arm64 = self.crt_source("arm64", 0xaa64)
        with patch.dict(os.environ, {"SIYUAN_OCR_VC_REDIST_DIR": str(self.root / "redist")}):
            self.assertEqual(prepare.windows_crt_directory("windows-amd64"), x64)
            self.assertEqual(prepare.windows_crt_directory("windows-arm64"), arm64)
        with patch.dict(os.environ, {"SIYUAN_OCR_VC_REDIST_DIR": str(older)}):
            self.assertEqual(prepare.windows_crt_directory("windows-amd64"), older)
            with self.assertRaisesRegex(RuntimeError, "architecture"):
                prepare.windows_crt_directory("windows-arm64")

    def test_windows_crt_vctools_discovery_and_arm64_dependency_closure(self):
        source = self.crt_source("arm64", 0xaa64)
        with patch.dict(os.environ, {"VCToolsRedistDir": str(source.parent.parent)}, clear=True):
            self.assertEqual(prepare.windows_crt_directory("windows-arm64"), source)
        destination = self.root / "arm64-runtime"
        destination.mkdir()
        (destination / "onnxruntime.dll").write_bytes(windows_dll(0xaa64, {"MSVCP140.dll": ["cpp"]}))
        (destination / "msvcp140_2.dll").write_bytes(b"stale generated dependency")
        prepare.prepare_windows_crt("windows-arm64", destination, source)
        self.assertEqual({path.name for path in destination.glob("*.dll")},
                         {"onnxruntime.dll", "msvcp140.dll", "msvcp140_1.dll", "vcruntime140.dll"})
        self.assertFalse((destination / "vcruntime140_1.dll").exists())

    def test_windows_crt_missing_core_file_and_debug_directory_are_rejected(self):
        source = self.crt_source()
        (source / "vcruntime140.dll").unlink()
        with patch.dict(os.environ, {"SIYUAN_OCR_VC_REDIST_DIR": str(source)}):
            with self.assertRaisesRegex(RuntimeError, "Missing x64 Visual C\\+\\+ CRT"):
                prepare.windows_crt_directory("windows-amd64")
        debug = self.root / "debug_nonredist" / source.name
        debug.mkdir(parents=True)
        for name in ("msvcp140.dll", "msvcp140_1.dll", "vcruntime140.dll", "vcruntime140_1.dll"):
            (debug / name).write_bytes(windows_dll())
        with patch.dict(os.environ, {"SIYUAN_OCR_VC_REDIST_DIR": str(debug)}):
            with self.assertRaises(RuntimeError):
                prepare.windows_crt_directory("windows-amd64")

    def test_windows_crt_rejects_missing_transitive_dependency_and_old_exports(self):
        source = self.crt_source()
        destination = self.root / "runtime"
        destination.mkdir()
        (destination / "onnxruntime.dll").write_bytes(windows_dll(imports={"MSVCP140.dll": ["cpp"]}))
        (source / "msvcp140_1.dll").unlink()
        with self.assertRaisesRegex(RuntimeError, "Missing Visual C\\+\\+ dependency msvcp140_1.dll"):
            prepare.prepare_windows_crt("windows-amd64", destination, source)
        self.assertEqual(list(destination.iterdir()), [destination / "onnxruntime.dll"])
        (source / "msvcp140_1.dll").write_bytes(windows_dll(exports=["wrong"]))
        with self.assertRaisesRegex(RuntimeError, "too old"):
            prepare.prepare_windows_crt("windows-amd64", destination, source)

    def test_windows_dll_handles_ordinal_imports_and_rejects_bad_headers(self):
        path = self.root / "test.dll"
        path.write_bytes(windows_dll(imports={"MSVCP140.dll": [1]}, exports=["entry"]))
        library = prepare.WindowsDLL(path, "windows-amd64")
        self.assertEqual(library.imports, {"msvcp140.dll": {1}})
        self.assertEqual(library.exports, {1, "entry"})
        for data in (b"", b"not a PE file", windows_dll()[:200]):
            path.write_bytes(data)
            with self.assertRaises(ValueError):
                prepare.WindowsDLL(path, "windows-amd64")

    def test_windows_dll_rejects_unhandled_delay_imports_and_forwarders(self):
        path = self.root / "unsupported.dll"
        data = bytearray(windows_dll())
        struct.pack_into("<II", data, 0x98 + 112 + 13 * 8, 0x1200, 32)
        path.write_bytes(data)
        with self.assertRaisesRegex(ValueError, "Delay-loaded"):
            prepare.WindowsDLL(path, "windows-amd64")
        data = bytearray(windows_dll(exports=["forwarded"]))
        export_address = struct.unpack_from("<I", data, 0x98 + 112)[0]
        function_table = struct.unpack_from("<I", data, export_address - 0xe00 + 28)[0]
        struct.pack_into("<I", data, function_table - 0xe00, export_address + 1)
        path.write_bytes(data)
        with self.assertRaisesRegex(ValueError, "Forwarded"):
            prepare.WindowsDLL(path, "windows-amd64")

    def test_windows_missing_crt_fails_before_downloading(self):
        with patch.dict(os.environ, {"SIYUAN_OCR_VC_REDIST_DIR": str(self.root / "missing")}), patch.object(prepare, "download") as download:
            with self.assertRaisesRegex(RuntimeError, "licensed Visual Studio"):
                prepare.prepare_runtime("windows-amd64", False)
            download.assert_not_called()

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


class CompilerTests(unittest.TestCase):
    def test_selects_native_and_cross_compilers_without_inheriting_kernel_cc(self):
        for host, target, compiler, triple in (
            ("x86_64", "amd64", "gcc", "x86_64-linux-gnu"),
            ("aarch64", "arm64", "gcc", "aarch64-linux-gnu"),
            ("x86_64", "arm64", "aarch64-linux-gnu-gcc", "aarch64-linux-gnu"),
            ("aarch64", "amd64", "x86_64-linux-gnu-gcc", "x86_64-linux-gnu"),
        ):
            with self.subTest(host=host, target=target), patch.dict(os.environ, {"CC": "wrong-linux-musl-gcc"}, clear=True), \
                    patch.object(prepare.platform, "machine", return_value=host), \
                    patch.object(prepare.platform, "system", return_value="Linux"), \
                    patch.object(prepare.shutil, "which", return_value="/usr/bin/compiler"), \
                    patch.object(prepare.subprocess, "check_output", side_effect=[triple, "#define __GLIBC__ 2\n"]) as probe:
                environment = prepare.linux_worker_environment("linux-" + target)
                self.assertEqual(environment["CC"], compiler)
                self.assertEqual(environment["GOARCH"], target)
                self.assertEqual(environment["CGO_ENABLED"], "1")
                self.assertEqual(probe.call_args_list[0].args, ([compiler, "-dumpmachine"],))
                self.assertEqual(probe.call_count, 2)

    def test_explicit_compiler_supports_paths_with_spaces(self):
        with patch.dict(os.environ, {"SIYUAN_OCR_CC_AMD64": "'/opt/cross tools/gcc'"}, clear=True), \
                patch.object(prepare.platform, "machine", return_value="AMD64"), \
                patch.object(prepare.platform, "system", return_value="Windows"), \
                patch.object(prepare.shutil, "which", return_value="/opt/cross tools/gcc"), \
                patch.object(prepare.subprocess, "check_output", side_effect=["x86_64-linux-gnu", "#define __GLIBC__ 2\n"]) as probe:
            self.assertEqual(prepare.linux_worker_environment("linux-amd64")["CC"], "'/opt/cross tools/gcc'")
            self.assertEqual(probe.call_args_list[0].args, (["/opt/cross tools/gcc", "-dumpmachine"],))

    def test_rejects_musl_wrapper_reporting_a_gnu_target(self):
        with patch.dict(os.environ, {"SIYUAN_OCR_CC_AMD64": "musl-gcc"}, clear=True), \
                patch.object(prepare.shutil, "which", return_value="/usr/bin/musl-gcc"), \
                patch.object(prepare.subprocess, "check_output", side_effect=["x86_64-linux-gnu", "#define _FEATURES_H 1\n"]):
            with self.assertRaisesRegex(RuntimeError, "does not use glibc headers"):
                prepare.linux_worker_environment("linux-amd64")

    def test_rejects_missing_wrong_architecture_and_musl_compilers(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(prepare.shutil, "which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "Missing OCR compiler"):
                prepare.linux_worker_environment("linux-amd64")
        for triple in ("aarch64-linux-gnu", "x86_64-linux-musl", "x86_64-apple-darwin"):
            with self.subTest(triple=triple), patch.dict(os.environ, {}, clear=True), \
                    patch.object(prepare.shutil, "which", return_value="/usr/bin/gcc"), \
                    patch.object(prepare.subprocess, "check_output", return_value=triple):
                with self.assertRaisesRegex(RuntimeError, "requires x86_64-linux-gnu"):
                    prepare.linux_worker_environment("linux-amd64")

    def test_check_only_does_not_download_or_build(self):
        with patch.object(sys, "argv", ["prepare-ocr.py", "--runtime", "linux-arm64", "--build-worker", "--check-only"]), \
                patch.object(prepare, "runtime_prerequisites") as prerequisites, \
                patch.object(prepare, "download") as download, patch.object(prepare, "prepare_runtime") as runtime:
            prepare.main()
            prerequisites.assert_called_once_with("linux-arm64", True)
            download.assert_not_called()
            runtime.assert_not_called()

    def test_linux_missing_compiler_fails_before_downloading(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(prepare.shutil, "which", return_value=None), \
                patch.object(prepare, "download") as download:
            with self.assertRaisesRegex(RuntimeError, "Missing OCR compiler"):
                prepare.prepare_runtime("linux-amd64", True)
            download.assert_not_called()


if __name__ == "__main__":
    unittest.main()
