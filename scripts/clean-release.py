#!/usr/bin/env python3
"""清理发布构建产物，保留桌面发布目录。默认仅预览，添加 --execute 才删除。"""

import argparse
import importlib.util
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("build_release", ROOT / "scripts/build-release.py")
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)

# 只列出发布构建写入的位置，不使用 git clean，也不清理开发前端或工具缓存。
MAIN_OUTPUTS = (
    "app/build", "app/kernel-linux", "app/kernel-linux-arm64",
    "kernel/harmony/libkernel.so", "kernel/harmony/libkernel.h",
)
ANDROID_OUTPUTS = (
    "build", "app/build", "app/build-release", "app/.cxx",
    "app/libs/kernel.aar", "app/src/main/assets/app.zip",
)
HARMONY_OUTPUTS = (
    "build", "entry/build", "entry/.cxx",
    "entry/src/main/resources/rawfile/app.zip",
) + tuple(f"entry/libs/{abi}/{name}" for abi in ("arm64-v8a", "x86_64")
          for name in ("libkernel.so", "libkernel.h", "lan_sync_bridge.h"))


class CleanupError(Exception):
    pass


def overlaps(first, second):
    return first.is_relative_to(second) or second.is_relative_to(first)


def is_link(path):
    # Windows 目录联接也不能作为递归删除入口。
    info = path.lstat()
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & 0x400)


def validate_target(root, path, protected):
    root, resolved = root.resolve(), path.resolve()
    if resolved == root or not resolved.is_relative_to(root):
        raise CleanupError(f"清理目标超出允许目录：{path}")
    if any(overlaps(resolved, item.resolve()) for item in protected):
        raise CleanupError(f"清理目标与保留目录重叠：{path}")
    current = path
    while current != root:
        if is_link(current):
            raise CleanupError(f"清理目标包含符号链接或目录联接：{current}")
        current = current.parent


def remove_tree(path):
    # 鸿蒙符号输出含目录联接；只移除链接自身，绝不遍历链接指向的目录。
    if is_link(path):
        if path.is_symlink() or not path.is_dir():
            path.unlink()
        else:
            path.rmdir()
    elif path.is_dir():
        for child in path.iterdir():
            remove_tree(child)
        path.rmdir()
    else:
        path.unlink()


def repository_targets(root, marker, relatives):
    root = root.resolve()
    if not (root / marker).is_file():
        raise CleanupError(f"无法确认工程目录：{root}，缺少 {marker}")
    result = subprocess.run(["git", "-C", str(root), "ls-files", "-z"],
                            capture_output=True, check=True)
    tracked = [root / os.fsdecode(name) for name in result.stdout.split(b"\0") if name]
    targets = []
    for relative in relatives:
        path = root / relative
        if not os.path.lexists(path):
            continue
        if any(overlaps(path, item) for item in tracked):
            print(f"保留含受版本控制文件的路径：{path}")
            continue
        targets.append((root, path))
    return targets


def collect_targets(args):
    main = list(MAIN_OUTPUTS) + [str(path.relative_to(ROOT)) for path in (ROOT / "kernel").glob("*.syso")]
    targets = repository_targets(ROOT, "kernel/go.mod", main)
    for root, marker, outputs in (
        (args.android_dir, "build.gradle", ANDROID_OUTPUTS),
        (args.harmony_dir, "AppScope/app.json5", HARMONY_OUTPUTS),
    ):
        if root.exists():
            targets.extend(repository_targets(root, marker, outputs))
        else:
            print(f"跳过不存在的工程：{root}")
    if os.name == "nt" and not args.skip_wsl:
        command = ["wsl.exe"]
        if args.wsl_distro:
            command += ["--distribution", args.wsl_distro]
        command += ["--user", args.wsl_user, "--exec", "wslpath", "-w", args.wsl_repo]
        wsl_root = Path(BUILD.run(command, ROOT, capture=True))
        targets.extend(repository_targets(wsl_root, "kernel/go.mod", MAIN_OUTPUTS))
    temporary = Path(tempfile.gettempdir()).resolve()
    for path in temporary.iterdir():
        # 与 build-release.py 的 mkdtemp 名称匹配，不碰其他程序的临时目录。
        if re.fullmatch(r"siyuan-release-\d+\.\d+\.\d+(?:-[\w.-]+)?-\d{8}-[\w-]{8}", path.name):
            targets.append((temporary, path))
    return list(dict.fromkeys(targets))


def clean(targets, protected, execute=False):
    # 先完整检查所有目标，再开始删除，避免参数错误造成部分清理。
    for root, path in targets:
        validate_target(root, path, protected)
    for root, path in targets:
        print(f"{'删除' if execute else '将清理'}：{path}", flush=True)
        if execute:
            validate_target(root, path, protected)
            remove_tree(path)


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true", help="实际删除；执行前停止构建并确认发布包已收齐")
    parser.add_argument("--output", type=Path, help="额外保留的自定义收集目录，与构建时 --output 一致")
    parser.add_argument("--android-dir", type=Path, default=ROOT.parent / "siyuan-android")
    parser.add_argument("--harmony-dir", type=Path, default=ROOT.parent / "siyuan-harmony")
    parser.add_argument("--wsl-distro", help="与构建时一致的 WSL 发行版")
    parser.add_argument("--wsl-user", default="d")
    parser.add_argument("--wsl-repo", default="/home/d/88250/siyuan")
    parser.add_argument("--skip-wsl", action="store_true", help="只清理 Windows 本地工程及临时产物")
    args = parser.parse_args()
    protected = [BUILD.VERIFY.desktop_folder().resolve()]
    if args.output:
        protected.append(args.output.resolve())
    for path in protected:
        print(f"保留发布目录：{path}")
    targets = collect_targets(args)
    clean(targets, protected, args.execute)
    print(f"{'已清理' if args.execute else '预览'} {len(targets)} 个路径。"
          + ("" if args.execute else "添加 --execute 执行清理。"))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (CleanupError, BUILD.BuildError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"[FAIL] {error}", file=sys.stderr)
        sys.exit(1)
