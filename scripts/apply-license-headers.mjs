// 按统一规则处理文件头：内核 Go 源码补上三行文件头，其他语言的源码删掉既有文件头。
// 幂等：已符合的文件不会被改写。
import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {
    listRemovalScopeFiles, listSourceFiles, planHeader, planRemoval, readSource, repoRoot,
} from "./license-header.mjs";

const dryRun = process.argv.includes("--dry-run");

const summary = {insert: [], rewrite: [], keep: [], skip: [], remove: []};

for (const file of listSourceFiles()) {
    const text = readSource(file);
    const plan = planHeader(file, text);
    summary[plan.action].push(plan.action === "skip" ? {file, warning: plan.warning} : {file});
    if (plan.action === "keep" || plan.action === "skip") {
        continue;
    }
    if (!dryRun) {
        writeFileSync(join(repoRoot, file), plan.text, "utf8");
    }
}

for (const file of listRemovalScopeFiles()) {
    const text = readSource(file);
    const plan = planRemoval(file, text);
    if (!plan.remove) {
        continue;
    }
    summary.remove.push({file});
    if (!dryRun) {
        writeFileSync(join(repoRoot, file), plan.text, "utf8");
    }
}

console.log(dryRun ? "=== 试运行，未写入任何文件 ===" : "=== 已写入 ===");
for (const action of ["insert", "rewrite", "remove", "keep", "skip"]) {
    console.log(`${action.padEnd(10)}${summary[action].length}`);
}

for (const action of ["insert", "rewrite", "remove", "keep"]) {
    if (!summary[action].length) {
        continue;
    }
    console.log(`\n=== ${action}（${summary[action].length}）===`);
    for (const item of summary[action]) {
        console.log("  " + item.file);
    }
}

if (summary.skip.length) {
    console.log(`\n=== 需人工确认（${summary.skip.length}）===`);
    for (const item of summary.skip) {
        console.log(`  ${item.file}\n      ${item.warning}`);
    }
    process.exitCode = 1;
}
