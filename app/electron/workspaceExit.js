const fs = require("node:fs");
const path = require("node:path");

const exitWaitTimeout = 10 * 60 * 1000;

const validMarker = (marker, now) => marker && [1, 2].includes(marker.version) &&
    Number.isSafeInteger(marker.pid) && marker.pid > 0 && Number.isSafeInteger(marker.startedAt) &&
    marker.startedAt > 0 && marker.startedAt <= now && (marker.version === 2 || now - marker.startedAt <= exitWaitTimeout);

// 认证材料只发送到标记中的本机端口；内核还会核对进程、退出批次及活动会话。
const requestWorkspaceExitRecovery = async (workspace, marker, signal, fetch, readFile = fs.readFileSync) => {
    if (marker.version !== 2 || !/^\d{1,5}$/.test(marker.port) || Number(marker.port) < 1 || Number(marker.port) > 65535) {
        throw new Error("Invalid workspace exit port");
    }
    const config = JSON.parse(readFile(path.join(workspace, "conf", "conf.json"), "utf8"));
    const headers = {"Content-Type": "application/json"};
    if (config.api?.token) {
        headers.Authorization = "Token " + config.api.token;
    } else if (config.accessAuthCode) {
        headers.Authorization = "Basic " + Buffer.from(path.basename(workspace) + ":" + config.accessAuthCode).toString("base64");
    }
    const response = await fetch(`https://127.0.0.1:${Number(marker.port)}/api/system/exit`, {
        method: "POST", headers, signal, credentials: headers.Authorization ? "omit" : "include", redirect: "error",
        body: JSON.stringify({recoverExit: {pid: marker.pid, startedAt: marker.startedAt}}),
    });
    if (!response.ok) {
        throw new Error("Workspace exit recovery request rejected");
    }
    const result = await response.json();
    if (![0, 1, 3].includes(result.code)) {
        throw new Error("Workspace exit recovery no longer matches");
    }
    return result.code;
};

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
    recover,
    hasActiveWindow = () => false,
    onRecoveryFailed = async () => false,
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
    let started = now();
    if (!validMarker(marker, started) || !alive(marker.pid)) {
        return true;
    }
    await onWaiting();
    const controller = new AbortController();
    let pending;
    let result;
    let nextRecovery = now() + 1000;
    let completedBatch;
    try {
        // 持续读取同一进程的退出阶段，接管不再有窗口处理的更新确认或同步失败。
        while (alive(marker.pid)) {
            if (canceled()) {
                return false;
            }
            if (now() - started >= exitWaitTimeout) {
                throw new Error("Previous workspace exit timed out");
            }
            if (result) {
                const finished = result;
                result = undefined;
                pending = undefined;
                nextRecovery = now() + 1000;
                if (finished.code === 0) {
                    completedBatch = finished.startedAt;
                } else if (finished.error || finished.code === 1) {
                    if (!await onRecoveryFailed(finished.code === 1)) {
                        return false;
                    }
                    started = now();
                }
            }
            if (!pending && recover && !hasActiveWindow() && now() >= nextRecovery) {
                let current;
                try {
                    current = JSON.parse(readFile(path.join(workspace, "temp", "kernel-exit.json")));
                } catch (error) {
                    if (error.code !== "ENOENT") throw error;
                }
                if (current && (!validMarker(current, now()) || current.pid !== marker.pid)) {
                    throw new Error("Workspace exit owner changed");
                }
                if (current?.version === 2 && current.phase === "waiting" && current.startedAt !== completedBatch &&
                    !canceled() && alive(marker.pid)) {
                    pending = Promise.resolve().then(() => recover(current, controller.signal)).then(code => {
                        result = {code, startedAt: current.startedAt};
                    }, () => { result = {error: true}; });
                }
            }
            await sleep(200);
        }
        return !canceled();
    } finally {
        controller.abort();
    }
};

module.exports = {waitForPreviousWorkspaceExit, requestWorkspaceExitRecovery};
