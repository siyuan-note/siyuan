const fs = require("node:fs");
const path = require("node:path");

const exitWaitTimeout = 10 * 60 * 1000;

const isProcessAlive = pid => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // 无权查询不能视作进程已经退出。
        if (error.code === "EPERM") {
            return true;
        }
        if (error.code === "ESRCH") {
            return false;
        }
        throw error;
    }
};

const waitForPreviousWorkspaceExit = async (workspace, {
    canceled,
    onWaiting,
    readFile = file => fs.readFileSync(file, "utf8"),
    alive = isProcessAlive,
    now = Date.now,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
}) => {
    if (!workspace || canceled()) {
        return !canceled();
    }
    let marker;
    try {
        marker = JSON.parse(readFile(path.join(workspace, "temp", "kernel-exit.json")));
    } catch (error) {
        if (error.code === "ENOENT" || error instanceof SyntaxError) {
            return true;
        }
        throw error;
    }
    // 旧版、损坏或过期的状态不作为等待依据，继续由内核检查工作空间锁。
    const started = now();
    if (marker?.version !== 1 || !Number.isSafeInteger(marker.pid) || marker.pid <= 0 ||
        !Number.isSafeInteger(marker.startedAt) || marker.startedAt > started ||
        started - marker.startedAt > exitWaitTimeout || !alive(marker.pid)) {
        return true;
    }
    await onWaiting();
    // 首次确认退出后持续等待同一进程结束，避免更新确认和后续退出请求之间的短暂空隙。
    while (alive(marker.pid)) {
        if (canceled()) {
            return false;
        }
        if (now() - started >= exitWaitTimeout) {
            throw new Error("Previous workspace exit timed out");
        }
        await sleep(200);
    }
    return !canceled();
};

module.exports = {waitForPreviousWorkspaceExit};
