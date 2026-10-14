import {spawnSync} from "node:child_process";
import {availableParallelism} from "node:os";
import {createRequire} from "node:module";

// 在启动并行测试前完成 Electron 安装，避免多个子进程同时解压同一运行时。
createRequire(import.meta.url)("electron");

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
