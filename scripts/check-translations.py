#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
以 zh-CN.json 为基准，检查其他语言文件的翻译质量（精准版）。
检测规则：
  1. MISSING_KEY: 键缺失
  2. UNTRANSLATED: 目标值与中文原文【完全相同】（针对非 zh-CN 语言，含中文且字符串相等）
  3. PLACEHOLDER_MISMATCH: 占位符/HTML 标签丢失（规范化后比较）
注意：日语/韩语的汉字使用是合法的，不视为错误，因此仅当整串与原文相同时才报未翻译。
"""
import json
import re
import os

LANG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "app", "appearance", "langs")
BASE = "zh-CN"
TARGETS = ["ar", "de", "en", "es", "fr", "he", "hi", "id", "it", "ja", "ko",
           "nl", "pl", "pt-BR", "ru", "sk", "th", "tr", "uk", "zh-TW"]

CN_RE = re.compile(r"[\u4e00-\u9fff]")
TRIVIAL_RE = re.compile(r"^[\s\d\W]+$", re.UNICODE)


def load(name):
    with open(os.path.join(LANG_DIR, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


def walk(obj, prefix=""):
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = prefix + "." + k if prefix else k
            if isinstance(v, dict):
                out.update(walk(v, key))
            else:
                out[key] = v
    return out


def norm_placeholders(s):
    """规范化占位符比较：统一引号、忽略 URL 路径差异、忽略帮助链接域名差异"""
    s2 = s.replace('"', "'")
    s2 = re.sub(r"b3log\.org/siyuan(/[a-z]{2})?/", "b3log.org/siyuan/", s2)
    s2 = re.sub(r"b3log\.org/siyuan(\?[^\s\"']*)?", "b3log.org/siyuan", s2)
    s2 = re.sub(r"https://(ld246\.com|liuyun\.io)/article/\d+", "HELPURL", s2)
    ps = re.findall(r"\$\{[^}]+\}|\{[a-zA-Z_][a-zA-Z0-9_]*\}|%[sdf]|\d+\$[sdf]|<[^>]+>", s2)
    return sorted(ps)


def main():
    base = load(BASE)
    bflat = walk(base)
    total = 0
    for t in TARGETS:
        tgt = load(t)
        tflat = walk(tgt)
        issues = []
        for k in bflat:
            if k not in tflat:
                issues.append((k, "MISSING_KEY", ""))
                continue
        for k, bv in bflat.items():
            if k not in tflat:
                continue
            tv = tflat[k]
            if not isinstance(bv, str) or not isinstance(tv, str):
                continue
            if TRIVIAL_RE.match(bv):
                continue
            # 完全未翻译：目标值与中文原文完全相同（仅对非 zh-CN 语言）
            if t != "zh-CN" and tv == bv and CN_RE.search(bv):
                issues.append((k, "UNTRANSLATED", bv[:80]))
            # 占位符丢失（规范化后比较）
            bp = norm_placeholders(bv)
            tp = norm_placeholders(tv)
            if bp and bp != tp:
                issues.append((k, "PLACEHOLDER_MISMATCH",
                               "base=%s target=%s" % (bp, tp)))
        if issues:
            total += len(issues)
            print("=" * 70)
            print("### %s  (%d issues)" % (t, len(issues)))
            print("=" * 70)
            for k, kind, detail in issues:
                print("  [%s] %s" % (kind, k))
                if detail:
                    print("      -> %s" % detail[:200])
    print("\nTotal issues: %d" % total)


if __name__ == "__main__":
    main()
