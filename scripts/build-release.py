#!/usr/bin/env python3
"""在 Windows 上编排 Windows、WSL Linux、Android 和鸿蒙发布构建。默认仅显示计划。"""

import argparse
import codecs
from contextlib import contextmanager, nullcontext, redirect_stderr, redirect_stdout
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
ACTIVE_RECORD = None


class BuildError(Exception):
    pass


def timestamp():
    return datetime.now().astimezone().isoformat(timespec="seconds")


class LoggedStream:
    def __init__(self, terminal, record):
        self.terminal, self.record = terminal, record

    def write(self, text):
        self.terminal.write(text)
        self.record.write(text)
        return len(text)

    def flush(self):
        self.terminal.flush()
        self.record.log.flush()

    def __getattr__(self, name):
        return getattr(self.terminal, name)


class BuildRecord:
    def __init__(self, directory, args, version):
        self.directory = Path(directory)
        self.log = None
        self.line_start = True
        self.active_stage = None
        stages = [("preflight", "构建预检")]
        if set(args.platforms) & {"windows", "android", "harmony"}:
            stages.append(("frontend", "前端构建"))
        if set(args.platforms) & {"android", "harmony"}:
            stages.append(("assets", "移动端资源归档"))
        if "windows" in args.platforms:
            stages.extend((("windows_tools", "Windows 资源准备"), ("windows_amd64", "Windows AMD64"),
                           ("windows_arm64", "Windows ARM64")))
        stages.extend((platform, {"linux": "Linux", "android": "Android", "harmony": "鸿蒙"}[platform])
                      for platform in PLATFORMS[1:] if platform in args.platforms)
        self.data = {"schema_version": 1, "version": version, "platforms": args.platforms, "appx": args.appx,
                     "output_directory": str(args.output), "work_directory": None, "status": "pending",
                     "current_stage": None, "stages": [dict(id=key, name=name, status="pending", artifacts=[])
                                                       for key, name in stages]}

    def save(self):
        self.data["updated_at"] = timestamp()
        # 同目录原子替换，查看进度时不会读到写入一半的 JSON。
        path = self.directory / "progress.json.tmp"
        try:
            with path.open("w", encoding="utf-8", newline="\n") as stream:
                json.dump(self.data, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(path, self.directory / "progress.json")
        finally:
            path.unlink(missing_ok=True)

    def write(self, text):
        for part in text.splitlines(keepends=True):
            if self.line_start:
                self.log.write(f"[{timestamp()}] ")
            self.log.write(part)
            self.line_start = part.endswith(("\n", "\r"))
        self.log.flush()

    @contextmanager
    def session(self):
        global ACTIVE_RECORD
        previous = ACTIVE_RECORD
        started = time.monotonic()
        with (self.directory / "build.log").open("x", encoding="utf-8", newline="\n") as self.log:
            with redirect_stdout(LoggedStream(sys.stdout, self)), redirect_stderr(LoggedStream(sys.stderr, self)):
                ACTIVE_RECORD = self
                try:
                    self.data.update(status="running", started_at=timestamp())
                    self.save()
                    print(f"发布记录目录：{self.directory}", flush=True)
                    yield self
                except BaseException as error:
                    status = "interrupted" if isinstance(error, KeyboardInterrupt) else "failed"
                    self.data.update(status=status, error=str(error) or type(error).__name__)
                    self.write(f"\n[FAIL] {self.data['error']}\n")
                    raise
                else:
                    self.data["status"] = "succeeded"
                finally:
                    try:
                        self.data.update(finished_at=timestamp(), elapsed_seconds=round(time.monotonic() - started, 3))
                        self.save()
                        print(f"发布记录已保存：{self.directory}；状态：{self.data['status']}", flush=True)
                    finally:
                        ACTIVE_RECORD = previous

    @contextmanager
    def stage(self, key):
        stage = next(item for item in self.data["stages"] if item["id"] == key)
        started = time.monotonic()
        self.active_stage = stage
        self.data["current_stage"] = key
        stage.update(status="running", started_at=timestamp())
        self.save()
        print(f"开始：{stage['name']}", flush=True)
        try:
            yield
        except BaseException as error:
            stage.update(status="interrupted" if isinstance(error, KeyboardInterrupt) else "failed",
                         error=str(error) or type(error).__name__)
            raise
        else:
            stage["status"] = "succeeded"
        finally:
            stage.update(finished_at=timestamp(), elapsed_seconds=round(time.monotonic() - started, 3))
            self.active_stage = None
            self.data["current_stage"] = None
            self.save()
            print(f"阶段结束：{stage['name']}；状态：{stage['status']}；耗时：{stage['elapsed_seconds']} 秒", flush=True)

    def artifact(self, path):
        if self.active_stage is not None:
            self.active_stage["artifacts"].append(str(path))
            self.save()


def create_record(args, version):
    base = args.records_dir.resolve()
    if not re.fullmatch(VERIFY.VERSION, version):
        raise BuildError(f"无效版本号：{version}")
    parent = (base / version).resolve()
    # 记录不能混入源码、安装包或可清理的临时构建目录。
    for protected in (ROOT, args.android_dir, args.harmony_dir, args.output, Path(tempfile.gettempdir())):
        protected = protected.resolve()
        if (base.is_relative_to(protected) or protected.is_relative_to(base) or
                parent.is_relative_to(protected) or protected.is_relative_to(parent)):
            raise BuildError(f"发布记录目录须与源码、安装包和系统临时目录分开：{base}")
    parent.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix=f"{datetime.now():%Y%m%d-%H%M%S}-", dir=parent))
    return BuildRecord(directory, args, version)


def run(command, cwd, env=None, capture=False, interactive=False):
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
    if ACTIVE_RECORD is not None:
        ACTIVE_RECORD.data["last_command"] = {"arguments": command, "directory": str(cwd),
                                               "started_at": timestamp(), "interactive": interactive}
        ACTIVE_RECORD.save()
        if capture:
            ACTIVE_RECORD.write(f"[{cwd}] {subprocess.list2cmdline(command)}\n")
    if ACTIVE_RECORD is not None and not capture and not interactive:
        # 只采集输出，标准输入仍连接终端；SSH 认证单独保留完整终端交互。
        with subprocess.Popen(invocation, cwd=cwd, env=env, shell=shell,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT) as process:
            decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
            try:
                while chunk := process.stdout.read1(65536):
                    sys.stdout.write(decoder.decode(chunk))
                    sys.stdout.flush()
                sys.stdout.write(decoder.decode(b"", final=True))
                sys.stdout.flush()
                returncode = process.wait()
            except BaseException:
                if process.poll() is None:
                    process.terminate()
                process.wait()
                raise
        output, detail = "", "请查看上方输出或 build.log"
    else:
        result = subprocess.run(invocation, cwd=cwd, env=env, shell=shell, check=False,
                                stdout=subprocess.PIPE if capture else None,
                                stderr=subprocess.PIPE if capture else None,
                                encoding="utf-8", errors="replace")
        returncode = result.returncode
        output = (result.stdout or "").strip() if capture else ""
        detail = (result.stderr or "").strip() if capture else "请查看上方终端输出"
    if ACTIVE_RECORD is not None:
        ACTIVE_RECORD.data["last_command"].update(returncode=returncode, finished_at=timestamp())
        ACTIVE_RECORD.save()
    if returncode:
        raise BuildError(f"命令失败（{returncode}）：{command[0]}；{detail}")
    return output


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
    def __init__(self, args, version, work, record=None):
        self.args, self.version, self.work = args, version, work
        self.record = record
        self.artifacts = []
        self.thumbprint = None
        self.wsl_root = None

    def wsl(self, command, directory=None, capture=False):
        prefix = ["wsl.exe"]
        if self.args.wsl_distro:
            prefix += ["--distribution", self.args.wsl_distro]
        prefix += ["--user", self.args.wsl_user, "--cd", directory or self.args.wsl_repo,
                   "--exec", "bash", "-lc", "exec " + shlex.join([str(item) for item in command])]
        if command[:2] == ["git", "fetch"]:
            return run(prefix, ROOT, capture=capture, interactive=True)
        return run(prefix, ROOT, capture=capture)

    def stage(self, key):
        return self.record.stage(key) if self.record else nullcontext()

    def sync_wsl(self, local_head):
        if self.wsl(["git", "rev-parse", "HEAD"], capture=True) == local_head:
            return
        # 同步只接受干净工作区，避免遗漏 Windows 改动或覆盖 WSL 中的发布现场。
        status = ["git", "status", "--porcelain", "--untracked-files=all"]
        if run(status, ROOT, capture=True) or self.wsl(status, capture=True):
            raise BuildError("自动同步 WSL 前，Windows 和 WSL 工作区必须干净，请先处理未提交和未跟踪文件")
        branch = run(["git", "symbolic-ref", "--quiet", "--short", "HEAD"], ROOT, capture=True)
        self.wsl(["git", "fetch", "--no-tags", "origin", "refs/heads/" + branch])
        # 目标必须已推送且包含 WSL 当前提交；远端后来新增的提交不进入本次构建。
        self.wsl(["git", "merge-base", "--is-ancestor", local_head, "FETCH_HEAD"])
        self.wsl(["git", "merge-base", "--is-ancestor", "HEAD", local_head])
        self.wsl(["git", "switch", "--detach", local_head])
        if self.wsl(["git", "rev-parse", "HEAD"], capture=True) != local_head:
            raise BuildError("WSL 同步后的提交与 Windows 不一致")
        print(f"WSL 已同步到 Windows 提交：{local_head}（分离 HEAD）", flush=True)

    def preflight(self):
        # 先完成需要交互的仓库认证，再检查环境和开始耗时构建。
        if {"linux", "harmony"} & set(self.args.platforms):
            print("先同步 WSL 仓库；如提示 SSH 私钥口令，请现在输入，完成后继续构建预检", flush=True)
            local_head = run(["git", "rev-parse", "HEAD"], ROOT, capture=True)
            self.sync_wsl(local_head)
        source_preflight(self.args, self.version)
        if "windows" in self.args.platforms:
            self.thumbprint = certificate_thumbprint(self.args.certificate_subject, self.args.certificate_sha1)
            print(f"Windows 签名证书：{self.thumbprint}；签名时请按系统提示输入 YubiKey PIN", flush=True)
        if {"linux", "harmony"} & set(self.args.platforms):
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
            if self.record:
                self.record.artifact(target)
            print(f"已收集，待最终校验：{target}", flush=True)

    def windows(self):
        with self.stage("windows_tools"):
            self.windows_tools()
        for arch, config in (("amd64", "electron-builder.yml"), ("arm64", "electron-builder-arm64.yml")):
            with self.stage("windows_" + arch):
                self.windows_arch(arch, config)

    def windows_tools(self):
        run(["go", "install", "github.com/josephspurrier/goversioninfo/cmd/goversioninfo@latest"], ROOT / "kernel")
        go_bin = run(["go", "env", "GOBIN"], ROOT, capture=True)
        if not go_bin:
            go_bin = str(Path(run(["go", "env", "GOPATH"], ROOT, capture=True).split(os.pathsep)[0]) / "bin")
        run([Path(go_bin) / "goversioninfo.exe", "-platform-specific=true", "-icon=resource/icon.ico",
             "-manifest=resource/goversioninfo.exe.manifest"], ROOT / "kernel")

    def windows_arch(self, arch, config):
        output = self.work / "windows"
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
            # 原生模块从公共包含目录读取头文件，使用 ARM64 构建生成的版本。
            if architecture == "arm64":
                for path in sorted(source.parent.glob("*.h")):
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
        print(f"构建完成：本次收集 {len(self.artifacts)} 个安装包到 {self.args.output}；请单独执行安装包校验")
        command = ["python", "-X", "utf8", "scripts/verify-release.py", "check", str(self.args.output),
                   "--version", self.version]
        if self.args.sevenzip:
            command.extend(("--sevenzip", self.args.sevenzip))
        print(subprocess.list2cmdline(command))


def parser():
    result = argparse.ArgumentParser(description=__doc__, epilog="示例：python scripts/build-release.py --platforms windows,linux,android,harmony --execute。执行前停止前端开发构建并完成各仓库版本号准备。不会自动提交、打标签或上传发布。")
    result.add_argument("--platforms", default=",".join(PLATFORMS), help="逗号分隔的平台，可分批构建")
    result.add_argument("--execute", action="store_true", help="实际执行；不传时只显示计划")
    result.add_argument("--appx", action="store_true", help="Windows 额外生成两个 Microsoft Store Appx 包")
    result.add_argument("--output", type=Path, help="安装包收集目录，默认桌面 siyuan；不覆盖已有产物")
    result.add_argument("--records-dir", type=Path, default=ROOT.parent / "release-records",
                        help="持久化发布记录根目录，默认主仓库同级 release-records；每次执行创建独立子目录")
    result.add_argument("--certificate-subject", default="Yunnan Liandi Technology Co., Ltd.", help="Windows 证书主题，可用指纹替代")
    result.add_argument("--certificate-sha1", help="Windows 签名证书的 40 位公开指纹，不是密码")
    result.add_argument("--arm64-cc", type=Path, default=Path("D:/Program Files/llvm-mingw-20240518-ucrt-x86_64/bin/aarch64-w64-mingw32-gcc.exe"))
    result.add_argument("--wsl-distro", help="WSL 发行版名称，默认当前默认发行版")
    result.add_argument("--wsl-user", default="d")
    result.add_argument("--wsl-repo", default="/home/d/88250/siyuan")
    result.add_argument("--android-dir", type=Path, default=ROOT.parent / "siyuan-android")
    result.add_argument("--harmony-dir", type=Path, default=ROOT.parent / "siyuan-harmony")
    result.add_argument("--deveco", type=Path, default=Path("D:/Program Files/Huawei/DevEco Studio"))
    result.add_argument("--sevenzip", help="仅用于完成后提示的手动校验命令，不在构建时调用")
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
    print(f"发布记录根目录：{args.records_dir.resolve()}；实际执行时按版本和时间创建独立目录")
    descriptions = {
        "windows": "构建 AMD64/ARM64 内核 - YubiKey 签名 - 生成两个 NSIS 安装包 - 检查签名",
        "linux": f"WSL 用户 {args.wsl_user}、目录 {args.wsl_repo} - 检查源代码一致 - 双架构构建 TAR/AppImage/DEB/RPM",
        "android": "生成新 kernel.aar - 核对版本和架构 - 自动复制内核及 app.zip - Gradle 四渠道 release 构建",
        "harmony": "WSL 构建两种架构内核并分别复制 - 更新 app.zip - Hvigor release 构建 APP",
    }
    print("本地前端仅构建一次；Linux 前端在 WSL 中构建")
    if {"linux", "harmony"} & set(args.platforms):
        print("构建前自动同步 WSL 到 Windows 当前提交；提交不同时要求两端工作区干净，目标已推送且包含 WSL 当前提交")
    for platform in args.platforms:
        print(f"  {platform}: {descriptions[platform]}")
    print("各平台产物生成后立即复制到收集目录，构建完成后请单独执行安装包校验")
    if not args.execute:
        print("当前仅显示计划，没有执行构建或修改文件；添加 --execute 开始")
        return 0
    if os.name != "nt":
        raise BuildError("此编排脚本需要在 Windows 上执行，Linux 和鸿蒙内核通过 WSL 构建")
    record = create_record(args, version)
    with record.session():
        print(f"版本：{version}；平台：{', '.join(args.platforms)}；收集目录：{args.output}")
        execute_build(args, version, record)
    return 0


def execute_build(args, version, record):
    with record.stage("preflight"):
        with tempfile.TemporaryDirectory(prefix="siyuan-release-preflight-") as temporary:
            probe = Builder(args, version, Path(temporary), record)
            probe.preflight()
    work = Path(tempfile.mkdtemp(prefix=f"siyuan-release-{version}-{datetime.now():%Y%m%d}-"))
    record.data["work_directory"] = str(work)
    record.save()
    builder = Builder(args, version, work, record)
    builder.thumbprint, builder.wsl_root = probe.thumbprint, probe.wsl_root
    print(f"本次构建目录：{work}；失败时保留产物供检查", flush=True)
    if set(args.platforms) & {"windows", "android", "harmony"}:
        with record.stage("frontend"):
            builder.build_ui()
    assets = work / "mobile/app.zip"
    if set(args.platforms) & {"android", "harmony"}:
        with record.stage("assets"):
            create_mobile_assets(assets, version)
    for platform in PLATFORMS:
        if platform in args.platforms:
            method = getattr(builder, platform)
            with record.stage(platform) if platform != "windows" else nullcontext():
                method(assets) if platform in {"android", "harmony"} else method()
    builder.finish()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (BuildError, VERIFY.VerificationError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"[FAIL] {error}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("构建已中断，已开始的发布记录保留供检查", file=sys.stderr)
        sys.exit(130)
