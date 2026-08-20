import json
import os
import re
import subprocess
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = REPO_ROOT / "app"
KERNEL_ROOT = REPO_ROOT / "kernel"
OUTPUT = REPO_ROOT / "THIRD_PARTY_NOTICES.md"

GO_TARGETS = [
    ("windows", "amd64", "fts5 sqlcipher"),
    ("windows", "arm64", "fts5 sqlcipher"),
    ("linux", "amd64", "fts5 sqlcipher"),
    ("linux", "arm64", "fts5 sqlcipher"),
    ("darwin", "amd64", "fts5 sqlcipher"),
    ("darwin", "arm64", "fts5 sqlcipher"),
    ("android", "arm64", "fts5 sqlcipher mobile"),
    ("android", "arm64", "fts5 sqlcipher"),
    ("android", "amd64", "fts5 sqlcipher"),
    ("ios", "arm64", "fts5 sqlcipher mobile"),
]

RUNTIME_PACKAGES = [
    "@breezystack/lamejs",
    "@electron/remote",
    "blueimp-md5",
    "dayjs",
    "filesize",
    "path-browserify",
    "zxcvbn",
]

BUNDLED_COMPONENTS = [
    (
        "Electron",
        "42.7.1",
        "MIT",
        "https://github.com/electron/electron",
        "Desktop runtime; Electron also ships LICENSES.chromium.html for Chromium and its dependencies",
    ),
    (
        "DOMPurify",
        "3.3.3",
        "Apache-2.0 OR MPL-2.0",
        "https://github.com/cure53/DOMPurify",
        "app/stage/protyle/js/protyle-html.js",
    ),
    (
        "html-to-image",
        "1.11.13",
        "MIT",
        "https://github.com/bubkoo/html-to-image",
        "app/stage/protyle/js/html-to-image.min.js",
    ),
    (
        "abcjs",
        "6.7.0",
        "MIT",
        "https://github.com/paulrosen/abcjs",
        "app/stage/protyle/js/abcjs/",
    ),
    (
        "Apache ECharts",
        "5.3.2",
        "Apache-2.0",
        "https://github.com/apache/echarts",
        "app/stage/protyle/js/echarts/echarts.min.js",
    ),
    (
        "ZRender",
        "5.3.0",
        "BSD-3-Clause",
        "https://github.com/ecomfe/zrender",
        "Bundled by Apache ECharts",
    ),
    (
        "echarts-gl",
        "2.0.9",
        "MIT",
        "https://github.com/ecomfe/echarts-gl",
        "app/stage/protyle/js/echarts/echarts-gl.min.js",
    ),
    (
        "ClayGL",
        "1.2.x snapshot",
        "BSD-2-Clause",
        "https://github.com/pissang/claygl",
        "Bundled by echarts-gl 2.0.9",
    ),
    (
        "flowchart.js",
        "1.18.0",
        "MIT",
        "https://github.com/adrai/flowchart.js",
        "app/stage/protyle/js/flowchart.js/flowchart.min.js",
    ),
    (
        "Raphaël",
        "2.3.0",
        "MIT",
        "https://github.com/DmitryBaranovskiy/raphael",
        "Bundled by flowchart.js",
    ),
    (
        "@viz-js/viz",
        "3.11.0",
        "MIT",
        "https://github.com/mdaines/viz-js",
        "app/stage/protyle/js/graphviz/viz.js",
    ),
    (
        "Graphviz",
        "Bundled snapshot",
        "EPL-1.0",
        "https://gitlab.com/graphviz/graphviz",
        "Object code bundled by @viz-js/viz",
    ),
    (
        "Expat",
        "Bundled snapshot",
        "MIT",
        "https://github.com/libexpat/libexpat",
        "Object code bundled by @viz-js/viz",
    ),
    (
        "highlight.js",
        "11.12.0",
        "BSD-3-Clause",
        "https://github.com/highlightjs/highlight.js",
        "app/stage/protyle/js/highlight.js/",
    ),
    (
        "highlightjs-solidity",
        "2.0.5 and 2.0.6",
        "MIT",
        "https://github.com/highlightjs/highlightjs-solidity",
        "Bundled in app/stage/protyle/js/highlight.js/third-languages.js",
    ),
    (
        "highlightjs-sap-abap",
        "0.3.0",
        "MIT",
        "https://github.com/highlightjs/highlightjs-sap-abap",
        "Bundled in app/stage/protyle/js/highlight.js/third-languages.js",
    ),
    (
        "Base16 highlight.js themes",
        "Bundled snapshot",
        "MIT or more permissive",
        "https://github.com/highlightjs/base16-highlightjs",
        "app/stage/protyle/js/highlight.js/styles/base16/",
    ),
    (
        "NNFX highlight.js themes",
        "Bundled snapshot",
        "CC-BY-SA-4.0",
        "https://github.com/highlightjs/highlight.js",
        "app/stage/protyle/js/highlight.js/styles/nnfx-*.min.css",
    ),
    (
        "Stack Overflow highlight.js themes",
        "Bundled snapshot",
        "MIT",
        "https://github.com/StackExchange/Stacks",
        "app/stage/protyle/js/highlight.js/styles/stackoverflow-*.min.css",
    ),
    (
        "Tokyo Night highlight.js themes",
        "Bundled snapshot",
        "MIT",
        "https://github.com/enkia/tokyo-night-vscode-theme",
        "app/stage/protyle/js/highlight.js/styles/tokyo-night-*.min.css",
    ),
    (
        "KaTeX",
        "0.16.9",
        "MIT",
        "https://github.com/KaTeX/KaTeX",
        "app/stage/protyle/js/katex/",
    ),
    (
        "KaTeX fonts",
        "0.16.9",
        "OFL-1.1",
        "https://github.com/KaTeX/KaTeX/tree/v0.16.9/fonts",
        "app/stage/protyle/js/katex/fonts/",
    ),
    (
        "MathJax",
        "3.1.2",
        "Apache-2.0",
        "https://github.com/mathjax/MathJax-src",
        "app/stage/protyle/js/mathjax/",
    ),
    (
        "Mermaid",
        "11.16.1",
        "MIT",
        "https://github.com/mermaid-js/mermaid",
        "app/stage/protyle/js/mermaid/mermaid.min.js; bundled notices are retained in the file",
    ),
    (
        "DOMPurify",
        "3.4.0",
        "Apache-2.0 OR MPL-2.0",
        "https://github.com/cure53/DOMPurify",
        "Bundled by Mermaid 11.16.1",
    ),
    (
        "js-yaml",
        "4.1.1",
        "MIT",
        "https://github.com/nodeca/js-yaml",
        "Bundled by Mermaid 11.16.1",
    ),
    (
        "lodash-es and Underscore-derived code",
        "Bundled snapshot",
        "MIT",
        "https://github.com/lodash/lodash",
        "Bundled by Mermaid 11.16.1",
    ),
    (
        "Cytoscape.js and retained embedded utilities",
        "Bundled snapshot",
        "MIT",
        "https://github.com/cytoscape/cytoscape.js",
        "Bundled by Mermaid 11.16.1",
    ),
    (
        "@mermaid-js/layout-tidy-tree",
        "0.2.2",
        "MIT",
        "https://github.com/mermaid-js/mermaid-layouts",
        "app/stage/protyle/js/mermaid/mermaid-layout-tidy-tree.min.js",
    ),
    (
        "non-layered-tidy-tree-layout",
        "2.0.2",
        "MIT",
        "https://github.com/zlluGitHub/non-layered-tidy-tree-layout",
        "Bundled by @mermaid-js/layout-tidy-tree",
    ),
    (
        "@mermaid-js/mermaid-zenuml",
        "0.2.3",
        "MIT",
        "https://github.com/mermaid-js/mermaid/tree/develop/packages/mermaid-zenuml",
        "Lightweight SiYuan bundle in app/stage/protyle/js/mermaid/mermaid-zenuml.min.js",
    ),
    (
        "@zenuml/core native SVG renderer",
        "3.50.1",
        "MIT",
        "https://github.com/mermaid-js/zenuml-core",
        "Bundled without the React-based editor; output is sanitized by SiYuan's shared DOMPurify 3.3.3",
    ),
    (
        "ANTLR 4 JavaScript runtime",
        "4.11.0",
        "BSD-3-Clause",
        "https://github.com/antlr/antlr4",
        "Bundled by @zenuml/core",
    ),
    (
        "marked",
        "4.3.0",
        "MIT AND BSD-3-Clause",
        "https://github.com/markedjs/marked",
        "Bundled by @zenuml/core for Markdown comments",
    ),
    (
        "codepointat",
        "0.2.0",
        "MIT",
        "https://github.com/mathiasbynens/codepointat",
        "Bundled by the ANTLR 4 JavaScript runtime",
    ),
    (
        "fromcodepoint",
        "0.2.1",
        "MIT",
        "https://github.com/mathiasbynens/fromcodepoint",
        "Bundled by the ANTLR 4 JavaScript runtime",
    ),
    (
        "PDF.js",
        "4.8.69",
        "Apache-2.0",
        "https://github.com/mozilla/pdf.js",
        "app/stage/protyle/js/pdf/",
    ),
    (
        "Adobe CMap resources",
        "Bundled snapshot",
        "BSD-3-Clause",
        "https://github.com/adobe-type-tools/cmap-resources",
        "app/stage/protyle/js/pdf/cmaps/",
    ),
    (
        "PDFium Foxit fonts",
        "Bundled snapshot",
        "BSD-3-Clause",
        "https://pdfium.googlesource.com/pdfium/",
        "app/stage/protyle/js/pdf/standard_fonts/",
    ),
    (
        "Liberation fonts",
        "Bundled snapshot",
        "OFL-1.1",
        "https://github.com/liberationfonts/liberation-fonts",
        "app/stage/protyle/js/pdf/standard_fonts/",
    ),
    (
        "plantuml-encoder",
        "1.4.0",
        "MIT",
        "https://github.com/markushedvall/plantuml-encoder",
        "app/stage/protyle/js/plantuml/plantuml-encoder.min.js",
    ),
    (
        "pako",
        "Bundled snapshot",
        "MIT AND Zlib",
        "https://github.com/nodeca/pako",
        "Bundled by plantuml-encoder",
    ),
    (
        "Viewer.js",
        "1.11.7",
        "MIT",
        "https://github.com/fengyuanchen/viewerjs",
        "app/stage/protyle/js/viewerjs/viewer.js",
    ),
    (
        "Lute JavaScript runtime",
        "Bundled snapshot",
        "MulanPSL-2.0",
        "https://github.com/88250/lute",
        "app/stage/protyle/js/lute/lute.min.js",
    ),
    (
        "Pandoc",
        "3.5",
        "GPL-2.0-or-later",
        "https://github.com/jgm/pandoc",
        "app/pandoc/*.zip",
    ),
    (
        "SQLite",
        "3.53.1 amalgamation",
        "Public Domain",
        "https://www.sqlite.org/",
        "Compiled into the kernel by github.com/88250/go-sqlite3",
    ),
    (
        "SQLCipher",
        "4.16.0 Community amalgamation",
        "BSD-3-Clause",
        "https://github.com/sqlcipher/sqlcipher",
        "Compiled into the kernel by github.com/88250/go-sqlite3 with the sqlcipher build tag",
    ),
    (
        "LibTomCrypt subset",
        "Bundled snapshot",
        "Public Domain",
        "https://github.com/libtom/libtomcrypt",
        "Compiled into the kernel by github.com/88250/go-sqlite3 with the sqlcipher build tag",
    ),
    (
        "PDFium WebAssembly",
        "7323",
        "BSD-3-Clause AND Apache-2.0",
        "https://pdfium.googlesource.com/pdfium/+/refs/heads/chromium/7323/",
        "Embedded by github.com/klippa-app/go-pdfium",
    ),
    (
        "Color Icon",
        "0.0.4",
        "MIT",
        "https://github.com/Glaube-TY/color-icon",
        "app/appearance/icons/color-icon/",
    ),
    (
        "Simple Icons",
        "16.21.0 and 16.27.0",
        "CC0-1.0",
        "https://github.com/simple-icons/simple-icons",
        "Selected AI provider logos in app/stage/images/ai-providers/",
    ),
    (
        "SVG Logos (@iconify-json/logos)",
        "1.2.13",
        "CC0-1.0",
        "https://github.com/gilbarbara/logos",
        "app/stage/protyle/js/mermaid/icons.json; depicted marks remain subject to trademark rights",
    ),
    (
        "theSVG",
        "Snapshot aa0605996b4ad4fdda98502f84021b3c3a64847d",
        "MIT",
        "https://github.com/glincker/thesvg",
        "Volcengine logo in app/stage/images/ai-providers/",
    ),
    (
        "AI provider brand assets",
        "Bundled snapshots",
        "Upstream brand and trademark terms",
        "https://github.com/siyuan-note/siyuan/blob/master/app/stage/images/ai-providers/README.md",
        "OpenAI, Zhipu AI, SiliconFlow, and other provider marks; exact sources and terms are recorded below",
    ),
    (
        "Unicode CLDR emoji annotations",
        "Bundled snapshot",
        "Unicode-3.0",
        "https://github.com/unicode-org/cldr",
        "Localized names and search keywords in app/appearance/emojis/conf.json",
    ),
    (
        "Pexels cover photos",
        "72 selected photographs",
        "Pexels License",
        "https://www.pexels.com/license/",
        "app/appearance/covers/; photographer and source attribution is recorded below",
    ),
    (
        "Microsoft Edge Demos PWA service worker example",
        "Bundled adaptation",
        "MIT",
        "https://github.com/MicrosoftEdge/Demos/tree/main/pwamp",
        "app/stage/service-worker.js",
    ),
]

FONT_COMPONENTS = [
    (
        "JetBrains Mono",
        "2.304",
        "OFL-1.1",
        "https://github.com/JetBrains/JetBrainsMono",
        "app/appearance/fonts/JetBrainsMono-2.304/LICENSE",
    ),
    (
        "LXGW WenKai Lite",
        "1.501",
        "OFL-1.1",
        "https://github.com/lxgw/LxgwWenKai-Lite",
        "app/appearance/fonts/LxgwWenKai-Lite-1.501/LICENSE",
    ),
    (
        "Noto COLRv1 Emoji",
        "2.047",
        "OFL-1.1",
        "https://github.com/googlefonts/noto-emoji",
        "app/appearance/fonts/Noto-COLRv1-2.047/LICENSE",
    ),
]

LOCAL_NOTICE_ROOTS = [
    "app/stage/protyle/js",
    "app/appearance/fonts",
    "app/appearance/icons",
]

LOCAL_NOTICE_FILES = [
    "app/appearance/covers/manifest.json",
    "app/appearance/icons/color-icon/README.md",
    "app/stage/images/ai-providers/README.md",
]

LICENSE_NAME_PATTERN = re.compile(
    r"^(?:LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT|UNLICENSE)(?:[._-].*)?$",
    re.IGNORECASE,
)

COMMENT_PATTERN = re.compile(
    r"/\*\s*(?:!|\*|@license\b|@preserve\b|copyright\b|license(?:d)?\b)[\s\S]*?\*/",
    re.IGNORECASE,
)

CLAYGL_LICENSE = """Copyright (c) 2014, Yi Shen
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE."""

PDFIUM_BSD_NOTICE = """Copyright 2014 The PDFium Authors

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google Inc. nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE."""

THESVG_LICENSE = """MIT License

Copyright (c) 2025 thesvg.org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE."""

MICROSOFT_EDGE_DEMOS_LICENSE = """MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE."""


def parse_json_stream(content):
    decoder = json.JSONDecoder()
    index = 0
    while index < len(content):
        while index < len(content) and content[index].isspace():
            index += 1
        if index >= len(content):
            return
        value, index = decoder.raw_decode(content, index)
        yield value


def read_license_files(root, recursive=False):
    if not root or not root.is_dir():
        return []
    result = []
    paths = root.rglob("*") if recursive else root.iterdir()
    for path in paths:
        if not path.is_file() or not LICENSE_NAME_PATTERN.match(path.name):
            continue
        if path.suffix.lower() in {".c", ".go", ".h", ".js"}:
            continue
        result.append((path.relative_to(root).as_posix(), path.read_text(encoding="utf-8", errors="replace")))
    return sorted(result)


def collect_local_notices():
    notices = {}
    for local_root in LOCAL_NOTICE_ROOTS:
        root = REPO_ROOT / local_root
        for name, content in read_license_files(root, recursive=True):
            notices[f"{local_root}/{name}"] = content
    for local_path in LOCAL_NOTICE_FILES:
        path = REPO_ROOT / local_path
        notices[local_path] = path.read_text(encoding="utf-8", errors="replace")
    return sorted(notices.items())


def collect_retained_comments():
    root = APP_ROOT / "stage" / "protyle" / "js"
    notices = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in {".css", ".js"}:
            continue
        content = path.read_text(encoding="utf-8", errors="replace")
        comments = []
        for comment in COMMENT_PATTERN.findall(content):
            normalized = "\n".join(line.rstrip() for line in comment.strip().splitlines())
            lowered = comment.lower()
            if not any(marker in lowered for marker in ("license", "copyright", "@preserve")):
                continue
            if normalized not in comments:
                comments.append(normalized)
        if comments:
            notices.append((path.relative_to(REPO_ROOT).as_posix(), "\n\n".join(comments)))
    return notices


def collect_pandoc_notices():
    archive = APP_ROOT / "pandoc" / "pandoc-windows-amd64.zip"
    with zipfile.ZipFile(archive) as pandoc_zip:
        names = set(pandoc_zip.namelist())
        notices = []
        for name in ("COPYING.rtf", "COPYRIGHT.txt"):
            if name not in names:
                raise RuntimeError(f"{archive} does not contain {name}")
            notices.append((f"{archive.relative_to(REPO_ROOT).as_posix()}!/{name}", pandoc_zip.read(name).decode("utf-8")))
    return notices


def detect_license(text):
    lowered = text.lower()
    if "mulanpsl2" in lowered or "木兰宽松许可证" in lowered:
        return "MulanPSL-2.0"
    if "gnu affero general public license" in lowered and "version 3" in lowered:
        return "AGPL-3.0"
    if "gnu lesser general public license" in lowered and "version 3" in lowered:
        return "LGPL-3.0"
    if "gnu lesser general public license" in lowered and "version 2.1" in lowered:
        return "LGPL-2.1"
    if "free type project license" in lowered or "freetype project license" in lowered:
        return "FTL"
    if "mozilla public license version 2.0" in lowered:
        return "MPL-2.0"
    if "gnu general public license" in lowered and "version 3" in lowered:
        return "GPL-3.0"
    if "gnu general public license" in lowered and "version 2" in lowered:
        return "GPL-2.0"
    if "eclipse public license" in lowered:
        return "EPL"
    if "apache license" in lowered and "version 2.0" in lowered:
        return "Apache-2.0"
    if "sil open font license" in lowered:
        return "OFL-1.1"
    if "boost software license" in lowered:
        return "BSL-1.0"
    if "permission is hereby granted, free of charge" in lowered:
        return "MIT"
    if "permission to use, copy, modify, and/or distribute this software" in lowered:
        return "ISC"
    if "redistribution and use in source and binary forms" in lowered:
        if "neither the name" in lowered or "names of its contributors" in lowered:
            return "BSD-3-Clause"
        return "BSD-2-Clause"
    if "altered source versions must be plainly marked" in lowered:
        return "Zlib"
    if "this is free and unencumbered software released into the public domain" in lowered:
        return "Unlicense"
    return None


def module_license(module_path, license_files):
    mixed_license_overrides = {
        "code.sajari.com/docconv": "MIT AND BSD-3-Clause",
        "github.com/andybalholm/brotli": "MIT AND BSD-3-Clause",
        "github.com/aws/aws-sdk-go-v2": "Apache-2.0 AND BSD-3-Clause",
        "github.com/aws/smithy-go": "Apache-2.0 AND BSD-3-Clause",
        "github.com/dop251/goja": "MIT AND BSD-3-Clause",
        "github.com/klauspost/compress": "BSD-3-Clause AND Apache-2.0 AND MIT",
        "github.com/mattn/go-sqlite3": "MIT AND BSD-3-Clause AND Public Domain",
        "gopkg.in/yaml.v2": "Apache-2.0 AND MIT",
    }
    if module_path in mixed_license_overrides:
        return mixed_license_overrides[module_path]
    if module_path == "github.com/levigross/exp-html":
        return "BSD-3-Clause"
    if module_path == "github.com/golang/freetype":
        return "FTL OR GPL-2.0-or-later"
    detected = []
    for name, content in license_files:
        if Path(name).name.upper().startswith(("NOTICE", "COPYRIGHT")):
            continue
        identifier = detect_license(content)
        if identifier and identifier not in detected:
            detected.append(identifier)
    if not detected:
        raise RuntimeError(f"Unable to identify the license for {module_path}")
    return " OR ".join(detected)


def collect_go_modules():
    modules = {}
    for goos, goarch, tags in GO_TARGETS:
        command = ["go", "list", "-deps", "-json"]
        if tags:
            command.extend(["-tags", tags])
        command.append("./...")
        process = subprocess.run(
            command,
            cwd=KERNEL_ROOT,
            env={**os.environ, "GOFLAGS": "-mod=readonly", "GOOS": goos, "GOARCH": goarch},
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=True,
        )
        for package in parse_json_stream(process.stdout):
            module = package.get("Module")
            if not module or module.get("Main"):
                continue
            replacement = module.get("Replace")
            effective = replacement or module
            module_path = module["Path"]
            effective_dir = Path(effective["Dir"]) if effective.get("Dir") else None
            entry = modules.setdefault(
                module_path,
                {
                    "path": module_path,
                    "version": module.get("Version", ""),
                    "effective_path": effective.get("Path", module_path),
                    "effective_version": effective.get("Version", module.get("Version", "")),
                    "effective_dir": effective_dir,
                    "package_dirs": set(),
                },
            )
            package_dir = Path(package["Dir"]) if package.get("Dir") else None
            if effective_dir and package_dir:
                try:
                    entry["package_dirs"].add(package_dir.relative_to(effective_dir))
                except ValueError:
                    pass
    result = []
    for module_path in sorted(modules, key=str.casefold):
        module = modules[module_path]
        effective_dir = module.pop("effective_dir")
        package_dirs = module.pop("package_dirs")
        licenses = {}
        if effective_dir:
            for name, content in read_license_files(effective_dir):
                licenses[name] = content
            for package_dir in sorted(package_dirs):
                root = effective_dir / package_dir
                for name, content in read_license_files(root):
                    relative_name = (package_dir / name).as_posix()
                    licenses[relative_name] = content
        module["licenses"] = sorted(licenses.items())
        module["license"] = module_license(module_path, module["licenses"])
        module["effective_dir"] = effective_dir
        result.append(module)
    return result


def collect_additional_notices(go_modules):
    modules = {module["path"]: module for module in go_modules}
    sqlite_module = modules["github.com/mattn/go-sqlite3"]
    sqlite_source = sqlite_module["effective_dir"] / "sqlcipher-binding.c"
    comments = COMMENT_PATTERN.findall(sqlite_source.read_text(encoding="utf-8", errors="replace"))
    sqlite_notice = next(comment for comment in comments if "The author disclaims copyright to this source code" in comment)
    sqlcipher_notice = next(comment for comment in comments if "Copyright (c) 2008-2024, ZETETIC LLC" in comment)
    apache_license = next(
        content
        for module in go_modules
        for name, content in module["licenses"]
        if not Path(name).name.upper().startswith(("NOTICE", "COPYRIGHT")) and detect_license(content) == "Apache-2.0"
    )
    return [
        ("SQLite 3.53.1 public-domain notice", sqlite_notice),
        ("SQLCipher 4.16.0 Community - BSD-3-Clause notice", sqlcipher_notice),
        ("LibTomCrypt subset - public-domain notice", "LibTomCrypt is public domain software."),
        ("ClayGL 1.2.x - LICENSE", CLAYGL_LICENSE),
        ("PDFium 7323 - LICENSE", PDFIUM_BSD_NOTICE + "\n\n" + apache_license),
        ("theSVG snapshot aa0605996b4ad4fdda98502f84021b3c3a64847d - LICENSE", THESVG_LICENSE),
        ("Microsoft Edge Demos - LICENSE", MICROSOFT_EDGE_DEMOS_LICENSE),
    ]


def find_package_root(package_name):
    return APP_ROOT / "node_modules" / Path(*package_name.split("/"))


def collect_runtime_packages():
    packages = []
    for package_name in RUNTIME_PACKAGES:
        root = find_package_root(package_name)
        package_json = json.loads((root / "package.json").read_text(encoding="utf-8"))
        repository = package_json.get("homepage") or package_json.get("repository") or ""
        if isinstance(repository, dict):
            repository = repository.get("url", "")
        packages.append(
            {
                "name": package_name,
                "version": package_json["version"],
                "license": package_json.get("license", "UNKNOWN"),
                "source": normalize_repository(repository),
                "licenses": read_license_files(root),
            }
        )
    return packages


def normalize_repository(repository):
    repository = repository.replace("git+", "").removesuffix(".git")
    if "://" not in repository and repository.count("/") == 1:
        return f"https://github.com/{repository}"
    return repository


def escape_table(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def component_table(components):
    lines = ["| Component | Version | License | Source | Distribution |", "|---|---|---|---|---|"]
    for name, version, license_id, source, distribution in components:
        lines.append(
            f"| {escape_table(name)} | {escape_table(version)} | {escape_table(license_id)} | "
            f"[upstream]({source}) | {escape_table(distribution)} |"
        )
    return lines


def code_block(content):
    content = "\n".join(line.rstrip() for line in content.splitlines())
    marker = "```"
    while marker in content:
        marker += "`"
    return [marker + "text", content.rstrip(), marker]


def render_notices(runtime_packages, go_modules):
    lines = [
        "# Third-party notices",
        "",
        "SiYuan includes third-party software, fonts, data, and other resources. This document records components that are distributed with SiYuan or incorporated into its executable and browser bundles. Build-only and test-only tools are not part of this notice unless their output embeds the tool or its licensed material.",
        "",
        "The component list is informational and does not replace the license terms. Copyright notices, license texts, and upstream NOTICE files reproduced below remain the property of their respective owners. Source links identify the corresponding upstream projects; availability of a link does not alter the applicable license.",
        "",
        "## JavaScript runtime packages",
        "",
        "| Package | Version | License | Source |",
        "|---|---|---|---|",
    ]
    for package in runtime_packages:
        lines.append(
            f"| `{escape_table(package['name'])}` | {escape_table(package['version'])} | "
            f"{escape_table(package['license'])} | [upstream]({package['source']}) |"
        )
    lines.extend(["", "## Embedded runtimes, renderers, and converters", ""])
    lines.extend(component_table(BUNDLED_COMPONENTS))
    lines.extend(["", "Minified files that contain their own bundled-license blocks retain those blocks in the distributed artifact.", ""])
    lines.extend(["## Fonts", ""])
    lines.extend(component_table(FONT_COMPONENTS))
    lines.extend(
        [
            "",
            "## Go standard library and runtime",
            "",
            "The SiYuan kernel includes the Go standard library and runtime under the Go BSD-style license. The applicable license text is reproduced below.",
            "",
            "## Go modules incorporated into the kernel",
            "",
            "The following inventory is the union generated by `go list -deps -json ./...` for Windows, Linux, and macOS on AMD64 and ARM64, Android mobile on ARM64, HarmonyOS's Android-compatible ARM64 and AMD64 targets, and iOS on ARM64. The release tags `fts5 sqlcipher` are applied to every target, the `mobile` tag is additionally applied to Android and iOS mobile packages, and module changes are disabled. Replaced modules show the effective source module in the Source column.",
            "",
            "| Module | Version | License | Source |",
            "|---|---|---|---|",
        ]
    )
    for module in go_modules:
        effective_version = module["effective_version"]
        source = f"https://pkg.go.dev/{module['effective_path']}"
        if effective_version:
            source += f"@{effective_version}"
        lines.append(
            f"| `{escape_table(module['path'])}` | {escape_table(module['version'])} | "
            f"{escape_table(module['license'])} | [source]({source}) |"
        )
    lines.extend(
        [
            "",
            "## License texts and attribution notices",
            "",
            "The following texts are reproduced from the exact dependency versions used to generate this inventory. Identical license families may appear more than once because copyright statements and additional terms can differ by project.",
            "",
        ]
    )
    goroot_process = subprocess.run(
        ["go", "env", "GOROOT"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    go_license = Path(goroot_process.stdout.strip()) / "LICENSE"
    lines.extend(["### Go standard library and runtime", ""])
    lines.extend(code_block(go_license.read_text(encoding="utf-8", errors="replace")))
    lines.append("")
    electron_license = APP_ROOT / "node_modules" / "electron" / "LICENSE"
    lines.extend(["### Electron 42.7.1 - LICENSE", ""])
    lines.extend(code_block(electron_license.read_text(encoding="utf-8", errors="replace")))
    lines.extend(
        [
            "",
            "### Apache ECharts 5.3.2 - NOTICE",
            "",
            "```text",
            "Apache ECharts",
            "Copyright 2017-2022 The Apache Software Foundation",
            "",
            "This product includes software developed at",
            "The Apache Software Foundation (https://www.apache.org/).",
            "```",
            "",
        ]
    )
    for heading, content in collect_additional_notices(go_modules):
        lines.extend([f"### {heading}", ""])
        lines.extend(code_block(content))
        lines.append("")
    for package in runtime_packages:
        for name, content in package["licenses"]:
            lines.extend([f"### {package['name']} {package['version']} - {name}", ""])
            lines.extend(code_block(content))
            lines.append("")
    for local_path, content in collect_local_notices():
        lines.extend([f"### {local_path}", ""])
        lines.extend(code_block(content))
        lines.append("")
    for local_path, content in collect_pandoc_notices():
        lines.extend([f"### {local_path}", ""])
        lines.extend(code_block(content))
        lines.append("")
    lines.extend(
        [
            "## License and attribution comments retained in bundled files",
            "",
            "The following comments are extracted verbatim from the JavaScript and CSS artifacts that are distributed with SiYuan. This includes bundled dependency notices and per-theme copyright and license declarations.",
            "",
        ]
    )
    for local_path, content in collect_retained_comments():
        lines.extend([f"### {local_path}", ""])
        lines.extend(code_block(content))
        lines.append("")
    lines.extend(["## Go module license texts", ""])
    for module in go_modules:
        if not module["licenses"]:
            lines.extend(
                [
                    f"### {module['path']} {module['version']}",
                    "",
                    "This module is derived from the Go project HTML package. Its source files carry the Go Authors BSD-style notice; the Go license reproduced above applies.",
                    "",
                ]
            )
            continue
        for name, content in module["licenses"]:
            lines.extend([f"### {module['path']} {module['version']} - {name}", ""])
            lines.extend(code_block(content))
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main():
    runtime_packages = collect_runtime_packages()
    go_modules = collect_go_modules()
    OUTPUT.write_text(render_notices(runtime_packages, go_modules), encoding="utf-8", newline="\n")
    print(f"Generated {OUTPUT} with {len(runtime_packages)} JavaScript packages and {len(go_modules)} Go modules")


if __name__ == "__main__":
    main()
