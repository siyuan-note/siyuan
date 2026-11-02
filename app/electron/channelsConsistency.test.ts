// 通道名在三处出现：主进程 `electron/shared/channels.ts`、渲染进程 `src/constants.ts` 的 `Constants`、
// 启动页脚本 `electron/static/*.html|js`。本测试守住三处不漂移：主进程不再写字面量，
// 前端常量与启动页脚本引用到的通道都必须在通道表里。改名时测试会直接指出漏改的那一侧。
import {test} from "node:test";
import {Channel} from "./shared/channels";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const electronRoot = __dirname;
const appRoot = path.join(__dirname, "..");
const channelsFile = path.join(electronRoot, "shared", "channels.ts");
const staticDir = path.join(electronRoot, "static");

// 这三个字符串不是 IPC 通道：前两个是会话分区名，最后一个是设置窗口的 frameName 前缀。
const nonChannelLiterals = new Set(["siyuan-connection-manager", "siyuan-web-fetch-", "siyuan-settings-"]);

// 从源码读出的字面量是普通字符串，因此集合按 string 归纳，而不是 Channel 的字面量联合类型。
const channelValues: Set<string> = new Set(Object.values(Channel));

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

const collectLiterals = (text: string): {value: string; line: number}[] => {
    const found: {value: string; line: number}[] = [];
    // 同时接受单引号和双引号，注释里的反引号引用不算通道定义。
    for (const match of text.matchAll(/["'](siyuan-[a-z0-9-]+)["']/g)) {
        found.push({value: match[1], line: lineOf(text, match.index ?? 0)});
    }
    return found;
};

const mainProcessFiles = (): string[] => {
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "fixtures" && entry.name !== "static") {
                    walk(full);
                }
            } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && full !== channelsFile) {
                files.push(full);
            }
        }
    };
    walk(electronRoot);
    return files;
};

test("main process uses the channel table instead of literals", () => {
    const offenders: string[] = [];
    for (const file of mainProcessFiles()) {
        for (const {value, line} of collectLiterals(fs.readFileSync(file, "utf8"))) {
            if (nonChannelLiterals.has(value)) {
                continue;
            }
            offenders.push(path.relative(electronRoot, file) + ":" + line + " " + value);
        }
    }
    assert.deepEqual(offenders, [], "import Channel from shared/channels instead of writing the literal:\n" +
        offenders.join("\n"));
});

test("renderer channel constants exist in the channel table", () => {
    const source = fs.readFileSync(path.join(appRoot, "src", "constants.ts"), "utf8");
    const missing: string[] = [];
    for (const match of source.matchAll(/SIYUAN_[A-Z0-9_]+\s*:?\s*(?:string\s*)?=\s*"(siyuan-[a-z0-9-]+)"/g)) {
        if (!channelValues.has(match[1])) {
            missing.push(match[1] + " (" + lineOf(source, match.index ?? 0) + ")");
        }
    }
    assert.deepEqual(missing, [], "renderer constants are missing from shared/channels.ts:\n" + missing.join("\n"));
});

test("boot page scripts only reference known channels", () => {
    const missing: string[] = [];
    for (const name of fs.readdirSync(staticDir)) {
        if (!/\.(html|js)$/.test(name)) {
            continue;
        }
        const text = fs.readFileSync(path.join(staticDir, name), "utf8");
        for (const {value, line} of collectLiterals(text)) {
            if (!channelValues.has(value) && !nonChannelLiterals.has(value)) {
                missing.push(name + ":" + line + " " + value);
            }
        }
    }
    assert.deepEqual(missing, [], "boot pages reference channels that are not declared:\n" + missing.join("\n"));
});

test("channel values are unique", () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const [name, value] of Object.entries(Channel)) {
        if (seen.has(value)) {
            duplicates.push(value + " (" + seen.get(value) + ", " + name + ")");
        }
        seen.set(value, name);
    }
    assert.deepEqual(duplicates, [], "two channel constants share one value:\n" + duplicates.join("\n"));
});
