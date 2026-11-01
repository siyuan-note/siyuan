const path = require("node:path");
const {fileURLToPath} = require("node:url");

const isMarkdownPath = value => typeof value === "string" && /\.(?:md|markdown)$/i.test(value);

// 仅解释文件入口，不把工作空间参数中的 .md 或网页地址误当成本机文件。
const parseMarkdownLaunch = (argv, cwd, {startIndex = 0, platform = process.platform} = {}) => {
    const paths = platform === "win32" ? path.win32 : path.posix;
    const files = [];
    const seen = new Set();
    let requested = false;
    let newDocument = false;
    let positional = false;
    const add = raw => {
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

module.exports = {isMarkdownPath, parseMarkdownLaunch};
