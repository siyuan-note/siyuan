import {test} from "node:test";
import {describeKernelExit} from "./kernelExitCodes";
const assert = require("node:assert/strict");

test("expected exits and clean exit codes need no user-facing report", () => {
    for (const options of [{}, {expectedExit: true}, {expectedExit: true, port: "6806"}]) {
        assert.equal(describeKernelExit(0, options).kind, "ignore");
    }
    assert.equal(describeKernelExit(20, {expectedExit: true}).kind, "ignore");
    assert.equal(describeKernelExit(24, {expectedExit: true}).kind, "ignore");
});

test("a workspace lock conflict is left to the caller's locked prompt", () => {
    // 24 的标题与正文由调用方的 showWorkspaceLocked 提供，无论内核是否已经启动。
    const locked = describeKernelExit(24, {});
    assert.equal(locked.kind, "locked");
    assert.equal(locked.content, undefined);
});

test("known failure codes keep their titles and log locations", () => {
    const database = describeKernelExit(20, {});
    assert.equal(database.kind, "error");
    assert.equal(database.titleZh, "数据库不可用");
    assert.equal(database.logSource, "workspace");

    // 调用方在 kernelBoot 里传的是 kernelPort.toString()，端口按字符串给出。
    const port = describeKernelExit(21, {port: "6806"});
    assert.equal(port.titleZh, "监听端口 6806 失败");
    assert.equal(port.titleEn, "Failed to listen to port 6806");
    assert.match(port.content, /6806/);

    const workspace = describeKernelExit(25, {});
    assert.equal(workspace.titleZh, "初始化工作空间失败");
    assert.equal(workspace.logSource, "kernel");

    const filesystem = describeKernelExit(26, {});
    assert.equal(filesystem.titleZh, "文件系统访问失败");
    assert.equal(filesystem.logSource, "workspace");
});

test("unknown non-zero codes report the exit code without a log location", () => {
    for (const code of [1, 17, 99, -1]) {
        const report = describeKernelExit(code, {});
        assert.equal(report.kind, "error");
        assert.equal(report.titleZh, "内核因未知原因退出");
        assert.match(report.content, new RegExp(`\\[code=${code}\\]`));
        assert.equal(report.logSource, undefined);
    }
});
