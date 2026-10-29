// 校验文件头规则：内核 Go 源码必须带三行文件头，其他语言的源码不得带本项目文件头。
// 纳入范围与例外在 license-header.mjs 中声明。
import {headerLines, listRemovalScopeFiles, listSourceFiles, planHeader, planRemoval, readSource} from "./license-header.mjs";

const violations = [];

for (const file of listSourceFiles()) {
    const text = readSource(file);
    const plan = planHeader(file, text);
    if (plan.action === "keep") {
        continue;
    }
    if (plan.action === "skip") {
        violations.push(`${file}：${plan.warning}`);
        continue;
    }

    // 报出第一处偏离，附上应有的三行，便于直接定位。
    const actual = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
    const detail = headerLines()
        .map((line, index) => `      期望 ${line}\n      实际 ${actual[index] ?? "(文件结束)"}`)
        .join("\n");
    violations.push(`${file}：缺少或不规范的文件头\n${detail}`);
}

for (const file of listRemovalScopeFiles()) {
    if (planRemoval(file, readSource(file)).remove) {
        violations.push(`${file}：其他语言的源码不声明本项目文件头，请删除首部许可注释`);
    }
}

if (violations.length) {
    console.error("文件头校验失败，请运行 node scripts/apply-license-headers.mjs 修正：");
    for (const violation of violations) {
        console.error("  " + violation);
    }
    console.error(`共 ${violations.length} 个文件`);
    process.exit(1);
}

console.log("文件头校验通过");
