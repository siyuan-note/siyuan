// 内核 Go 源码的统一文件头。apply-license-headers.mjs 用它改写，
// check-license-headers.mjs 用它校验，两处共用本文件的定义。
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 头部三行，其后固定跟一个空行。
const HEADER_TEXT = [
    "SiYuan - https://github.com/siyuan-note/siyuan",
    "Copyright (c) 2020-present, b3log.org",
    "SPDX-License-Identifier: AGPL-3.0-or-later",
];

// 派生自其他项目、持有自己许可的子树。它们既不加本项目文件头，也不允许残留，
// 否则会覆盖上游的许可声明。
export const THIRD_PARTY_PREFIXES = [
    "kernel/plugin/encoding/",       // Apache-2.0，grafana/sobek-webapi-encoding
    "kernel/heif/internal/h265heic/", // MIT，roticv/h265
];

// Electron 主进程入口是桌面端唯一随安装包分发的可读源码，单独保留文件头。
export const KEPT_NON_GO_HEADERS = new Set(["app/electron/main.js"]);

const inThirdParty = file => THIRD_PARTY_PREFIXES.some(prefix => file.startsWith(prefix));

export const isInScope = file =>
    (file.startsWith("kernel/") && file.endsWith(".go") && !inThirdParty(file)) ||
    KEPT_NON_GO_HEADERS.has(file);

// listSourceFiles 返回仓库内跟踪的、需要带文件头的文件，顺序稳定。
export const listSourceFiles = () =>
    execFileSync("git", ["ls-files", "-z"], {cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024})
        .split("\0")
        .filter(Boolean)
        .filter(isInScope)
        .sort();

// headerLines 返回该文件应具备的文件头行，统一用行注释。
export const headerLines = () => HEADER_TEXT.map(line => "// " + line);

// 头部行去掉注释符后的纯文本，用于识别既有头部属于本项目还是另一套许可。
// 同时兼容行注释、井号注释与块注释的三种前缀，删除非 Go 文件头时也走这里。
const stripComment = line => {
    let text = line.trim();
    text = text.replace(/^\/\*+!?/, "").replace(/\*\/$/, "");
    text = text.replace(/^\/\//, "").replace(/^#/, "");
    text = text.replace(/^\*\s?/, "");
    return text.trim();
};

// 既有头部的正文有多种折行。这里把它拼成一段规范文本，被收缩的每一行都必须是它的子串，
// 折行位置不同也照样命中。
const HEADER_BODY = [
    "This program is free software: you can redistribute it and/or modify",
    "it under the terms of the GNU Affero General Public License as published by",
    "the Free Software Foundation, either version 3 of the License, or",
    "(at your option) any later version.",
    "This program is distributed in the hope that it will be useful,",
    "but WITHOUT ANY WARRANTY; without even the implied warranty of",
    "MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the",
    "GNU Affero General Public License for more details.",
    "You should have received a copy of the GNU Affero General Public License",
    "along with this program.  If not, see <https://www.gnu.org/licenses/>.",
].join(" ").replace(/\s+/g, " ").toLowerCase();

// 头部开头的署名行与本项目特有的一行式声明。
const HEADER_SIGNATURE = [
    /^SiYuan - /i,
    /^Copyright \((?:c|C)\) \d{4}/,
    /^Licensed under the GNU Affero General Public License/i,
    /^SPDX-License-Identifier: AGPL-3\.0-or-later$/i,
];

// isHeaderLine 判断某一行是否属于既有文件头：空注释行、署名行，或规范正文的子串。
export const isHeaderLine = line => {
    const text = stripComment(line);
    if ("" === text) {
        return true;
    }
    if (HEADER_SIGNATURE.some(pattern => pattern.test(text))) {
        return true;
    }
    // 旧头部的折行位置、行内空格与许可链接的协议都不统一，比较前先抹平。
    return HEADER_BODY.includes(text.replace(/\s+/g, " ").replace("http://", "https://").toLowerCase());
};

// 收缩后仍出现的许可文本说明旧头部没有完整吃掉，需要人工确认。
const STALE_LICENSE = /GNU Affero General Public License|SPDX-License-Identifier|Licensed under|Copyright \((?:c|C)\) \d{4}/i;

const BUILD_TAG = /^\/\/go:build |^\/\/ \+build /;

// readHead 切出文件开头的可改写区域：注释块与 build tag 都在这里，
// 到第一个真正的代码行（package）之前为止。
const readHead = lines => {
    let index = 0;
    let inBlock = false;
    while (index < lines.length) {
        const line = lines[index];
        if (inBlock) {
            index++;
            if (line.includes("*/")) {
                inBlock = false;
            }
            continue;
        }
        if (line.trim() === "" || line.startsWith("//")) {
            index++;
            continue;
        }
        if (line.startsWith("/*")) {
            index++;
            inBlock = !line.includes("*/");
            continue;
        }
        break;
    }
    return {end: index, head: lines.slice(0, index)};
};

// planHeader 计算该文件改写后的内容。返回 {text, action, warning}：
// action 为 keep（已符合）、rewrite（替换既有头部）、insert（新增头部）、skip（需人工确认）。
// 按 UTF-8 BOM 与 CRLF 还原原始书写习惯，避免只为改文件头就重写整份文件的换行符。
export const planHeader = (file, text) => {
    const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
    const crlf = text.includes("\r\n");
    const source = (bom ? text.slice(1) : text).replace(/\r\n/g, "\n");
    const lines = source.split("\n");
    const {end, head} = readHead(lines);

    // build tag 一律提到头部之后单独成段，避免被旧头部或空行位置带偏。
    const removed = new Set();
    const buildTags = [];
    head.forEach((line, offset) => {
        if (BUILD_TAG.test(line)) {
            buildTags.push(line);
            removed.add(offset);
        }
    });

    // 头部区域按空行切成若干注释组，第一组匹配既有文件头形态的即被收缩。
    const groups = [];
    let current = [];
    head.forEach((line, offset) => {
        if (line.trim() === "") {
            if (current.length) {
                groups.push(current);
            }
            current = [];
            return;
        }
        current.push({line, index: offset});
    });
    if (current.length) {
        groups.push(current);
    }

    let headerGroup = null;
    for (const group of groups) {
        if (group.some(entry => removed.has(entry.index))) {
            continue;
        }
        const blob = group.map(entry => entry.line).join("\n");
        const looksLikeHeader = /SPDX-License-Identifier|GNU Affero General Public License/.test(blob) ||
            /^\/\/\s*(?:SiYuan -|Copyright \((?:c|C)\) \d{4})/.test(group[0].line);
        if (looksLikeHeader) {
            headerGroup = group;
            break;
        }
    }

    if (headerGroup) {
        // 从组首逐行吃掉头部，剩余行（包文档、说明注释）保留。
        let consumed = 0;
        while (consumed < headerGroup.length && isHeaderLine(headerGroup[consumed].line)) {
            consumed++;
        }
        for (let i = 0; i < consumed; i++) {
            removed.add(headerGroup[i].index);
        }
        const stale = headerGroup.slice(consumed).filter(entry => STALE_LICENSE.test(stripComment(entry.line)));
        if (stale.length) {
            return {action: "skip", text, warning: `收缩后仍残留许可文本：${stale[0].line.trim()}`};
        }
    }

    const kept = [];
    for (let index = 0; index < end; index++) {
        if (removed.has(index)) {
            continue;
        }
        kept.push(lines[index]);
    }
    // 保留注释与后续代码之间原本是否空行，避免凭空插入或删除空行。
    const blankBeforeBody = head.length > 0 && head[head.length - 1].trim() === "";
    while (kept.length && kept[0].trim() === "") {
        kept.shift();
    }
    while (kept.length && kept[kept.length - 1].trim() === "") {
        kept.pop();
    }

    const output = [...headerLines()];
    output.push("");
    if (buildTags.length) {
        output.push(...buildTags);
        output.push("");
    }
    if (kept.length) {
        output.push(...kept);
        if (blankBeforeBody) {
            output.push("");
        }
    }
    output.push(...lines.slice(end));

    const body = output.join("\n");
    const next = bom + (crlf ? body.replace(/\n/g, "\r\n") : body);
    let action = "keep";
    if (next !== text) {
        action = headerGroup ? "rewrite" : "insert";
    }
    return {action, text: next, warning: ""};
};

// 只有内核 Go 源码声明许可文件头。其他语言的源码不加文件头，已存在的要删掉，
// 只有内核 Go 源码声明许可文件头，其他语言的源码不加文件头，已存在的要删掉，
// 避免同一仓库里两套相互矛盾的约定。
const REMOVAL_SUFFIXES = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".scss", ".css", ".py", ".ps1", ".sh", ".html", ".vue"]);

// 构建产物与上游二进制目录不参与检查。
const REMOVAL_EXCLUDED_PREFIXES = ["app/stage/", "app/pandoc/"];

const suffixOf = file => file.slice(file.lastIndexOf(".")).toLowerCase();

// isRemovalScope 覆盖所有不允许带本项目文件头的文件：非 Go 源码，以及第三方子树里的
// 任何源码。漏掉后者会让上游的许可声明被本项目声明覆盖。
export const isRemovalScope = file => {
    if (inThirdParty(file)) {
        return true;
    }
    return !file.startsWith("kernel/") &&
        !KEPT_NON_GO_HEADERS.has(file) &&
        REMOVAL_SUFFIXES.has(suffixOf(file)) &&
        !REMOVAL_EXCLUDED_PREFIXES.some(prefix => file.startsWith(prefix));
};

// 本项目许可头的识别特征。只认 AGPL 与本项目署名，第三方子树里的 Apache-2.0、MIT 等
// 其他 SPDX 声明不会被当成待删文件头。
const OUR_LICENSE = /SPDX-License-Identifier: AGPL-3\.0-or-later|GNU Affero General Public License|^SiYuan - |b3log\.org|SiYuan Community/m;

// listRemovalScopeFiles 返回仓库内跟踪的、不允许带本项目文件头的文件。
export const listRemovalScopeFiles = () =>
    execFileSync("git", ["ls-files", "-z"], {cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024})
        .split("\0")
        .filter(Boolean)
        .filter(isRemovalScope)
        .sort();

// planRemoval 计算该文件删除许可文件头后的内容。返回 {remove, text}：
// remove 为 true 表示首部注释组是本项目许可头，已从结果中去掉。
export const planRemoval = (file, text) => {
    const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
    const crlf = text.includes("\r\n");
    const source = (bom ? text.slice(1) : text).replace(/\r\n/g, "\n");
    const lines = source.split("\n");

    let index = lines[0] && lines[0].startsWith("#!") ? 1 : 0;
    const start = index;

    // 只取首个注释组：空行之后的内容属于说明注释，不在删除范围。
    const group = [];
    let inBlock = false;
    while (index < lines.length) {
        const line = lines[index];
        if (inBlock) {
            group.push(line);
            index++;
            if (line.includes("*/")) {
                inBlock = false;
            }
            continue;
        }
        if (line.trim() === "") {
            break;
        }
        if (line.startsWith("//") || line.startsWith("#")) {
            group.push(line);
            index++;
            continue;
        }
        if (line.startsWith("/*")) {
            group.push(line);
            index++;
            inBlock = !line.includes("*/");
            continue;
        }
        break;
    }
    if (!group.length || !OUR_LICENSE.test(group.join("\n"))) {
        return {remove: false, text};
    }

    let consumed = 0;
    while (consumed < group.length && isHeaderLine(group[consumed])) {
        consumed++;
    }
    if (0 === consumed) {
        return {remove: false, text};
    }

    // 文件头之后紧跟的空行一并去掉，避免文件以空行开头。
    let cursor = start + consumed;
    while (cursor < lines.length && lines[cursor].trim() === "") {
        cursor++;
    }

    const body = [...lines.slice(0, start), ...lines.slice(cursor)].join("\n");
    return {remove: true, text: bom + (crlf ? body.replace(/\n/g, "\r\n") : body)};
};

export const readSource = file => readFileSync(join(repoRoot, file), "utf8");
