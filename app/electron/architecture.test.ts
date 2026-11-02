// 目录级依赖方向检查。`README.md` 的「约定」一节声明了允许的方向：
// shared 不引用其他目录，kernel 只依赖 shared，remote 依赖 shared 与 kernel，
// window 可以依赖 kernel 与 remote，ipc 与 startup 可以依赖全部，只有 main.ts 负责装配。
// 新增 import 时这条测试会直接指出违规的那一条边。
import {test} from "node:test";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const electronRoot = __dirname;

const allowedDependencies: Record<string, string[]> = {
    shared: ["shared"],
    kernel: ["shared", "kernel"],
    remote: ["shared", "kernel", "remote"],
    window: ["shared", "kernel", "remote", "window"],
    ipc: ["shared", "kernel", "remote", "window", "ipc", "startup"],
    startup: ["shared", "kernel", "remote", "window", "ipc", "startup"],
    root: ["shared", "kernel", "remote", "window", "ipc", "startup", "root"],
};

// 入口文件 main.ts 位于 electron 根目录，其余文件按一级子目录归属层次。
const layerOf = (file: string): string => {
    const relative = path.relative(electronRoot, file);
    const segments = relative.split(path.sep);
    return segments.length === 1 ? "root" : segments[0];
};

const sourceFiles = (): string[] => {
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "fixtures" && entry.name !== "static" && entry.name !== "node_modules") {
                    walk(full);
                }
            } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
                files.push(full);
            }
        }
    };
    walk(electronRoot);
    return files;
};

// 注释里的示例 import 不构成依赖，先去掉行注释与块注释再提取相对说明符。
const relativeImports = (text: string): string[] => {
    const withoutComments = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const specifiers: string[] = [];
    for (const match of withoutComments.matchAll(/(?:from|require\()\s*["']([^"']+)["']/g)) {
        if (match[1].startsWith(".")) {
            specifiers.push(match[1]);
        }
    }
    return specifiers;
};

test("directory dependencies follow the documented direction", () => {
    const violations: string[] = [];
    for (const file of sourceFiles()) {
        const from = layerOf(file);
        const allowed = allowedDependencies[from];
        assert.ok(allowed, "unknown layer for " + file + ", add it to allowedDependencies");
        for (const specifier of relativeImports(fs.readFileSync(file, "utf8"))) {
            const target = path.resolve(path.dirname(file), specifier);
            // 引用 electron 目录之外（测试夹具、stage 资源）的说明符不属于目录分层。
            if (!target.startsWith(electronRoot + path.sep) && target !== electronRoot) {
                continue;
            }
            const to = layerOf(target);
            if (allowed.includes(to)) {
                continue;
            }
            violations.push(path.relative(electronRoot, file) + " -> " + to + "/ (" + specifier + ")");
        }
    }
    assert.deepEqual(violations, [], "these imports break the documented dependency direction:\n" +
        violations.join("\n"));
});
