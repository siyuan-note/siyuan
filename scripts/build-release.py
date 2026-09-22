#!/usr/bin/env python3
"""在 Windows 上编排 Windows、WSL Linux、Android 和鸿蒙发布构建。默认仅显示计划。"""

import argparse
from datetime import datetime
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("verify_release", Path(__file__).with_name("verify-release.py"))
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)
PLATFORMS = ("windows", "linux", "android", "harmony")


class BuildError(Exception):
    pass


def run(command, cwd, env=None, capture=False):
    command = [str(value) for value in command]
    executable = shutil.which(command[0]) or command[0]
    command[0] = executable
    shell = os.name == "nt" and Path(executable).suffix.lower() in {".bat", ".cmd"}
    if shell:
        # 批处理由 cmd 解释，拒绝会被解释为额外命令或变量展开的参数。
        if any(re.search(r'[\r\n"&|<>^%!]', value) for value in command):
            raise BuildError("批处理参数包含不支持的 shell 特殊字符")
        invocation = subprocess.list2cmdline(command)
    else:
        invocation = command
    if not capture:
        print(f"[{cwd}] {subprocess.list2cmdline(command)}", flush=True)
    result = subprocess.run(invocation, cwd=cwd, env=env, shell=shell, check=False,
                            stdout=subprocess.PIPE if capture else None,
                            stderr=subprocess.PIPE if capture else None,
                            encoding="utf-8", errors="replace")
    if result.returncode:
        detail = (result.stderr or "").strip() if capture else "请查看上方输出"
        raise BuildError(f"命令失败（{result.returncode}）：{command[0]}；{detail}")
    return (result.stdout or "").strip() if capture else ""


def powershell(script, values=None):
    env = dict(os.environ, **(values or {}))
    executable = shutil.which("pwsh") or "powershell.exe"
    # 避免从另一版本 PowerShell 继承模块搜索路径而加载不兼容的系统模块。
    env.pop("PSModulePath", None)
    return run([executable, "-NoProfile", "-NonInteractive", "-Command", script], ROOT, env, capture=True)


def certificate_thumbprint(subject, thumbprint=None):
    # 只枚举公开证书信息，不读取私钥，也不尝试验证 PIN。
    script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; " \
             "Import-Module Microsoft.PowerShell.Security; " \
             "$items=@(Get-ChildItem -LiteralPath Cert:\\CurrentUser\\My | " \
             "Where-Object { $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) -and " \
             "$_.NotBefore -lt (Get-Date) -and " \
             "($_.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.3') }); " \
             "$items | Select-Object Subject,Thumbprint | ConvertTo-Json -Compress"
    raw = powershell(script).lstrip("\ufeff")
    values = json.loads(raw) if raw else []
    if isinstance(values, dict):
        values = [values]
    matches = [value for value in values if
               (value["Thumbprint"].upper() == thumbprint.upper() if thumbprint else subject in value["Subject"])]
    if len(matches) != 1:
        raise BuildError("无法唯一选择有效代码签名证书，请插好 YubiKey，并用 --certificate-sha1 指定证书指纹")
    return matches[0]["Thumbprint"]


def verify_signature(path, thumbprint):
    script = "$ErrorActionPreference='Stop'; " \
             "$s=Get-AuthenticodeSignature -LiteralPath $env:SIYUAN_SIGNED_FILE; " \
             "if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Thumbprint -ne $env:SIYUAN_SIGNING_SHA1) " \
             "{ throw ('Signature check failed: '+$s.Status) }"
    powershell(script, {"SIYUAN_SIGNED_FILE": str(path), "SIYUAN_SIGNING_SHA1": thumbprint})


def copy_verified(source, destination, allowed_root):
    source, destination, allowed_root = Path(source), Path(destination), Path(allowed_root).resolve()
    if not destination.resolve().is_relative_to(allowed_root) or destination.resolve() == allowed_root:
        raise BuildError(f"复制目标超出指定目录：{destination}")
    if not source.is_file() or source.stat().st_size == 0:
        raise BuildError(f"构建产物不存在或为空：{source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".siyuan-copy-", delete=False) as stream:
        temporary = Path(stream.name)
    try:
        shutil.copyfile(source, temporary)
        if VERIFY.digest(source) != VERIFY.digest(temporary):
            raise BuildError(f"复制摘要不匹配：{source}")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def check_version(text, expression, expected, label):
    matches = re.findall(expression, text, re.M)
    if matches != [expected]:
        raise BuildError(f"{label} 版本不匹配：{matches}，预期 {expected}；请先完成发布版本准备")


def source_preflight(args, version):
    working = (ROOT / "kernel/util/working.go").read_text(encoding="utf-8")
    check_version(working, r'^const Ver = "([^"]+)"', version, "内核")
    if not re.search(r'^var Mode = "prod"', working, re.M):
        raise BuildError("内核 Mode 必须为 prod")
    if "-" not in version and not (ROOT / "app/changelogs" / f"v{version}").is_dir():
        raise BuildError(f"缺少 v{version} 更新日志")
    if "android" in args.platforms:
        check_version((args.android_dir / "build.gradle").read_text(encoding="utf-8"),
                      r'^\s*siyuanVersionName\s*=\s*"([^"]+)"', version, "Android")
        for relative in ("gradlew.bat", "signings.gradle", "buildRelease.gradle"):
            if not (args.android_dir / relative).is_file():
                raise BuildError(f"Android 工程缺少 {relative}")
    if "harmony" in args.platforms:
        check_version((args.harmony_dir / "AppScope/app.json5").read_text(encoding="utf-8"),
                      r'"versionName"\s*:\s*"([^"]+)"', version, "鸿蒙")
        for relative in ("tools/hvigor/bin/hvigorw.js", "tools/node/node.exe", "tools/ohpm/bin/ohpm.bat"):
            if not (args.deveco / relative).is_file():
                raise BuildError(f"DevEco Studio 缺少 {relative}，请指定 --deveco")
    if "windows" in args.platforms and not args.arm64_cc.is_file():
        raise BuildError("找不到 Windows ARM64 交叉编译器，请指定 --arm64-cc")
    if args.appx and "windows" in args.platforms:
        for filename in ("AppxManifest.xml", "AppxManifest-arm64.xml"):
            check_version((ROOT / "app/appx" / filename).read_text(encoding="utf-8"),
                          r'\bVersion="([^"]+)"', version.split("-")[0] + ".0", filename)
    if not VERIFY.find_7z(args.sevenzip):
        raise BuildError("最终安装包验证需要 7-Zip，请安装或指定 --sevenzip")
    commands = {"git"}
    if set(args.platforms) & {"windows", "android", "harmony"}:
        commands.update(("node", "pnpm"))
    if set(args.platforms) & {"windows", "android"}:
        commands.add("go")
    if "android" in args.platforms:
        commands.add("gomobile")
    if set(args.platforms) & {"linux", "harmony"}:
        commands.add("wsl.exe")
    if args.appx and "windows" in args.platforms:
        commands.add("electron-windows-store")
    for command in sorted(commands):
        if not shutil.which(command):
            raise BuildError(f"找不到构建工具：{command}")


def create_mobile_assets(destination, version):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for group in VERIFY.GROUPS:
            folder = ROOT / "app" / group
            if group == "changelogs":
                if "-" in version:
                    continue
                folder = folder / f"v{version}"
            if not folder.is_dir():
                raise BuildError(f"资源目录不存在：{folder}")
            for path in sorted(folder.rglob("*")):
                relative = path.relative_to(ROOT / "app")
                if path.is_symlink() or not path.is_file() or any(
                        part in {".git", ".idea", ".gitignore", ".DS_Store"} for part in relative.parts):
                    continue
                archive.write(path, relative.as_posix())
        for filename in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
            archive.write(ROOT / filename, filename)


class Builder:
    def __init__(self, args, version, work):
        self.args, self.version, self.work = args, version, work
        self.artifacts = []
        self.thumbprint = None
        self.wsl_root = None

    def wsl(self, command, directory=None, capture=False):
        prefix = ["wsl.exe"]
        if self.args.wsl_distro:
            prefix += ["--distribution", self.args.wsl_distro]
        prefix += ["--user", self.args.wsl_user, "--cd", directory or self.args.wsl_repo,
                   "--exec", "bash", "-lc", "exec " + shlex.join([str(item) for item in command])]
        return run(prefix, ROOT, capture=capture)

    def preflight(self):
        source_preflight(self.args, self.version)
        if "windows" in self.args.platforms:
            self.thumbprint = certificate_thumbprint(self.args.certificate_subject, self.args.certificate_sha1)
            print(f"Windows 签名证书：{self.thumbprint}；签名时请按系统提示输入 YubiKey PIN", flush=True)
        if {"linux", "harmony"} & set(self.args.platforms):
            local_head = run(["git", "rev-parse", "HEAD"], ROOT, capture=True)
            remote_head = self.wsl(["git", "rev-parse", "HEAD"], capture=True)
            if local_head != remote_head:
                raise BuildError("WSL 与 Windows 仓库提交不同；请先同步到同一次发布提交")
            # 只比较构建输入，Windows 平台检出时的换行差异不应改变比较结果。
            for repo_path in ("kernel", "app", "scripts"):
                local_diff = run(["git", "diff", "HEAD", "--", repo_path], ROOT, capture=True)
                remote_diff = self.wsl(["git", "diff", "HEAD", "--", repo_path], capture=True)
                if local_diff.replace("\r\n", "\n") != remote_diff.replace("\r\n", "\n"):
                    raise BuildError(f"WSL 与 Windows 的未提交构建输入不同：{repo_path}")
            command = ["git", "ls-files", "--others", "--exclude-standard", "--", "kernel", "app"]
            if run(command, ROOT, capture=True) or self.wsl(command, capture=True):
                raise BuildError("Windows 或 WSL 存在未跟踪的内核/前端文件，请先纳入同一次发布提交")
            self.wsl_root = Path(self.wsl(["wslpath", "-w", self.args.wsl_repo], capture=True))
            check_version((self.wsl_root / "kernel/util/working.go").read_text(encoding="utf-8"),
                          r'^const Ver = "([^"]+)"', self.version, "WSL 内核")

    def build_ui(self):
        run(["pnpm", "install", "--frozen-lockfile"], ROOT / "app")
        run(["pnpm", "run", "install:electron"], ROOT / "app")
        run(["pnpm", "run", "build"], ROOT / "app")

    def collect(self, paths, label, started, names=None):
        paths = sorted(paths)
        if not paths:
            raise BuildError(f"{label} 没有产出安装包")
        for path in paths:
            if not path.is_file() or path.stat().st_size == 0 or path.stat().st_mtime < started - 2:
                raise BuildError(f"{label} 产物不是本次构建生成的有效文件：{path}")
            name = (names or {}).get(path.name, path.name)
            target = self.args.output / name
            if target.exists():
                raise BuildError(f"输出目录已有同名文件，未覆盖：{target}")
            copy_verified(path, target, self.args.output)
            self.artifacts.append(target)
            print(f"已收集，待最终校验：{target}", flush=True)

    def windows(self):
        run(["go", "install", "github.com/josephspurrier/goversioninfo/cmd/goversioninfo@latest"], ROOT / "kernel")
        go_bin = run(["go", "env", "GOBIN"], ROOT, capture=True)
        if not go_bin:
            go_bin = str(Path(run(["go", "env", "GOPATH"], ROOT, capture=True).split(os.pathsep)[0]) / "bin")
        run([Path(go_bin) / "goversioninfo.exe", "-platform-specific=true", "-icon=resource/icon.ico",
             "-manifest=resource/goversioninfo.exe.manifest"], ROOT / "kernel")
        output = self.work / "windows"
        for arch, config in (("amd64", "electron-builder.yml"), ("arm64", "electron-builder-arm64.yml")):
            started = time.time()
            env = dict(os.environ, GOOS="windows", GOARCH=arch, CGO_ENABLED="1")
            if arch == "arm64":
                env["CC"] = '"' + str(self.args.arm64_cc) + '"'
            kernel = self.work / "kernels" / arch / "SiYuan-Kernel.exe"
            kernel.parent.mkdir(parents=True, exist_ok=True)
            run(["go", "build", "-tags", "fts5 sqlcipher", "-ldflags=-s -w", "-o", kernel, "."], ROOT / "kernel", env)
            self.check_kernel(kernel, arch)
            copy_verified(ROOT / "app/elevator" / f"elevator-{arch}.exe", kernel.parent / "elevator.exe", self.work)
            generated_config = self.work / f"windows-{arch}.json"
            run(["node", ROOT / "scripts/release-windows-config.cjs", ROOT / "app" / config,
                 kernel.parent, output, self.thumbprint, generated_config], ROOT / "app")
            signing_env = dict(os.environ)
            for key in ("CSC_LINK", "CSC_KEY_PASSWORD", "WIN_CSC_LINK", "WIN_CSC_KEY_PASSWORD"):
                signing_env.pop(key, None)
            run(["pnpm", "exec", "electron-builder", "--config", generated_config, "--win",
                 "--arm64" if arch == "arm64" else "--x64", "--publish=never"], ROOT / "app", signing_env)
            suffix = "-arm64" if arch == "arm64" else ""
            installer = output / f"siyuan-{self.version}-win{suffix}.exe"
            verify_signature(installer, self.thumbprint)
            self.collect([installer], "Windows", started)
            if self.args.appx:
                unpacked = output / ("win-arm64-unpacked" if arch == "arm64" else "win-unpacked")
                (unpacked / "resources/ms-store").touch()
                appx_output = self.work / "appx" / arch
                appx_output.mkdir(parents=True)
                run(["electron-windows-store", "--input-directory", unpacked, "--output-directory", appx_output,
                     "--package-version", self.version.split("-")[0] + ".0", "--package-name", "SiYuan" + suffix,
                     "--manifest", ROOT / "app/appx" / ("AppxManifest-arm64.xml" if arch == "arm64" else "AppxManifest.xml"),
                     "--assets", ROOT / "app/appx/assets", "--make-pri", "true"], ROOT)
                self.collect(appx_output.glob("*.appx"), "Windows Appx", started)

    def linux(self):
        started = time.time()
        self.wsl(["bash", "scripts/linux-build.sh", "--target=all"])
        folder = self.wsl_root / "app/build"
        expected = [folder / f"siyuan-{self.version}-linux{arch}.{extension}"
                    for arch in ("", "-arm64") for extension in ("tar.gz", "AppImage", "deb", "rpm")]
        self.collect(expected, "Linux", started)

    def check_kernel(self, path, architecture):
        info = VERIFY.kernel_info(path)
        if info["version"] != self.version or info["architecture"] != architecture:
            raise BuildError(f"新构建内核的版本或架构不匹配：{path}，{info['version']}，{info['architecture']}")

    def android(self, assets):
        env = dict(os.environ)
        for key in ("GOOS", "GOARCH", "CC", "CXX"):
            env.pop(key, None)
        env["JAVA_TOOL_OPTIONS"] = (env.get("JAVA_TOOL_OPTIONS", "") + " -Dfile.encoding=UTF-8").strip()
        env["CGO_ENABLED"] = "1"
        sdk = env.get("ANDROID_HOME") or env.get("ANDROID_SDK_ROOT")
        properties = self.args.android_dir / "local.properties"
        if not sdk and properties.is_file():
            match = re.search(r"^sdk.dir=(.+)$", properties.read_text(encoding="utf-8"), re.M)
            if match:
                sdk = match[1].strip().replace("\\:", ":").replace("\\\\", "\\")
        if not sdk or not Path(sdk).is_dir():
            raise BuildError("找不到 Android SDK，请设置 ANDROID_HOME 或 Android 工程的 local.properties")
        env["ANDROID_HOME"] = sdk
        if not env.get("ANDROID_NDK_HOME"):
            ndks = [path for path in (Path(sdk) / "ndk").glob("*") if path.is_dir() and re.fullmatch(r"[0-9.]+", path.name)]
            if not ndks:
                raise BuildError("找不到 Android NDK，请设置 ANDROID_NDK_HOME")
            env["ANDROID_NDK_HOME"] = str(max(ndks, key=lambda path: tuple(int(v) for v in path.name.split("."))))
        aar = self.work / "android/kernel.aar"
        aar.parent.mkdir(parents=True, exist_ok=True)
        run(["gomobile", "bind", "-tags", "fts5 sqlcipher", "-ldflags=-s -w", "-v", "-o", aar,
             "-target=android/arm64", "-androidapi", "26", "./mobile/"], ROOT / "kernel", env)
        with tempfile.TemporaryDirectory(prefix="siyuan-aar-check-") as temporary:
            layers = VERIFY.Unpacker(Path(temporary)).layers(aar)
            kernels = VERIFY.kernel_files(layers)
            if len(kernels) != 1:
                raise BuildError("Android AAR 应包含一个 ARM64 内核")
            self.check_kernel(kernels[0], "arm64")
        copy_verified(aar, self.args.android_dir / "app/libs/kernel.aar", self.args.android_dir)
        copy_verified(assets, self.args.android_dir / "app/src/main/assets/app.zip", self.args.android_dir)
        started = time.time()
        run([self.args.android_dir / "gradlew.bat", "clean", "buildReleaseTask", "--no-daemon"], self.args.android_dir, env)
        folder = self.args.android_dir / "app/build-release" / f"siyuan-{self.version}-all"
        packages = [path for path in folder.glob("*") if path.suffix in {".apk", ".aab"}]
        if len(packages) != 4:
            raise BuildError(f"Android 应产出四个渠道包，实际 {len(packages)} 个：{folder}")
        official_name = f"siyuan-{self.version}.apk"
        official = [path for path in packages if path.name in {
            official_name, f"siyuan-{self.version}-official.apk", f"siyuan-{self.version}-official-release.apk",
        }]
        if len(official) != 1:
            raise BuildError(f"无法唯一确定 Android 官方版 APK：{folder}")
        self.collect(packages, "Android", started, {official[0].name: official_name})

    def harmony(self, assets):
        directory = self.args.wsl_repo.rstrip("/") + "/kernel/harmony"
        for script, abi, architecture in (("build.sh", "arm64-v8a", "arm64"), ("build-win.sh", "x86_64", "amd64")):
            started = time.time()
            self.wsl(["bash", "-e", script], directory)
            source = self.wsl_root / "kernel/harmony/libkernel.so"
            if source.stat().st_mtime < started - 2:
                raise BuildError(f"鸿蒙内核未更新：{source}")
            self.check_kernel(source, architecture)
            # 两个脚本写同一个文件名，必须在下一次构建前分别复制。
            copy_verified(source, self.args.harmony_dir / "entry/libs" / abi / "libkernel.so", self.args.harmony_dir)
            header = source.with_suffix(".h")
            if not header.is_file() or header.stat().st_mtime < started - 2:
                raise BuildError(f"鸿蒙内核头文件未更新：{header}")
            # 各架构保存配套头文件，正式版原生模块使用 ARM64 的公共头文件。
            headers = sorted(source.parent.glob("*.h"))
            for path in headers:
                copy_verified(path, self.args.harmony_dir / "entry/libs" / abi / path.name, self.args.harmony_dir)
                if architecture == "arm64":
                    copy_verified(path, self.args.harmony_dir / "entry/src/main/cpp/include" / path.name,
                                  self.args.harmony_dir)
        for name in ("libkernel.h", "lan_sync_bridge.h"):
            header = self.args.harmony_dir / "entry/src/main/cpp/include" / name
            if not header.is_file() or header.stat().st_size == 0:
                raise BuildError(f"鸿蒙工程缺少头文件：{header}")
        copy_verified(assets, self.args.harmony_dir / "entry/src/main/resources/rawfile/app.zip", self.args.harmony_dir)
        env = dict(os.environ)
        env["DEVECO_SDK_HOME"] = str(self.args.deveco / "sdk")
        env["JAVA_HOME"] = str(self.args.deveco / "jbr")
        env["PATH"] = str(self.args.deveco / "tools/node") + os.pathsep + env.get("PATH", "")
        run([self.args.deveco / "tools/ohpm/bin/ohpm.bat", "install", "--all"], self.args.harmony_dir, env)
        command = [self.args.deveco / "tools/node/node.exe", self.args.deveco / "tools/hvigor/bin/hvigorw.js",
                   "--mode", "project", "-p", "product=default", "-p", "buildMode=release", "--no-daemon"]
        run(command + ["clean"], self.args.harmony_dir, env)
        started = time.time()
        run(command + ["assembleApp"], self.args.harmony_dir, env)
        app = self.args.harmony_dir / "build/outputs/default/siyuan-harmony-default-signed.app"
        self.collect([app], "鸿蒙", started)

    def finish(self):
        args = argparse.Namespace(directory=self.args.output, version=self.version, baseline=None,
                                  report=None, sevenzip=self.args.sevenzip)
        if VERIFY.verify(args):
            raise BuildError(f"安装包校验未通过，已收集的产物保留在 {self.args.output}")
        print(f"完成：本次收集 {len(self.artifacts)} 个安装包，{self.args.output} 中的安装包已全部校验")


def parser():
    result = argparse.ArgumentParser(description=__doc__, epilog="示例：python scripts/build-release.py --platforms windows,linux,android,harmony --execute。执行前停止前端开发构建并完成各仓库版本号准备。不会自动提交、打标签或上传发布。")
    result.add_argument("--platforms", default=",".join(PLATFORMS), help="逗号分隔的平台，可分批构建")
    result.add_argument("--execute", action="store_true", help="实际执行；不传时只显示计划")
    result.add_argument("--appx", action="store_true", help="Windows 额外生成两个 Microsoft Store Appx 包")
    result.add_argument("--output", type=Path, help="安装包收集目录，默认桌面 siyuan；不覆盖已有产物")
    result.add_argument("--certificate-subject", default="Yunnan Liandi Technology Co., Ltd.", help="Windows 证书主题，可用指纹替代")
    result.add_argument("--certificate-sha1", help="Windows 签名证书的 40 位公开指纹，不是密码")
    result.add_argument("--arm64-cc", type=Path, default=Path("D:/Program Files/llvm-mingw-20240518-ucrt-x86_64/bin/aarch64-w64-mingw32-gcc.exe"))
    result.add_argument("--wsl-distro", help="WSL 发行版名称，默认当前默认发行版")
    result.add_argument("--wsl-user", default="d")
    result.add_argument("--wsl-repo", default="/home/d/88250/siyuan")
    result.add_argument("--android-dir", type=Path, default=ROOT.parent / "siyuan-android")
    result.add_argument("--harmony-dir", type=Path, default=ROOT.parent / "siyuan-harmony")
    result.add_argument("--deveco", type=Path, default=Path("D:/Program Files/Huawei/DevEco Studio"))
    result.add_argument("--sevenzip", help="安装包校验使用的 7-Zip 可执行文件")
    return result


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    args = parser().parse_args()
    args.platforms = list(dict.fromkeys(args.platforms.split(",")))
    if not args.platforms or set(args.platforms) - set(PLATFORMS):
        raise BuildError(f"平台只能是：{', '.join(PLATFORMS)}")
    if args.certificate_sha1 and not re.fullmatch(r"[0-9a-fA-F]{40}", args.certificate_sha1):
        raise BuildError("证书指纹必须为 40 位十六进制字符串")
    version = json.loads((ROOT / "app/package.json").read_text(encoding="utf-8"))["version"]
    args.output = (args.output or VERIFY.desktop_folder()).resolve()
    for name in ("android_dir", "harmony_dir", "deveco", "arm64_cc"):
        setattr(args, name, getattr(args, name).resolve())
    print(f"版本：{version}\n平台：{', '.join(args.platforms)}\n收集目录：{args.output}")
    descriptions = {
        "windows": "构建 AMD64/ARM64 内核 - YubiKey 签名 - 生成两个 NSIS 安装包 - 检查签名",
        "linux": f"WSL 用户 {args.wsl_user}、目录 {args.wsl_repo} - 检查源代码一致 - 双架构构建 TAR/AppImage/DEB/RPM",
        "android": "生成新 kernel.aar - 核对版本和架构 - 自动复制内核及 app.zip - Gradle 四渠道 release 构建",
        "harmony": "WSL 构建两种架构内核并分别复制 - 更新 app.zip - Hvigor release 构建 APP",
    }
    print("本地前端仅构建一次；Linux 前端在 WSL 中构建")
    for platform in args.platforms:
        print(f"  {platform}: {descriptions[platform]}")
    print("各平台产物生成后立即复制到收集目录，最后统一校验该目录中的安装包")
    if not args.execute:
        print("当前仅显示计划，没有执行构建或修改文件；添加 --execute 开始")
        return 0
    if os.name != "nt":
        raise BuildError("此编排脚本需要在 Windows 上执行，Linux 和鸿蒙内核通过 WSL 构建")
    with tempfile.TemporaryDirectory(prefix="siyuan-release-preflight-") as temporary:
        probe = Builder(args, version, Path(temporary))
        probe.preflight()
    work = Path(tempfile.mkdtemp(prefix=f"siyuan-release-{version}-{datetime.now():%Y%m%d}-"))
    builder = Builder(args, version, work)
    builder.thumbprint, builder.wsl_root = probe.thumbprint, probe.wsl_root
    print(f"本次构建目录：{work}；失败时保留产物供检查", flush=True)
    if set(args.platforms) & {"windows", "android", "harmony"}:
        builder.build_ui()
    assets = work / "mobile/app.zip"
    if set(args.platforms) & {"android", "harmony"}:
        create_mobile_assets(assets, version)
    for platform in PLATFORMS:
        if platform in args.platforms:
            method = getattr(builder, platform)
            method(assets) if platform in {"android", "harmony"} else method()
    builder.finish()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (BuildError, VERIFY.VerificationError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"[FAIL] {error}", file=sys.stderr)
        sys.exit(1)
