import type {Session} from "electron";
import * as timing from "../shared/timing";
import type {KernelTarget, LogFunction, Workspace} from "../shared/types";

// 桌面端系统休眠唤醒后判断网络连通性后再执行数据同步 https://github.com/siyuan-note/siyuan/issues/6687
// 每个工作空间使用各自的会话：本地内核跟随重定向并携带默认会话，远端内核手动处理重定向并绕过自定义协议。
const syncAfterResume = async ({writeLog, isOnline, sleep = timing.sleep, workspaces, session,
    getRemoteSession}: {
        writeLog: LogFunction;
        isOnline: () => Promise<boolean> | boolean;
        sleep?: (ms: number) => Promise<unknown>;
        workspaces: Workspace[];
        session: {defaultSession: Session};
        getRemoteSession: (target: KernelTarget) => Session;
    }): Promise<void> => {
    let online = false;
    for (let i = 0; i < 7; i++) {
        if (await isOnline()) {
            online = true;
            break;
        }

        writeLog("network is offline");
        await sleep(1000);
    }

    if (!online) {
        writeLog("network is offline, do not sync after system resume");
        return;
    }

    await Promise.all(workspaces.map(async (item: Workspace) => {
        const server = item.kernelTarget.origin;
        writeLog("sync after system resume [" + server + "/api/sync/performSync" + "]");
        try {
            const response = await (item.ownsKernel ? session.defaultSession : getRemoteSession(item.kernelTarget)).fetch(server + "/api/sync/performSync", {
                method: "POST",
                credentials: "include",
                bypassCustomProtocolHandlers: !item.ownsKernel,
                redirect: item.ownsKernel ? "follow" : "manual",
            });
            if (!response.ok) {
                writeLog("sync after system resume rejected [HTTP " + response.status + "]");
            }
        } catch {
            writeLog("sync after system resume request failed");
        }
    }));
};

export {syncAfterResume};
