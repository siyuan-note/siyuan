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
import ts from "typescript";

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
    for (const match of text.matchAll(/["']((?:(?:\.\.?\/)+)?[^"'\n:*?<>|]+?\.(?:ts|js|mjs|scss|tpl))["']/g)) {
        references.add(match[1]);
    }
    return [...references];
};

export const scanReferenceDetails = (text, file = "source.ts") => {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    if (source.parseDiagnostics.length > 0 || !/\.(?:ts|js|mjs)$/.test(file)) {
        return scanReferences(text).map(reference => ({reference, kind: "unknown"}));
    }
    const result = [];
    const classified = [];
    const add = (node, kind) => {
        if (node && ts.isStringLiteralLike(node)) {
            result.push({reference: node.text, kind});
            classified.push(node);
        }
    };
    const visit = node => {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            add(node.moduleSpecifier, file.endsWith(".ts") && (node.isTypeOnly || node.importClause?.isTypeOnly) ? "type" : "runtime");
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
            add(node.moduleReference.expression, file.endsWith(".ts") && node.isTypeOnly ? "type" : "runtime");
        } else if (ts.isCallExpression(node) &&
            (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
            add(node.arguments[0], "runtime");
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    // 只屏蔽已分类的说明符，其余嵌入源码、模板和路径字符串仍按保守规则识别。
    let remaining = text;
    for (const node of classified.sort((a, b) => b.pos - a.pos)) {
        remaining = remaining.slice(0, node.getStart(source)) + " ".repeat(node.end - node.getStart(source)) + remaining.slice(node.end);
    }
    for (const reference of scanReferences(remaining)) {
        result.push({reference, kind: "source"});
    }
    return result;
};

// 把说明符或路径字面量解析成 app 内的绝对路径；外部模块返回 undefined。
export const resolveReference = (fromFile, reference, root = appRoot, knownFiles = new Set()) => {
    let base;
    if (reference.startsWith(".")) {
        base = path.resolve(path.dirname(fromFile), reference);
    } else if (/^(?:src|tests|electron|scripts)\//.test(reference)) {
        base = path.resolve(root, reference);
    } else if (moduleExtensions.some(extension => reference.endsWith(extension)) && !reference.includes("/")) {
        // path.join(__dirname, "source.ts") 以测试所在目录为基准。
        base = path.resolve(path.dirname(fromFile), reference);
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
    return candidates.find(candidate => knownFiles.has(candidate) ||
        (existsSync(candidate) && statSync(candidate).isFile()));
};

// 收集 file -> 它直接引用的文件的依赖边。
export const buildGraph = (files, root = appRoot, knownFiles = new Set(files)) => {
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
            const resolved = resolveReference(file, reference, root, knownFiles);
            if (resolved && resolved !== file) {
                targets.add(resolved);
            }
        }
        edges.set(file, targets);
    }
    return edges;
};

export const buildClassifiedGraph = (files, root = appRoot, knownFiles = new Set(files)) => {
    const edges = new Map();
    for (const file of files) {
        let text;
        try {
            text = readFileSync(file, "utf8");
        } catch {
            continue;
        }
        const targets = [];
        for (const {reference, kind} of scanReferenceDetails(text, file)) {
            const target = resolveReference(file, reference, root, knownFiles);
            if (target && target !== file) {
                targets.push({target, kind});
            }
        }
        edges.set(file, targets);
    }
    return edges;
};

// 从改动文件出发反向遍历，找出直接或间接引用它们的测试文件。
export const selectTests = (changedFiles, allFiles, root = appRoot, reasons = new Map(), details = {}) => {
    details.paths = new Map();
    details.typeOnlyTests = new Map();
    details.typecheck = false;
    const changed = new Set(changedFiles.map(file => path.resolve(file)));
    // 依赖与转译配置影响所有测试，不能仅靠源码引用图推导。
    if ([...changed].some(file => path.dirname(file) === root &&
        (/^tsconfig(?:\..+)?\.json$/.test(path.basename(file)) ||
            ["package.json", "pnpm-lock.yaml"].includes(path.basename(file))))) {
        const tests = allFiles.filter(isTestFile).sort();
        tests.forEach(file => reasons.set(file, "dependency or TypeScript configuration changed (full selection)"));
        return tests;
    }
    const reverse = new Map();
    // 删除的源文件也保留依赖边，避免删除操作被误报为没有受影响的测试。
    for (const [file, targets] of buildClassifiedGraph(allFiles, root, new Set([...allFiles, ...changed]))) {
        for (const {target, kind} of targets) {
            const list = reverse.get(target) ?? [];
            list.push({file, kind});
            reverse.set(target, list);
        }
    }
    const selected = new Set([...changed].filter(file => isTestFile(file) && existsSync(file)));
    selected.forEach(file => reasons.set(file, [file]));
    const visited = new Set([...changed].map(file => `${file}:0`));
    const queue = [...changed].map(file => ({file, flags: 0, chain: [file], kinds: []}));
    // 源码读取可能检查类型文本或生成声明，因此保留含类型边的完整依赖路径。
    while (queue.length > 0) {
        const current = queue.shift();
        for (const {file: referrer, kind} of reverse.get(current.file) ?? []) {
            const flags = current.flags | (kind === "type" ? 1 : 0) | (kind === "source" || kind === "unknown" ? 2 : 0);
            details.typecheck ||= (flags & 1) !== 0;
            const key = `${referrer}:${flags}`;
            if (visited.has(key)) {
                continue;
            }
            visited.add(key);
            const chain = [...current.chain, referrer];
            const kinds = [...current.kinds, kind];
            queue.push({file: referrer, flags, chain, kinds});
            if (isTestFile(referrer) && flags === 1 && !details.typeOnlyTests.has(referrer)) {
                details.typeOnlyTests.set(referrer, {chain, kinds});
            }
            if (isTestFile(referrer) && (!(flags & 1) || (flags & 2)) && !selected.has(referrer)) {
                selected.add(referrer);
                reasons.set(referrer, chain);
                details.paths.set(referrer, kinds);
            }
        }
    }
    for (const file of selected) {
        details.typeOnlyTests.delete(file);
    }
    return [...selected].sort();
};

export const listFiles = () => testRoots
    .map(root => path.join(appRoot, root))
    .filter(directory => existsSync(directory))
    .flatMap(walk)
    .filter(file => moduleExtensions.some(extension => file.endsWith(extension)));

const repositoryRoot = path.resolve(appRoot, "..");

export const changedFiles = (base, root = repositoryRoot) => {
    // `git diff --name-only <base>` 覆盖已提交的分支改动，未跟踪文件需单独收集。
    const run = (arguments_) => execFileSync("git", arguments_, {cwd: root, encoding: "utf8"});
    const files = [
        ...run(["diff", "--name-only", "--no-renames", "-z", base, "--"]).split("\0"),
        ...run(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
    ].filter(Boolean);
    return files.map(file => path.resolve(root, file));
};

export const parseArguments = arguments_ => {
    const options = {base: "HEAD", run: false, explain: false};
    for (let index = 0; index < arguments_.length; index++) {
        const argument = arguments_[index];
        if (argument === "--run") {
            options.run = true;
        } else if (argument === "--explain") {
            options.explain = true;
        } else if (argument === "--base" && arguments_[index + 1] && !arguments_[index + 1].startsWith("-")) {
            options.base = arguments_[++index];
        } else {
            throw new Error(`Unknown argument or missing value: ${argument}`);
        }
    }
    return options;
};

const main = () => {
    const arguments_ = process.argv.slice(2);
    const {base, run, explain} = parseArguments(arguments_);
    const touched = changedFiles(base).filter(file =>
        file.startsWith(appRoot + path.sep));
    if (touched.length === 0) {
        console.error("app/ 没有改动；未运行测试");
        return 0;
    }
    const reasons = new Map();
    const details = {};
    const selected = selectTests(touched, listFiles(), appRoot, reasons, details);
    console.error(`基准 ${base}；改动 ${touched.length} 个文件；选中 ${selected.length} 个测试文件`);
    if (details.typecheck) {
        console.error("类型依赖受影响；test:affected 将先执行完整 typecheck");
    }
    if (selected.length === 0 && !details.typecheck) {
        console.error("未找到关联测试；未运行测试，不代表已确认没有影响");
        return 0;
    }
    const relative = selected.map(file => path.relative(appRoot, file).replaceAll("\\", "/"));
    relative.forEach(file => console.log(file));
    if (explain) {
        for (const file of selected) {
            const reason = reasons.get(file);
            const kinds = details.paths.get(file) ?? [];
            const chain = Array.isArray(reason) ? reason.map((item, index) =>
                `${index ? ` -[${kinds[index - 1] ?? "changed"}]-> ` : ""}${path.relative(appRoot, item)}`).join("") : reason;
            console.error(`${path.relative(appRoot, file)}: ${chain}`);
        }
        for (const [file, {chain, kinds}] of details.typeOnlyTests) {
            console.error(`${path.relative(appRoot, file)} [typecheck only]: ${chain.map((item, index) =>
                `${index ? ` -[${kinds[index - 1]}]-> ` : ""}${path.relative(appRoot, item)}`).join("")}`);
        }
    }
    if (!run) {
        return 0;
    }
    if (details.typecheck) {
        const result = spawnSync("pnpm", ["--config.verify-deps-before-run=false", "run", "typecheck"],
            {cwd: appRoot, stdio: "inherit", shell: process.platform === "win32"});
        if (result.status !== 0) {
            return result.status ?? 1;
        }
    }
    if (selected.length === 0) {
        return 0;
    }
    // 不能复用 scripts/test.mjs：它把四组 glob 无条件追加在参数之后，传文件等于跑全量。
    // 这里直接调用 node --test，但保留它在启动前安装 Electron 的前提（并行 worker 会同时解压同一运行时）。
    createRequire(import.meta.url)("electron");
    const concurrency = Math.min(4, availableParallelism());
    const result = spawnSync(process.execPath, [
        "--import", "tsx", "--experimental-test-module-mocks", "--test", `--test-concurrency=${concurrency}`,
        ...relative,
    ], {cwd: appRoot, stdio: "inherit"});
    return result.status ?? 1;
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
    process.exitCode = main();
}
