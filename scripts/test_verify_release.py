"""发布包校验回归测试：旧内核、资源遗漏、嵌套载荷与空目录。"""

import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile


SPEC = importlib.util.spec_from_file_location("verify_release", Path(__file__).with_name("verify-release.py"))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.resources = {
            "stage/build/mobile/index.html": b"<html></html>",
            "stage/build/mobile/main.js": b"current frontend",
            "appearance/langs/en.json": b"{}",
            "guide/document.sy": b"guide",
            "changelogs/v3.8.4/en.md": b"release notes",
        }
        self.kernel = b"new kernel"
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
            release.verify_package(self.package(kernel=b"old kernel"), [self.baseline], None)

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
