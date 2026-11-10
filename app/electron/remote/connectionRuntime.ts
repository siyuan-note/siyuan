// 连接管理器的组装。运行期状态读取、可信发送方判定与切换连接后的重启编排集中在这里，
// 创建时登记为进程内单例，远端启动与错误窗口都从这份登记取用。
import * as path from "node:path";
import {app, BrowserWindow} from "electron";
import {paths, state, isSystemShuttingDown, writeLog as defaultWriteLog} from "../shared/runtime";
import {setRemoteErrorPresenter} from "../shared/errorWindow";
import {APP_PAGE, WINDOW_PAGE} from "../shared/pagePaths";
import {createConnectionManager} from "./connectionManager";
import {closeConnectionWindows, connectionArgs} from "./connectionStore";
import type {KernelTarget} from "../shared/types";

type ConnectionManager = ReturnType<typeof createConnectionManager>;

let connectionManager: ConnectionManager | undefined;

const getConnectionManager = (): ConnectionManager | undefined => connectionManager;

const createConnectionRuntime = ({
    launchArguments, getWindowPathname, getWindowKernelTarget,
}: {
    /** 本次进程的启动参数，不含可执行文件本身。 */
    launchArguments: string[];
    /** 窗口页面路径。由入口注入，remote 目录因此不引用 window 目录。 */
    getWindowPathname: (window: BrowserWindow | null) => string;
    /** 窗口所属的内核目标。 */
    getWindowKernelTarget: (webContentsId: number) => KernelTarget | undefined;
}): ConnectionManager => {
    const manager = createConnectionManager({
        confDir: paths.confDir,
        languageDir: path.join(paths.appDir, "appearance", "langs"),
        version: paths.appVer,
        currentTarget: () => state.startup.remoteKernelTarget,
        // 只接受主窗口顶层框架的请求，切换连接会重启全部工作空间。
        isTrustedDialogSender: (event) =>
            event.senderFrame === event.sender.mainFrame &&
            !!getWindowKernelTarget(event.sender.id) &&
            getWindowPathname(BrowserWindow.fromWebContents(event.sender)) === APP_PAGE,
        log: defaultWriteLog,
        restart: async (target) => {
            // 关机、更新安装或上一次切换尚未完成时忽略重入。
            if (state.exit.pendingConnectionArgs || state.exit.updateInstall || isSystemShuttingDown()) {
                return;
            }
            state.exit.pendingConnectionArgs = connectionArgs(launchArguments, target,
                state.startup.remoteKernelTarget?.origin || "");
            try {
                await closeConnectionWindows(BrowserWindow.getAllWindows().filter(window =>
                    !!getWindowKernelTarget(window.webContents.id) &&
                    getWindowPathname(window) === WINDOW_PAGE));
            } catch (error) {
                state.exit.pendingConnectionArgs = undefined;
                throw error;
            }
            // 先通过现有保存与退出流程关闭全部工作空间，最后一个窗口退出后再安排重启。
            app.quit();
        },
    });
    connectionManager = manager;
    // 远端模式下的启动失败与连接错误由连接管理窗口展示。
    setRemoteErrorPresenter((options) => manager.show(options));
    return manager;
};

export {createConnectionRuntime, getConnectionManager};
