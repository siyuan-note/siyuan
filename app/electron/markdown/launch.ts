import * as path from "node:path";
import {fileURLToPath} from "node:url";

export type MarkdownLaunch = {requested: boolean; files: string[]; newDocument: boolean};

const isMarkdownPath = (value: unknown): value is string => typeof value === "string" && /\.(?:md|markdown)$/i.test(value);

// 仅解释文件入口，不把工作空间参数中的 .md 或网页地址误当成本机文件。
const parseMarkdownLaunch = (argv: string[], cwd: string,
    {startIndex = 0, platform = process.platform}: {startIndex?: number; platform?: NodeJS.Platform} = {}): MarkdownLaunch => {
    const paths = platform === "win32" ? path.win32 : path.posix;
    const files: string[] = [];
    const seen = new Set<string>();
    let requested = false;
    let newDocument = false;
    let positional = false;
    const add = (raw: string): void => {
        let file = raw;
        if (/^file:/i.test(file)) {
            try {
                file = fileURLToPath(file, {windows: platform === "win32"});
            } catch {
                return;
            }
        }
        if (!isMarkdownPath(file) || /^[a-z][\w+.-]*:\/\//i.test(file)) return;
        const resolved = paths.resolve(cwd, file);
        const key = platform === "win32" ? resolved.toLowerCase() : resolved;
        if (!seen.has(key)) {
            seen.add(key);
            files.push(resolved);
        }
    };
    for (let index = startIndex; index < argv.length; index++) {
        const argument = argv[index];
        if (typeof argument !== "string") continue;
        if (!positional && argument === "--") {
            positional = true;
            continue;
        }
        if (!positional && (argument === "--markdown" || argument.startsWith("--markdown="))) {
            requested = true;
            const value = argument === "--markdown" ? "" : argument.slice("--markdown=".length);
            if (value) {
                add(value);
            } else if (argument === "--markdown" && typeof argv[index + 1] === "string" &&
                !argv[index + 1].startsWith("-") && isMarkdownPath(argv[index + 1])) {
                add(argv[++index]);
            } else {
                newDocument = true;
            }
            continue;
        }
        if (!positional && argument.startsWith("-")) continue;
        if (isMarkdownPath(argument)) {
            const before = files.length;
            add(argument);
            if (files.length > before) requested = true;
        }
    }
    // 明确要求轻量入口但路径无效时仍进入空白编辑器，由用户重新选择文件。
    return {requested, files, newDocument: requested && (newDocument || files.length === 0)};
};

export {isMarkdownPath, parseMarkdownLaunch};
