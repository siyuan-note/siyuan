import {spawnSync} from "node:child_process";
import {availableParallelism} from "node:os";

// 按可用核心数并行执行，限制上限以避免多个 Electron 子进程耗尽运行资源。
const concurrency = Math.min(4, availableParallelism());
// 运行参数放在测试路径之前，支持通过命令行覆盖并发度及筛选用例。
const result = spawnSync(process.execPath, [
    "--import", "tsx", "--test", `--test-concurrency=${concurrency}`,
    ...process.argv.slice(2),
    "src/**/*.test.ts", "tests/**/*.test.js", "electron/**/*.test.js", "scripts/**/*.test.js",
], {stdio: "inherit"});
if (result.error) {
    throw result.error;
}
if (result.signal) {
    process.kill(process.pid, result.signal);
} else {
    process.exitCode = result.status;
}
