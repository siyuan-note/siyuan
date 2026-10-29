#!/usr/bin/env python3
"""为鸿蒙构建准备独立的 Go 工具链副本，不修改系统安装和模块缓存。"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile


PATCH_VERSION = 1
PATCH_FILES = ("src/net/cgo_resold.go", "src/runtime/tls_arm64.s", "src/runtime/cgo/gcc_android.c")


def replace_once(text, before, after, name):
    if text.count(before) == 1 and after not in text:
        return text.replace(before, after)
    if text.count(after) == 1 and before not in text:
        return text
    raise ValueError(f"Unsupported Go source in {name}; refusing to apply the Harmony patch")


def patched_sources(source):
    texts = {name: (source / name).read_text(encoding="utf-8") for name in PATCH_FILES}
    texts[PATCH_FILES[0]] = replace_once(texts[PATCH_FILES[0]], "C.size_t(len(b))", "C.socklen_t(len(b))", PATCH_FILES[0])
    texts[PATCH_FILES[1]] = replace_once(texts[PATCH_FILES[1]],
                                      "DATA runtime·tls_g+0(SB)/8, $16", "DATA runtime·tls_g+0(SB)/8, $-144", PATCH_FILES[1])
    pattern = r"(static void\s+inittls\(void \*\*tlsg, void \*\*tlsbase\)\s*\{)(.*?)(\n\}\s*\nvoid \(\*x_cgo_inittls\))"
    matches = list(re.finditer(pattern, texts[PATCH_FILES[2]], re.S))
    if len(matches) != 1:
        raise ValueError("Unsupported Go inittls function; refusing to apply the Harmony patch")
    body = matches[0].group(2)
    if body.strip() != "return;" and ("pthread_key_create" not in body or "TLS_SLOT_APP" not in body):
        raise ValueError("Unsupported Go inittls body; refusing to apply the Harmony patch")
    texts[PATCH_FILES[2]] = re.sub(pattern, lambda match: match[1] + "\n\treturn;" + match[3], texts[PATCH_FILES[2]], flags=re.S)
    return texts


def prepare(source, cache):
    source = source.resolve()
    if not (source / "bin/go").is_file():
        raise ValueError(f"Missing Go executable: {source / 'bin/go'}")
    texts = patched_sources(source)
    identity = {"revision": PATCH_VERSION, "source": str(source), "version": (source / "VERSION").read_text(encoding="utf-8"),
                "files": {name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in PATCH_FILES}}
    key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:24]
    cache = cache.resolve()
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / key

    def valid():
        try:
            return ((target / ".siyuan-harmony.json").read_text(encoding="utf-8") == json.dumps(identity, sort_keys=True)
                    and (target / "bin/go").is_file()
                    and all((target / name).read_text(encoding="utf-8") == text for name, text in texts.items()))
        except OSError:
            return False

    if target.exists():
        if valid():
            return target
        raise ValueError(f"Invalid Harmony Go cache; choose another --cache-dir: {target}")
    # 先在独立临时目录完成复制及适配，再发布可复用的缓存目录。
    with tempfile.TemporaryDirectory(prefix="prepare-", dir=cache) as temporary:
        staged = Path(temporary) / "go"
        shutil.copytree(source, staged, symlinks=True)
        for directory, _, _ in os.walk(staged):
            folder = Path(directory)
            folder.chmod(folder.stat().st_mode | stat.S_IWUSR)
        for name, text in texts.items():
            destination = staged / name
            if not destination.resolve().is_relative_to(staged.resolve()):
                raise ValueError(f"Go source links outside the copied toolchain: {name}")
            destination.chmod(destination.stat().st_mode | stat.S_IWUSR)
            destination.write_text(text, encoding="utf-8", newline="\n")
        (staged / ".siyuan-harmony.json").write_text(json.dumps(identity, sort_keys=True), encoding="utf-8")
        try:
            staged.rename(target)
        except OSError:
            if not valid():
                raise
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, default=Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "siyuan-harmony/go")
    args = parser.parse_args()
    print(prepare(args.source, args.cache_dir))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
