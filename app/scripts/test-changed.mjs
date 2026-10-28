// 只运行受改动影响的前端测试，避免每次运行完整套件（本机约 8 分钟）。
//
// 测试与源码的关联有两种形态，都必须覆盖：真实的 `import`，以及大量测试用字符串路径读取源码后再转译执行
// （`load("src/x.ts")`、`readFileSync(path.join(__dirname, "../x.ts"))`）。只看 import 图会漏掉后者，
// 而漏掉的正是共享模块改动这类最容易出回归的地方。
import {execFileSync, spawnSync} from "node:child_process";
import {existsSync, readFileSync, readdirSync, statSync} from "node:fs";
import {createRequire} from "node:module";
import {availableParallelism} from "node:os";
import path from "node:path";

const appRoot = path.resolve(import.meta.dirname, "..");
// 与 scripts/test.mjs 的 glob 覆盖范围一致。
const testRoots = ["src", "tests", "electron", "scripts"];
const moduleExtensions = [".ts", ".js", ".mjs", ".scss", ".tpl"];

export const isTestFile = (file) => /\.test\.(?:ts|js|mjs)$/.test(file);

const walk = (directory) => readdirSync(directory).flatMap(name => {
    const target = path.join(directory, name);
    return statSync(target).isDirectory() ? walk(target) : [target];
});

// 取出文件里所有可能指向另一个文件的字符串：模块说明符，以及形如路径的字面量。
export const scanReferences = (text) => {
    const references = new Set();
    for (const match of text.matchAll(/(?:from|require\s*\(|import\s*\()\s*["']([^"'\n]+)["']/g)) {
        references.add(match[1]);
    }
    for (const match of text.matchAll(/["']((?:\.\.?\/)?(?:src|tests|electron|scripts)\/[^"'\n]+?\.(?:ts|js|mjs|scss|tpl))["']/g)) {
        references.add(match[1]);
    }
    return [...references];
};

// 把说明符或路径字面量解析成 app 内的绝对路径；外部模块返回 undefined。
export const resolveReference = (fromFile, reference, root = appRoot) => {
    let base;
    if (reference.startsWith(".")) {
        base = path.resolve(path.dirname(fromFile), reference);
    } else if (/^(?:src|tests|electron|scripts)\//.test(reference)) {
        base = path.resolve(root, reference);
    } else {
        return undefined;
    }
    const candidates = [base];
    for (const extension of moduleExtensions) {
        candidates.push(base + extension, path.join(base, "index" + extension));
    }
    // `./x.js` 在实际源码里可能只存在 `./x.ts`。
    if (base.endsWith(".js")) {
        candidates.push(base.replace(/\.js$/, ".ts"));
    }
    return candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile());
};

// 收集 file -> 它直接引用的文件的依赖边。
export const buildGraph = (files, root = appRoot) => {
    const edges = new Map();
    for (const file of files) {
        let text;
        try {
            text = readFileSync(file, "utf8");
        } catch {
            continue;
        }
        const targets = new Set();
        for (const reference of scanReferences(text)) {
            const resolved = resolveReference(file, reference, root);
            if (resolved && resolved !== file) {
                targets.add(resolved);
            }
        }
        edges.set(file, targets);
    }
    return edges;
};

// 从改动文件出发反向遍历，找出直接或间接引用它们的测试文件。
export const selectTests = (changedFiles, allFiles, root = appRoot) => {
    const reverse = new Map();
    for (const [file, targets] of buildGraph(allFiles, root)) {
        for (const target of targets) {
            const list = reverse.get(target) ?? [];
            list.push(file);
            reverse.set(target, list);
        }
    }
    const changed = new Set(changedFiles.map(file => path.resolve(file)));
    const selected = new Set([...changed].filter(isTestFile));
    const visited = new Set(changed);
    const queue = [...changed];
    while (queue.length > 0) {
        for (const referrer of reverse.get(queue.pop()) ?? []) {
            if (visited.has(referrer)) {
                continue;
            }
            visited.add(referrer);
            queue.push(referrer);
            if (isTestFile(referrer)) {
                selected.add(referrer);
            }
        }
    }
    return [...selected].sort();
};

export const listFiles = () => testRoots
    .map(root => path.join(appRoot, root))
    .filter(directory => existsSync(directory))
    .flatMap(walk)
    .filter(file => moduleExtensions.some(extension => file.endsWith(extension)));

const repositoryRoot = path.resolve(appRoot, "..");

const changedFiles = (base) => {
    // `git diff --name-only <base>` 覆盖已提交的分支改动，未跟踪文件需单独收集。
    const run = (arguments_) => execFileSync("git", arguments_, {cwd: repositoryRoot, encoding: "utf8"});
    const files = [
        ...run(["diff", "--name-only", base]).split("\n"),
        ...run(["ls-files", "--others", "--exclude-standard"]).split("\n"),
    ].filter(Boolean);
    return files.map(file => path.resolve(repositoryRoot, file)).filter(file => existsSync(file));
};

const main = () => {
    const arguments_ = process.argv.slice(2);
    const baseIndex = arguments_.indexOf("--base");
    const base = baseIndex >= 0 ? arguments_[baseIndex + 1] : "HEAD";
    const touched = changedFiles(base).filter(file =>
        testRoots.some(root => file.startsWith(path.join(appRoot, root) + path.sep)));
    if (touched.length === 0) {
        console.log("src/tests/electron/scripts 没有改动");
        return 0;
    }
    const selected = selectTests(touched, listFiles());
    if (selected.length === 0) {
        console.log("改动没有影响任何测试");
        return 0;
    }
    const relative = selected.map(file => path.relative(appRoot, file).replaceAll("\\", "/"));
    relative.forEach(file => console.log(file));
    if (!arguments_.includes("--run")) {
        return 0;
    }
    // 不能复用 scripts/test.mjs：它把四组 glob 无条件追加在参数之后，传文件等于跑全量。
    // 这里直接调用 node --test，但保留它在启动前安装 Electron 的前提（并行 worker 会同时解压同一运行时）。
    createRequire(import.meta.url)("electron");
    const concurrency = Math.min(4, availableParallelism());
    const result = spawnSync(process.execPath, [
        "--import", "tsx", "--test", `--test-concurrency=${concurrency}`, ...relative,
    ], {cwd: appRoot, stdio: "inherit"});
    return result.status ?? 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
    process.exitCode = main();
}
