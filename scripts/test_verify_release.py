"""发布包校验回归测试：旧内核、资源遗漏、嵌套载荷与空目录。"""

import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import subprocess
import tarfile
import unittest
from unittest.mock import patch
import zipfile


SPEC = importlib.util.spec_from_file_location("verify_release", Path(__file__).with_name("verify-release.py"))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class SevenZipTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.dest = self.root / "output"
        self.dest.mkdir()
        self.unpacker = release.Unpacker(self.root, release.find_7z() or "7z")

    @unittest.skipUnless(release.find_7z(), "需要已安装的 7-Zip")
    def test_real_sevenzip_skips_links_and_keeps_regular_files(self):
        source = self.root / "links.tar"
        with tarfile.open(source, "w") as archive:
            for name in ("icon.png", "resources/kernel/SiYuan-Kernel"):
                item = tarfile.TarInfo(name)
                item.size = 4
                archive.addfile(item, io.BytesIO(b"data"))
            for name in (".DirIcon", "siyuan.png", "图标链接"):
                item = tarfile.TarInfo(name)
                item.type = tarfile.SYMTYPE
                item.linkname = "icon.png"
                archive.addfile(item)
        self.unpacker.extract_sevenzip(source, self.dest)
        self.assertEqual((self.dest / "icon.png").read_bytes(), b"data")
        self.assertEqual((self.dest / "resources/kernel/SiYuan-Kernel").read_bytes(), b"data")
        for name in (".DirIcon", "siyuan.png", "图标链接"):
            self.assertFalse((self.dest / name).exists())

    def test_squashfs_mode_links_are_excluded_literally(self):
        listing = "----------\nPath = .DirIcon\nMode = lrwxrwxrwx\n\nPath = icon[1]*\nMode = lrwxrwxrwx\n\nPath = file\nMode = -rw-r--r--\n"

        def run(command, **kwargs):
            self.assertEqual(kwargs["encoding"], "utf-8")
            self.assertIn("-sccUTF-8", command)
            if command[1] == "l":
                return subprocess.CompletedProcess(command, 0, listing, "")
            self.assertIn("-spd", command)
            exclusions = next(item[3:] for item in command if item.startswith("-x@"))
            self.assertEqual(Path(exclusions).read_text(encoding="utf-8"), ".DirIcon\nicon[1]*\n")
            return subprocess.CompletedProcess(command, 0, "", "")

        with patch.object(release.subprocess, "run", side_effect=run):
            self.unpacker.extract_sevenzip(self.root / "test.AppImage", self.dest)

    def test_extraction_error_is_not_ignored(self):
        results = [subprocess.CompletedProcess([], 0, "----------\nPath = file\nMode = -rw-r--r--\n", ""),
                   subprocess.CompletedProcess([], 2, "", "CRC failed")]
        with patch.object(release.subprocess, "run", side_effect=results):
            with self.assertRaisesRegex(release.VerificationError, "CRC failed"):
                self.unpacker.extract_sevenzip(self.root / "test.AppImage", self.dest)

    def test_listing_error_stops_extraction(self):
        with patch.object(release.subprocess, "run", return_value=subprocess.CompletedProcess([], 2, "", "bad archive")) as run:
            with self.assertRaisesRegex(release.VerificationError, "bad archive"):
                self.unpacker.extract_sevenzip(self.root / "test.AppImage", self.dest)
            self.assertEqual(run.call_count, 1)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.resources = {
            "stage/build/mobile/index.html": b'<script src="main.js"></script>',
            "stage/build/mobile/main.js": b'Constants.SIYUAN_VERSION="3.8.4";',
            "stage/build/export/protyle-method.js": b'Constants.SIYUAN_VERSION="3.8.4";',
            "appearance/langs/en.json": b"{}",
            "guide/document.sy": b"guide",
            "changelogs/v3.8.4/en.md": b"release notes",
        }
        header = bytearray(64)
        header[:6] = b"\x7fELF\x02\x01"
        release.struct.pack_into("<H", header, 18, 183)
        self.kernel = bytes(header) + b"SiYuan v3.8.4 (pdfcpu "
        self.baseline = {
            "file": "test.release-baseline.json", "target": "android-arm64", "version": "3.8.4",
            "kernels": [release.hashlib.sha256(self.kernel).hexdigest()],
            "resources": {name: release.hashlib.sha256(data).hexdigest()
                          for name, data in self.resources.items()},
        }

    def package(self, kernel=None, resources=None):
        path = self.root / "test.apk"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("lib/arm64-v8a/libgojni.so", self.kernel if kernel is None else kernel)
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w") as assets:
                for name, data in (self.resources if resources is None else resources).items():
                    assets.writestr(name, data)
            archive.writestr("assets/app.zip", buffer.getvalue())
        return path

    def test_nested_android_passes(self):
        result = release.verify_package(self.package(), [self.baseline], None)
        self.assertEqual(result["resource_count"], len(self.resources))

    def test_old_kernel_fails_even_with_current_frontend(self):
        with self.assertRaisesRegex(release.VerificationError, "内核与所有基准均不匹配"):
            release.verify_package(self.package(kernel=self.kernel + b"old build"), [self.baseline], None)

    def test_missing_and_changed_resources_fail(self):
        for name, data in [("stage/build/mobile/main.js", b"old frontend"),
                           ("appearance/langs/en.json", None), ("guide/document.sy", None),
                           ("changelogs/v3.8.4/en.md", None)]:
            with self.subTest(name=name):
                resources = dict(self.resources)
                if data is None:
                    resources.pop(name)
                else:
                    resources[name] = data
                with self.assertRaises(release.VerificationError):
                    release.verify_package(self.package(resources=resources), [self.baseline], None)

    def test_extra_resource_fails(self):
        resources = dict(self.resources, **{"stage/build/mobile/old.js": b"stale"})
        with self.assertRaisesRegex(release.VerificationError, "多余资源"):
            release.verify_package(self.package(resources=resources), [self.baseline], None)

    def test_wrong_abi_kernel_set_fails(self):
        package = self.package()
        with zipfile.ZipFile(package, "a") as archive:
            archive.writestr("lib/x86_64/libgojni.so", b"unexpected kernel")
        with self.assertRaises(release.VerificationError):
            release.verify_package(package, [self.baseline], None)

    def test_android_native_resources_case_collision(self):
        package = self.package()
        with zipfile.ZipFile(package, "a") as archive:
            archive.writestr("res/2f.xml", b"first")
            archive.writestr("res/2F.xml", b"second")
        release.verify_package(package, [self.baseline], None)

    def test_check_continues_after_failed_package(self):
        baseline = self.root / "android.release-baseline.json"
        baseline.write_text(json.dumps(dict(self.baseline, schema=1)), encoding="utf-8")
        self.package(kernel=b"old kernel").rename(self.root / "a-old.apk")
        self.package().rename(self.root / "b-new.apk")
        report = self.root / "result.json"
        args = argparse.Namespace(directory=self.root, version="3.8.4", baseline=[baseline],
                                  report=report, sevenzip=None)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(release.verify(args), 1)
        statuses = [entry["status"] for entry in json.loads(report.read_text(encoding="utf-8"))["packages"]]
        self.assertEqual(statuses, ["FAIL", "PASS"])

    def test_empty_directory_fails(self):
        args = argparse.Namespace(directory=self.root, version="3.8.4", baseline=None, report=None)
        with self.assertRaisesRegex(release.VerificationError, "没有安装包"):
            release.verify(args)

    def test_zip_traversal_fails(self):
        path = self.root / "unsafe.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("../outside", b"bad")
        with self.assertRaises(release.VerificationError):
            release.Unpacker(self.root).extract(path)
        self.assertFalse((self.root.parent / "outside").exists())

    def test_duplicate_zip_member_fails(self):
        path = self.root / "duplicate.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("app/Main.js", b"first")
            archive.writestr("app/main.js", b"second")
        with self.assertRaisesRegex(release.VerificationError, "归档路径重复"):
            release.Unpacker(self.root).extract(path)

    def test_nsis_split_resources_merge(self):
        outer, inner = self.root / "outer", self.root / "inner"
        for name, data in self.resources.items():
            layer = outer if name.startswith("guide/") else inner
            path = layer / "resources" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        (inner / "resources/guide").mkdir()
        actual = release.package_resources([outer, inner], inner / "resources")
        self.assertEqual(actual, self.baseline["resources"])

    def test_baseline_roundtrip(self):
        resources = self.root / "resources"
        for name, data in self.resources.items():
            path = resources / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        kernel = self.root / "libgojni.so"
        kernel.write_bytes(self.kernel)
        output = self.root / "android.release-baseline.json"
        args = argparse.Namespace(resources=resources, version="3.8.4", kernel=kernel,
                                  sevenzip=None, target="android-arm64", output=output)
        with contextlib.redirect_stdout(io.StringIO()):
            release.create_baseline(args)
        baseline = release.load_baselines([output], "3.8.4")
        release.verify_package(self.package(), baseline, None)
        with self.assertRaises(release.VerificationError):
            release.load_baselines([output], "3.8.5")
        with self.assertRaises(FileExistsError):
            release.create_baseline(args)


class DirectReleaseTests(unittest.TestCase):
    package = ReleaseTests.package

    def setUp(self):
        ReleaseTests.setUp(self)
        self.kernel = self.native_kernel("3.8.4")
        self.resources["stage/build/mobile/index.html"] = b'<script src="main.js"></script><link rel="stylesheet" href="base.css">'
        self.resources["stage/build/mobile/main.js"] = b'e.d(exports,{Constants:()=>i});const d="3.8.4",H="production";let i={};i.SIYUAN_VERSION=d,i.NODE_ENV=H;'
        self.resources["stage/build/mobile/base.css"] = b"body{color:black}"
        self.resources["stage/build/export/protyle-method.js"] = self.resources["stage/build/mobile/main.js"]

    @staticmethod
    def native_kernel(version):
        header = bytearray(64)
        header[:6] = b"\x7fELF\x02\x01"
        release.struct.pack_into("<H", header, 18, 183)
        return bytes(header) + f"SiYuan v{version} (pdfcpu ".encode("ascii")

    def test_no_baseline_needed(self):
        result = release.verify_package(self.package(), version="3.8.4")
        self.assertEqual(result["kernels"][0]["version"], "3.8.4")
        self.assertEqual(result["frontend_versions"]["stage/build/mobile/index.html"], ["3.8.4"])

    def test_standalone_hap_is_not_supported(self):
        hap = self.package().rename(self.root / "entry.hap")
        with self.assertRaisesRegex(release.VerificationError, "不支持的安装包格式"):
            release.verify_package(hap, version="3.8.4")
        self.package()
        args = argparse.Namespace(directory=self.root, version="3.8.4", baseline=None,
                                  report=self.root / "report.json", sevenzip=None)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(release.verify(args), 1)
        report = json.loads(args.report.read_text(encoding="utf-8"))
        self.assertEqual(report["unknown"], ["entry.hap"])
        self.assertEqual([entry["name"] for entry in report["packages"]], ["test.apk"])

    def test_harmony_app_unpacks_embedded_hap(self):
        payload = self.package().read_bytes()
        app = self.root / "siyuan-harmony-default-unsigned.app"
        with zipfile.ZipFile(app, "w") as archive:
            archive.writestr("entry.hap", payload)
        result = release.verify_package(app, version="3.8.4")
        self.assertEqual(result["kernels"][0]["version"], "3.8.4")

    def test_ipa_is_not_supported(self):
        ipa = self.package().rename(self.root / "siyuan.ipa")
        with self.assertRaisesRegex(release.VerificationError, "不支持的安装包格式"):
            release.verify_package(ipa, version="3.8.4")
        self.package()
        args = argparse.Namespace(directory=self.root, version="3.8.4", baseline=None,
                                  report=self.root / "report.json", sevenzip=None)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(release.verify(args), 1)
        report = json.loads(args.report.read_text(encoding="utf-8"))
        self.assertEqual(report["unknown"], ["siyuan.ipa"])
        self.assertEqual([entry["name"] for entry in report["packages"]], ["test.apk"])

    def desktop_resources(self):
        resources = dict(self.resources)
        for frontend in ("app", "desktop"):
            for name, data in self.resources.items():
                if name.startswith("stage/build/mobile/"):
                    resources[name.replace("stage/build/mobile/", f"stage/build/{frontend}/")] = data
        resources["stage/build/app/window.html"] = resources["stage/build/app/index.html"]
        resources["app/package.json"] = b'{"version":"3.8.4"}'
        return resources

    def desktop_package(self, resources):
        path = self.root / "siyuan-3.8.4-linux-arm64.zip"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr("resources/kernel/SiYuan-Kernel", self.kernel)
            for name, data in resources.items():
                archive.writestr("resources/" + name, data)
        return path

    def test_complete_desktop_frontends_pass(self):
        result = release.verify_package(self.desktop_package(self.desktop_resources()), version="3.8.4")
        self.assertEqual(len(result["frontend_versions"]), 5)

    def test_desktop_missing_entire_frontend_fails(self):
        for frontend in ("app", "desktop", "mobile", "export"):
            with self.subTest(frontend=frontend):
                resources = {name: data for name, data in self.desktop_resources().items()
                             if not name.startswith(f"stage/build/{frontend}/")}
                with self.assertRaisesRegex(release.VerificationError, f"stage/build/{frontend}/"):
                    release.verify_package(self.desktop_package(resources), version="3.8.4")

    def test_desktop_missing_window_entry_fails(self):
        resources = self.desktop_resources()
        del resources["stage/build/app/window.html"]
        with self.assertRaisesRegex(release.VerificationError, "stage/build/app/window.html"):
            release.verify_package(self.desktop_package(resources), version="3.8.4")

    def test_matching_baseline_cannot_hide_missing_desktop_frontend(self):
        resources = {name: data for name, data in self.desktop_resources().items()
                     if not name.startswith("stage/build/desktop/")}
        baseline = dict(self.baseline, kernels=[release.hashlib.sha256(self.kernel).hexdigest()],
                        resources={name: release.hashlib.sha256(data).hexdigest()
                                   for name, data in resources.items()})
        with self.assertRaisesRegex(release.VerificationError, "stage/build/desktop/index.html"):
            release.verify_package(self.desktop_package(resources), [baseline])

    def test_mobile_missing_entire_frontend_fails(self):
        resources = {name: data for name, data in self.resources.items()
                     if not name.startswith("stage/build/mobile/")}
        with self.assertRaisesRegex(release.VerificationError, "stage/build/mobile/index.html"):
            release.verify_package(self.package(resources=resources), version="3.8.4")

    def matching_baseline(self, resources=None):
        resources = self.resources if resources is None else resources
        return dict(self.baseline, kernels=[release.hashlib.sha256(self.kernel).hexdigest()],
                    resources={name: release.hashlib.sha256(data).hexdigest()
                               for name, data in resources.items() if name.split("/")[0] in release.GROUPS})

    def test_baseline_does_not_bypass_filename_version(self):
        package = self.package().rename(self.root / "siyuan-3.8.3.apk")
        with self.assertRaisesRegex(release.VerificationError, "包名版本不匹配"):
            release.verify_package(package, [self.matching_baseline()], version="3.8.4")

    def test_baseline_does_not_bypass_kernel_version_or_architecture(self):
        for invalid in ("version", "architecture"):
            with self.subTest(invalid=invalid):
                self.kernel = self.native_kernel("3.8.3" if invalid == "version" else "3.8.4")
                if invalid == "architecture":
                    header = bytearray(self.kernel)
                    release.struct.pack_into("<H", header, 18, 62)
                    self.kernel = bytes(header)
                with self.assertRaisesRegex(release.VerificationError, "内核版本不匹配|ABI 目录"):
                    release.verify_package(self.package(), [self.matching_baseline()], version="3.8.4")

    def test_baseline_does_not_bypass_frontend_validation(self):
        original = dict(self.resources)
        for invalid in ("version", "reference"):
            with self.subTest(invalid=invalid):
                self.resources = dict(original)
                if invalid == "version":
                    self.resources["stage/build/mobile/main.js"] = original["stage/build/mobile/main.js"].replace(b"3.8.4", b"3.8.3")
                else:
                    del self.resources["stage/build/mobile/base.css"]
                with self.assertRaisesRegex(release.VerificationError, "前端版本不匹配|资源引用缺失"):
                    release.verify_package(self.package(), [self.matching_baseline()], version="3.8.4")

    def test_desktop_metadata_required_in_both_modes(self):
        for metadata in (None, b'{"version":"3.8.3"}', b'[]'):
            for use_baseline in (False, True):
                with self.subTest(metadata=metadata, baseline=use_baseline):
                    resources = self.desktop_resources()
                    if metadata is None:
                        del resources["app/package.json"]
                    else:
                        resources["app/package.json"] = metadata
                    baseline = [self.matching_baseline(resources)] if use_baseline else None
                    with self.assertRaisesRegex(release.VerificationError, "桌面外壳"):
                        release.verify_package(self.desktop_package(resources), baseline, version="3.8.4")

    def test_complete_desktop_with_baseline_passes(self):
        resources = self.desktop_resources()
        release.verify_package(self.desktop_package(resources), [self.matching_baseline(resources)], version="3.8.4")

    def test_beta_kernel_in_stable_apk(self):
        with self.assertRaisesRegex(release.VerificationError, "3.8.4-beta.2"):
            release.verify_package(self.package(kernel=self.native_kernel("3.8.4-beta.2")), version="3.8.4")

    def test_unrelated_version_string_does_not_pass(self):
        with self.assertRaisesRegex(release.VerificationError, "无法唯一确定内核版本"):
            release.verify_package(self.package(kernel=self.native_kernel("3.8.4").split(b"SiYuan v")[0] + b"v3.8.4"), version="3.8.4")

    def test_conflicting_kernel_markers(self):
        with self.assertRaisesRegex(release.VerificationError, "无法唯一确定内核版本"):
            release.verify_package(self.package(kernel=self.kernel + b"SiYuan v3.8.3 (pdfcpu "), version="3.8.4")

    def test_frontend_version_mismatch(self):
        self.resources["stage/build/mobile/main.js"] = self.resources["stage/build/mobile/main.js"].replace(b"3.8.4", b"3.8.3")
        with self.assertRaisesRegex(release.VerificationError, "前端版本不匹配"):
            release.verify_package(self.package(), version="3.8.4")

    def test_unreferenced_current_bundle_cannot_hide_old_frontend(self):
        self.resources["stage/build/mobile/unused.js"] = self.resources["stage/build/mobile/main.js"]
        self.resources["stage/build/mobile/main.js"] = self.resources["stage/build/mobile/main.js"].replace(b"3.8.4", b"3.8.3")
        with self.assertRaisesRegex(release.VerificationError, "前端版本不匹配"):
            release.verify_package(self.package(), version="3.8.4")

    def test_missing_stylesheet(self):
        del self.resources["stage/build/mobile/base.css"]
        with self.assertRaisesRegex(release.VerificationError, "资源引用缺失"):
            release.verify_package(self.package(), version="3.8.4")

    def test_missing_css_font(self):
        self.resources["stage/build/mobile/base.css"] = b'@font-face{src:url("/appearance/fonts/missing.woff2?v=2")}'
        with self.assertRaisesRegex(release.VerificationError, "样式资源缺失"):
            release.verify_package(self.package(), version="3.8.4")

    def test_missing_lazy_chunk(self):
        self.resources["stage/build/mobile/main.js"] += b'r.u=e=>""+e+"."+{125:"4019a1017e22ca53a1c0"}[e]+".js";'
        with self.assertRaisesRegex(release.VerificationError, "动态分块缺失"):
            release.verify_package(self.package(), version="3.8.4")

    def test_missing_export_frontend(self):
        del self.resources["stage/build/export/protyle-method.js"]
        with self.assertRaisesRegex(release.VerificationError, "缺少导出前端"):
            release.verify_package(self.package(), version="3.8.4")

    def test_kernel_abi_path_mismatch(self):
        header = bytearray(self.kernel)
        release.struct.pack_into("<H", header, 18, 62)
        with self.assertRaisesRegex(release.VerificationError, "ABI 目录"):
            release.verify_package(self.package(kernel=bytes(header)), version="3.8.4")

    def test_automatic_expected_version(self):
        self.package().rename(self.root / "siyuan-3.8.4.apk")
        args = argparse.Namespace(directory=self.root, version=None, baseline=None, report=None, sevenzip=None)
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(release.verify(args), 0)

    def test_mixed_release_filenames_fail(self):
        self.package().rename(self.root / "siyuan-3.8.4-official-release.apk")
        self.package().rename(self.root / "siyuan-3.8.3-cn-release.apk")
        args = argparse.Namespace(directory=self.root, version=None, baseline=None, report=None, sevenzip=None)
        with self.assertRaisesRegex(release.VerificationError, "唯一发布版本"):
            release.verify(args)


if __name__ == "__main__":
    unittest.main()
