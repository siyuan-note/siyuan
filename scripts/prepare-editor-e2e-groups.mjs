import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";

const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const hash = values => createHash("sha256").update(JSON.stringify([...values].sort(compare))).digest("hex");
const unique = (values, label) => {
    assert.equal(new Set(values).size, values.length, `Duplicate ${label}`);
};

// 只读取 Playwright 实际发现的测试，避免固定文件清单遗漏新增用例。
export function readListing(report) {
    assert.deepEqual(report.errors ?? [], [], "Playwright listing contains errors");
    assert.ok(Array.isArray(report.suites), "Missing Playwright suites");
    const tests = [];
    const visit = suite => {
        for (const spec of suite.specs ?? []) {
            for (const test of spec.tests ?? []) {
                assert.ok(spec.id && spec.file && test.projectName, "Invalid Playwright test identity");
                tests.push({
                    id: JSON.stringify([test.projectName, spec.id, spec.file]),
                    file: spec.file,
                    project: test.projectName,
                });
            }
        }
        for (const child of suite.suites ?? []) {
            visit(child);
        }
    };
    report.suites.forEach(visit);
    unique(tests.map(test => test.id), "test identities");
    assert.ok(tests.some(test => test.project === "editor"), "No editor tests discovered");
    return tests;
}

export function partitionFiles(tests, durations = {}) {
    const counts = new Map();
    for (const test of tests.filter(test => test.project === "editor")) {
        counts.set(test.file, (counts.get(test.file) ?? 0) + 1);
    }
    assert.ok(counts.size >= 2, "Two editor groups require at least two spec files");
    unique(tests.map(test => test.id), "test identities");
    for (const [file, duration] of Object.entries(durations)) {
        assert.ok(Number.isFinite(duration) && duration > 0, `Invalid duration for ${file}`);
    }
    // 新文件按历史单用例中位耗时估算；没有历史数据时按用例数均衡。
    const rates = [...counts].filter(([file]) => Object.hasOwn(durations, file))
        .map(([file, count]) => durations[file] / count).sort((left, right) => left - right);
    const fallback = rates.length ? rates[Math.floor(rates.length / 2)] : 1;
    const files = [...counts].map(([file, testCount]) => ({
        file,
        testCount,
        weight: durations[file] ?? fallback * testCount,
        estimated: !Object.hasOwn(durations, file),
    })).sort((left, right) => right.weight - left.weight || compare(left.file, right.file));
    const groups = [{files: [], weight: 0}, {files: [], weight: 0}];
    for (const file of files) {
        const group = groups[0].weight <= groups[1].weight ? groups[0] : groups[1];
        group.files.push(file);
        group.weight += file.weight;
    }
    for (const group of groups) {
        group.files.sort((left, right) => compare(left.file, right.file));
    }
    return groups;
}

export function validateGroups(original, listings, groups) {
    assert.equal(listings.length, 2, "Expected two editor listings");
    assert.equal(groups.length, 2, "Expected two editor groups");
    const expected = original.filter(test => test.project === "editor");
    const dependencies = original.filter(test => test.project !== "editor").map(test => test.id).sort(compare);
    unique(original.map(test => test.id), "original test identities");
    const combined = [];
    const files = new Set();
    listings.forEach((listing, index) => {
        unique(listing.map(test => test.id), `group ${index + 1} test identities`);
        const editor = listing.filter(test => test.project === "editor");
        assert.ok(editor.length, `Editor group ${index + 1} is empty`);
        assert.deepEqual(listing.filter(test => test.project !== "editor").map(test => test.id).sort(compare),
            dependencies, `Setup/cleanup coverage changed in group ${index + 1}`);
        const selected = groups[index].files.map(entry => entry.file).sort(compare);
        unique(selected, `group ${index + 1} files`);
        assert.deepEqual([...new Set(editor.map(test => test.file))].sort(compare), selected,
            `File selection differs in group ${index + 1}`);
        for (const file of selected) {
            assert.ok(!files.has(file), `Spec file appears in both groups: ${file}`);
            files.add(file);
        }
        const selectedSet = new Set(selected);
        assert.deepEqual(editor.map(test => test.id).sort(compare),
            expected.filter(test => selectedSet.has(test.file)).map(test => test.id).sort(compare),
            `Incomplete spec file in group ${index + 1}`);
        combined.push(...editor.map(test => test.id));
    });
    unique(combined, "editor tests across groups");
    assert.deepEqual(combined.sort(compare), expected.map(test => test.id).sort(compare),
        "Editor coverage has missing or unexpected tests");
}

export function createConfig(files, testRoot) {
    assert.ok(files.length, "Cannot create an empty editor group");
    unique(files, "config files");
    const matches = files.map(file => {
        const absolute = path.resolve(testRoot, file);
        const relative = path.relative(testRoot, absolute);
        assert.ok(relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." &&
            !path.isAbsolute(relative), `Spec file is outside test root: ${file}`);
        // 完整路径正则只匹配选中的文件，不让 glob 元字符扩大匹配范围。
        return `new RegExp(${JSON.stringify(`^${absolute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)})`;
    });
    return `// 此配置由 SiYuan 的 prepare-editor-e2e-groups.mjs 生成。\n` +
        `import focused from "./playwright.focused.config";\n\n` +
        `if (process.env.SIYUAN_E2E_SHARD !== "editor" ||\n` +
        `    focused.projects?.filter(project => project.name === "editor").length !== 1) {\n` +
        `    throw new Error("Editor group requires SIYUAN_E2E_SHARD=editor and one editor project");\n` +
        `}\n\n` +
        `export default {\n` +
        `    ...focused,\n` +
        `    projects: focused.projects.map(project => project.name === "editor" ? {\n` +
        `        ...project,\n` +
        `        testMatch: [\n            ${matches.join(",\n            ")},\n        ],\n` +
        `    } : project),\n` +
        `};\n`;
}

function listTests(root, cli, config) {
    const env = {...process.env, SIYUAN_E2E_SHARD: "editor", FORCE_COLOR: "0"};
    // 始终从标准输出解析 JSON，不受 CI 上层配置的报告输出文件影响。
    delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
    delete env.PLAYWRIGHT_JSON_OUTPUT_DIR;
    delete env.PLAYWRIGHT_JSON_OUTPUT_NAME;
    const result = spawnSync(process.execPath,
        [cli, "test", `--config=${config}`, "--list", "--reporter=json", "--workers=1"],
        {cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
    if (result.error || result.status !== 0) {
        throw new Error(`Unable to list ${config}: ${result.error?.message ?? result.stderr}\n${result.stdout}`);
    }
    const report = JSON.parse(result.stdout);
    return {report, tests: readListing(report)};
}

export function main(args) {
    assert.equal(args.length, 1, "Usage: node scripts/prepare-editor-e2e-groups.mjs <testing-repo>");
    const root = path.resolve(args[0]);
    const require = createRequire(path.join(root, "package.json"));
    const cli = require.resolve("@playwright/test/cli");
    const baseline = listTests(root, cli, "config/playwright.focused.config.ts");
    const history = JSON.parse(readFileSync(new URL("editor-e2e-durations.json", import.meta.url), "utf8"));
    const groups = partitionFiles(baseline.tests, history.durationsMs);
    const listings = groups.map((group, index) => {
        group.config = `config/playwright.editor-group-${index + 1}.config.ts`;
        writeFileSync(path.join(root, group.config),
            createConfig(group.files.map(entry => entry.file), baseline.report.config.rootDir));
        return listTests(root, cli, group.config).tests;
    });
    validateGroups(baseline.tests, listings, groups);
    const editor = baseline.tests.filter(test => test.project === "editor");
    const manifest = {
        durationSource: history.source,
        weightUnit: groups.some(group => group.files.some(file => !file.estimated)) ? "estimated milliseconds" : "test count",
        testCount: editor.length,
        fileCount: new Set(editor.map(test => test.file)).size,
        testsSha256: hash(editor.map(test => test.id)),
        groups: groups.map((group, index) => ({
            group: index + 1,
            config: group.config,
            weight: group.weight,
            testCount: group.files.reduce((total, file) => total + file.testCount, 0),
            testsSha256: hash(listings[index].filter(test => test.project === "editor").map(test => test.id)),
            files: group.files,
        })),
    };
    writeFileSync(path.join(root, "editor-e2e-groups.json"), JSON.stringify(manifest, null, 2) + "\n");
    for (const group of manifest.groups) {
        console.log(`editor-${group.group}: ${group.files.length} files, ${group.testCount} tests, ` +
            `weight ${Math.round(group.weight)}; ${group.testsSha256}`);
    }
    console.log(`Editor coverage verified: ${manifest.fileCount} files, ${editor.length} tests; ${manifest.testsSha256}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
