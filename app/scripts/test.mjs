import {spawnSync} from "node:child_process";
import {availableParallelism} from "node:os";
import {createRequire} from "node:module";

// 在启动并行测试前完成 Electron 安装，避免多个子进程同时解压同一运行时。
createRequire(import.meta.url)("electron");

// 按可用核心数并行执行，限制上限以避免多个 Electron 子进程耗尽运行资源。
const concurrency = Math.min(4, availableParallelism());
// --experimental-test-module-mocks 供 electron 替身使用：纯 Node 下 require("electron") 只得到可执行文件路径，
// 主进程模块因此靠 `t.mock.module` 把这个依赖换掉，见 electron/fixtures/electronStub.ts。
const result = spawnSync(process.execPath, [
    "--import", "tsx", "--experimental-test-module-mocks", "--test",
    `--test-concurrency=${concurrency}`,
    ...process.argv.slice(2),
    "src/**/*.test.ts", "tests/**/*.test.js", "electron/**/*.test.ts",
    "scripts/**/*.test.js",
], {stdio: "inherit"});
if (result.error) {
    throw result.error;
}
if (result.signal) {
    process.kill(process.pid, result.signal);
} else {
    process.exitCode = result.status;
}
