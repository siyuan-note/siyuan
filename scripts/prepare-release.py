#!/usr/bin/env python3
"""准备正式版版本字段，或在 Android 版本提交后创建本地标签。默认只显示计划。"""

import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
VERSION = r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)"


class PreparationError(Exception):
    pass


def read(path):
    return path.read_bytes().decode("utf-8")


def field(text, pattern, label):
    matches = list(re.finditer(pattern, text, re.M))
    if len(matches) != 1:
        raise PreparationError(f"{label} 必须有且仅有一个可识别的字段")
    return matches[0]


def replace(text, pattern, value, label):
    match = field(text, pattern, label)
    return text[:match.start(1)] + str(value) + text[match.end(1):]


def version_key(value):
    match = re.fullmatch(f"({VERSION})(?:-[0-9A-Za-z.-]+)?", value)
    if not match:
        raise PreparationError(f"无法识别当前版本：{value}")
    return tuple(int(part) for part in match[1].split("."))


ANDROID_NAME = r'^\s*siyuanVersionName\s*=\s*"([^"]+)"'
ANDROID_CODE = r'^\s*siyuanVersionCode\s*=\s*([0-9]+)\b'
HARMONY_NAME = r'"versionName"\s*:\s*"([^"]+)"'
HARMONY_CODE = r'"versionCode"\s*:\s*([0-9]+)\b'


def mobile_version(text, name_pattern, code_pattern, version, explicit_code, label):
    current = field(text, name_pattern, label)[1]
    code = int(field(text, code_pattern, label)[1])
    if version_key(version) < version_key(current):
        raise PreparationError(f"{label} 不允许降级：{current} -> {version}")
    target_code = explicit_code if explicit_code is not None else code + (current != version)
    if target_code < code or (current != version and target_code == code):
        raise PreparationError(f"{label} 新版本的版本代码必须递增，同版本不可降低版本代码")
    text = replace(text, name_pattern, version, label)
    return replace(text, code_pattern, target_code, label)


def plan(args):
    changes = []

    def edit(path, transform):
        original = read(path)
        updated = transform(original)
        if original != updated:
            changes.append((path, original, updated))

    package = args.repo / "app/package.json"
    current = json.loads(read(package))["version"]
    if version_key(args.version) < version_key(current):
        raise PreparationError(f"不允许降级：{current} -> {args.version}")
    edit(package, lambda text: replace(text, r'"version"\s*:\s*"([^"]+)"', args.version, "package.json"))
    edit(args.repo / "kernel/util/working.go", lambda text: replace(
        replace(text, r'^var Mode = "([^"]+)"', "prod", "Mode"),
        r'^const Ver = "([^"]+)"', args.version, "Ver"))
    for filename in ("AppxManifest.xml", "AppxManifest-arm64.xml"):
        edit(args.repo / "app/appx" / filename, lambda text: replace(
            text, r'<Identity\b[^>]*\bVersion="([^"]+)"', args.version + ".0", "Appx Identity"))
    edit(args.android_dir / "build.gradle", lambda text: mobile_version(
        text, ANDROID_NAME, ANDROID_CODE, args.version, args.android_code, "Android"))
    edit(args.harmony_dir / "AppScope/app.json5", lambda text: mobile_version(
        text, HARMONY_NAME, HARMONY_CODE, args.version, args.harmony_code, "鸿蒙"))

    def document(text):
        # 只替换完整版本号，保留预发布示例后缀，不误改其他版本或路径数字。
        marker = r'<!-- release-version: (' + VERSION + r') -->'
        old = field(text, marker, "文档发布版本标记")[1]
        return re.sub(r'(?<![\d.])' + re.escape(old) + r'(?!\d|\.\d)', args.version, text)

    edit(args.repo / "docs/RELEASE-VERIFICATION.zh-CN.md", document)
    return changes


def apply(changes):
    # 全部字段校验完成后再写入，并确认预览以来文件没有被其他程序修改。
    for path, original, _ in changes:
        if read(path) != original:
            raise PreparationError(f"文件已被其他程序修改：{path}")
    written = []
    try:
        for path, original, updated in changes:
            written.append((path, original))
            path.write_bytes(updated.encode("utf-8"))
    except OSError:
        for path, original in reversed(written):
            path.write_bytes(original.encode("utf-8"))
        raise


def git(repo, *arguments):
    result = subprocess.run(["git", "-C", str(repo), *arguments], capture_output=True,
                            encoding="utf-8", errors="replace")
    if result.returncode:
        raise PreparationError(result.stderr.strip() or "Git 命令失败")
    return result.stdout.strip()


def tag_android(args):
    repo = args.android_dir
    if git(repo, "status", "--porcelain"):
        raise PreparationError("Android 仓库有未提交文件，请先提交版本改动，再创建标签")
    committed = git(repo, "show", "HEAD:build.gradle")
    if field(committed, ANDROID_NAME, "Android")[1] != args.version:
        raise PreparationError("Android HEAD 中的版本与目标版本不一致")
    head = git(repo, "rev-parse", "HEAD")
    tag = "v" + args.version
    if git(repo, "tag", "--list", tag):
        if git(repo, "rev-parse", tag + "^{commit}") != head:
            raise PreparationError(f"标签 {tag} 已指向其他提交，不会覆盖")
        print(f"Android 标签 {tag} 已指向当前提交，无需修改")
        return
    print(f"Android 本地标签：{tag}，提交：{head}")
    if args.execute:
        git(repo, "tag", tag, head)
        print("标签已创建；请自行核对并推送")


def publish_preflight(args, changes):
    repositories = []
    if len({repo.resolve() for repo in (args.repo, args.android_dir, args.harmony_dir)}) != 3:
        raise PreparationError("主仓库、Android 和鸿蒙必须是三个独立仓库")
    for repo in (args.repo, args.android_dir, args.harmony_dir):
        if Path(git(repo, "rev-parse", "--show-toplevel")).resolve() != repo.resolve():
            raise PreparationError(f"必须指定仓库根目录：{repo}")
        branch = git(repo, "symbolic-ref", "--quiet", "--short", "HEAD")
        if git(repo, "ls-files", "--others", "--exclude-standard"):
            raise PreparationError(f"存在未跟踪文件，请先确认并纳入版本管理：{repo}")
        if git(repo, "ls-files", "--unmerged"):
            raise PreparationError(f"存在未解决冲突：{repo}")
        remote = git(repo, "ls-remote", "origin", "refs/heads/" + branch)
        if remote:
            git(repo, "merge-base", "--is-ancestor", remote.split()[0], "HEAD")
        repositories.append((repo, branch))
    tag = "v" + args.version
    local_tag = git(args.android_dir, "tag", "--list", tag)
    remote_tag = git(args.android_dir, "ls-remote", "origin", "refs/tags/" + tag)
    if local_tag:
        if git(args.android_dir, "status", "--porcelain") or any(
                path == args.android_dir / "build.gradle" for path, _, _ in changes):
            raise PreparationError(f"Android 标签 {tag} 已存在，不能再提交不同内容")
        if git(args.android_dir, "rev-parse", tag + "^{commit}") != git(args.android_dir, "rev-parse", "HEAD"):
            raise PreparationError(f"Android 标签 {tag} 已指向其他提交")
    if remote_tag and (not local_tag or remote_tag.split()[0] != git(args.android_dir, "rev-parse", "refs/tags/" + tag)):
        raise PreparationError(f"远端 Android 标签 {tag} 已存在且与本地不一致")
    return repositories


def publish(args, repositories):
    # 各仓库独立提交和推送，失败时保留结果，重跑不会重建相同内容的提交或标签。
    for repo, branch in repositories:
        if git(repo, "status", "--porcelain"):
            git(repo, "add", "--update")
            git(repo, "commit", "-m", f":bookmark: Release v{args.version}")
        git(repo, "push", "origin", f"HEAD:refs/heads/{branch}")
        print(f"已同步：{repo}，分支：{branch}")
    tag_android(args)
    git(args.android_dir, "push", "origin", "refs/tags/v" + args.version)
    print("Android 标签已推送")


INDEX_VERSION_FILE = "src/siyuan/src/version.pug"
INDEX_VERSION = r'^- const siyuanVersion = "([^"]+)"'
INDEX_PAGES = tuple(f"{prefix}{name}.html" for prefix in ("", "en/")
                    for name in ("index", "eula", "community", "sponsor", "pricing", "privacy", "download")) \
    + ("distributors/lizhi.html",)


def index_plan(args):
    path = args.index_dir / INDEX_VERSION_FILE
    original = read(path)
    current = field(original, INDEX_VERSION, "官网思源版本")[1]
    if version_key(args.version) < version_key(current):
        raise PreparationError(f"官网不允许降级：{current} -> {args.version}")
    updated = replace(original, INDEX_VERSION, args.version, "官网思源版本")
    return [(path, original, updated)] if updated != original else []


def index_preflight(args):
    repo = args.index_dir
    if Path(git(repo, "rev-parse", "--show-toplevel")).resolve() != repo.resolve():
        raise PreparationError(f"必须指定 b3log-index 仓库根目录：{repo}")
    branch = git(repo, "symbolic-ref", "--quiet", "--short", "HEAD")
    if git(repo, "ls-files", "--unmerged"):
        raise PreparationError("b3log-index 存在未解决冲突")
    allowed = {INDEX_VERSION_FILE} | {"src/siyuan/dist/" + page for page in INDEX_PAGES}
    changed = git(repo, "diff", "--name-only", "HEAD").splitlines()
    changed += git(repo, "diff", "--cached", "--name-only").splitlines()
    untracked = git(repo, "ls-files", "--others", "--exclude-standard").splitlines()
    if (set(changed) | set(untracked)) - allowed:
        raise PreparationError("b3log-index 有官网版本和编译页面以外的改动，请先处理")
    remote = git(repo, "ls-remote", "origin", "refs/heads/" + branch)
    if remote:
        git(repo, "merge-base", "--is-ancestor", remote.split()[0], "HEAD")
    return branch


def build_index(repo):
    # 复用构建脚本对 Windows pnpm.cmd 的调用方式，只构建官网工程。
    spec = importlib.util.spec_from_file_location("build_release", Path(__file__).with_name("build-release.py"))
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    try:
        build.run(["pnpm", "install", "--frozen-lockfile"], repo / "src/siyuan")
        build.run(["pnpm", "run", "build"], repo / "src/siyuan")
    except build.BuildError as error:
        raise PreparationError(str(error)) from error


def verify_index(repo, version):
    for page in INDEX_PAGES:
        path = repo / "src/siyuan/dist" / page
        if not path.is_file() or path.stat().st_size == 0:
            raise PreparationError(f"官网编译页面缺失或为空：{path}")
        text = read(path)
        versions = re.findall(r'https://release\.liuyun\.io/siyuan/siyuan-(' + VERSION + r')(?=[.-])', text)
        if any(value != version for value in versions):
            raise PreparationError(f"官网页面仍包含其他版本下载链接：{path}")
        if page in {"download.html", "en/download.html", "index.html", "en/index.html"} and not versions:
            raise PreparationError(f"官网页面缺少版本下载链接：{path}")


def publish_index(args):
    changes = index_plan(args)
    branch = index_preflight(args)
    print(f"官网思源版本：{args.version}；仓库：{args.index_dir}")
    print(f"将更新 version.pug，执行 pnpm install --frozen-lockfile 和 pnpm run build，提交并推送 origin/{branch}")
    if not args.execute:
        return
    apply(changes)
    build_index(args.index_dir)
    verify_index(args.index_dir, args.version)
    # 构建后再次检查，禁止顺带提交锁文件或其他目录的改动。
    if index_preflight(args) != branch:
        raise PreparationError("官网构建期间分支发生变化，停止提交推送")
    paths = [INDEX_VERSION_FILE] + ["src/siyuan/dist/" + page for page in INDEX_PAGES]
    git(args.index_dir, "add", "--", *paths)
    if git(args.index_dir, "diff", "--cached", "--name-only"):
        git(args.index_dir, "commit", "-m", f":bookmark: Update SiYuan website to v{args.version}")
    git(args.index_dir, "push", "origin", f"HEAD:refs/heads/{branch}")
    print(f"官网已提交并推送：{args.index_dir}，分支：{branch}")


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="目标正式版版本号，例如 3.8.5")
    parser.add_argument("--repo", type=Path, default=ROOT)
    parser.add_argument("--android-dir", type=Path, default=ROOT.parent / "siyuan-android")
    parser.add_argument("--harmony-dir", type=Path, default=ROOT.parent / "siyuan-harmony")
    parser.add_argument("--index-dir", type=Path, default=ROOT.parent / "b3log-index")
    parser.add_argument("--android-code", type=int, help="显式指定 Android 版本代码，默认版本变化时加一")
    parser.add_argument("--harmony-code", type=int, help="显式指定鸿蒙版本代码，默认版本变化时加一")
    parser.add_argument("--tag-android", action="store_true", help="仅为已提交的 Android 发布版本创建本地标签")
    parser.add_argument("--publish", action="store_true", help="准备版本后提交各仓库已跟踪改动并推送 origin，创建并推送 Android 标签")
    parser.add_argument("--publish-index", action="store_true", help="仅更新 b3log-index 思源版本、构建官网并提交推送；安装包上传后执行")
    parser.add_argument("--execute", action="store_true", help="执行修改；默认只显示计划")
    args = parser.parse_args()
    if not re.fullmatch(VERSION, args.version):
        raise PreparationError("必须指定正式版版本号，例如 3.8.5，不接受预发布版本或 v 前缀")
    if any(int(part) > 65535 for part in args.version.split(".")):
        raise PreparationError("版本号各段不得超过 Appx 支持的 65535")
    if args.publish_index:
        if args.tag_android or args.publish or args.android_code is not None or args.harmony_code is not None:
            raise PreparationError("--publish-index 必须单独使用，不能组合发布准备或 Android 标签参数")
        publish_index(args)
    elif args.tag_android:
        if args.publish:
            raise PreparationError("--tag-android 与 --publish 不能同时使用")
        if args.android_code is not None or args.harmony_code is not None:
            raise PreparationError("打标签阶段不能修改版本代码，请先执行版本准备")
        tag_android(args)
    else:
        changes = plan(args)
        repositories = publish_preflight(args, changes) if args.publish else []
        for path, original, updated in changes:
            print(f"更新：{path}")
            # 仅显示发生变化的版本字段，不输出文件中的其他配置。
            for before, after in zip(original.splitlines(), updated.splitlines()):
                if before != after:
                    print(f"  {before.strip()}\n  => {after.strip()}")
        if args.execute:
            apply(changes)
            print(f"版本准备完成，修改 {len(changes)} 个文件")
            if args.publish:
                publish(args, repositories)
        if args.publish and not args.execute:
            for repo, branch in repositories:
                print(f"将提交全部已跟踪改动并推送 origin/{branch}：{repo}")
            print(f"将创建并推送 Android 标签 v{args.version}")
    if not args.execute:
        print("仅显示计划，未修改文件或创建标签；添加 --execute 执行")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (PreparationError, OSError, ValueError) as error:
        print(f"[FAIL] {error}", file=sys.stderr)
        sys.exit(1)
