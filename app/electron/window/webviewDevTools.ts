import * as electron from "electron";
import {isDevToolsShortcut, toggleDevTools} from "./devToolsDock";
import {getWindowKernelTarget} from "./windowRegistry";
import {openExternalURL} from "./windowNavigation";
import type {
    Event as ElectronEvent,
    HandlerDetails,
    Input,
    WebContents,
    WindowOpenHandlerResponse,
} from "electron";
import type {KernelTarget} from "../shared/types";

const bindWebviewDevToolsShortcut = (contents: WebContents,
    getTarget: (webContentsId: number) => KernelTarget | undefined = getWindowKernelTarget,
    platform = process.platform): void => {
    if (contents.isDestroyed() || contents.getType() !== "webview") return;
    const onInput = (event: ElectronEvent, input: Input): void => {
        if (input.type !== "keyDown") return;
        if (!isDevToolsShortcut(input, platform)) return;
        try {
            // 每次按键都从 Electron 读取实际宿主，避免挂载前或销毁后的 guest 指向其他窗口。
            if (contents.isDestroyed()) return;
            const host = contents.hostWebContents;
            if (!host || host.isDestroyed() || host.getType() !== "window" || !getTarget(host.id)) return;
            // 主进程同步阻止 guest 和菜单处理同一按键；长按时仍拦截，但只切换一次。
            event.preventDefault();
            if (!input.isAutoRepeat) toggleDevTools(host, platform);
        } catch {
            // guest 或宿主可能已在窗口关闭过程中销毁。
        }
    };
    contents.on("before-input-event", onInput);
    contents.once("destroyed", () => contents.removeListener("before-input-event", onInput));
};

// 新窗口策略：设置窗口由 settingsWindowPolicy 接管，远端内核一律外部打开，其余链接交给系统浏览器。
type WebContentsCreatedHost = {
    settingsWindowPolicy: (contents: WebContents,
        details: HandlerDetails) => WindowOpenHandlerResponse | undefined;
    /** 交给系统浏览器的通道，默认取 Electron 的 shell。 */
    shell?: {openExternal: (url: string) => Promise<void>};
};

// Electron 的窗口打开结果只有 allow 与 deny，未返回任何值才是「交回默认处理」，因此这里用具名常量表达。
// 本地 file: 前台页签依赖默认处理打开 https://github.com/siyuan-note/siyuan/issues/10567
const ELECTRON_DEFAULT_WINDOW_OPEN = undefined as unknown as WindowOpenHandlerResponse;

const handleWebContentsCreated = (event: ElectronEvent, contents: WebContents,
    {settingsWindowPolicy, shell = electron.shell}: WebContentsCreatedHost): void => {
    bindWebviewDevToolsShortcut(contents);
    contents.setWindowOpenHandler((details: HandlerDetails): WindowOpenHandlerResponse => {
        const settings = settingsWindowPolicy(contents, details);
        if (settings) {
            return settings;
        }
        const kernelTarget = getWindowKernelTarget(contents.id);
        if (kernelTarget?.mode === "remote") {
            openExternalURL(details.url, true);
            return {action: "deny"};
        }
        if (details.url.startsWith("file:///") && details.disposition === "foreground-tab") {
            return ELECTRON_DEFAULT_WINDOW_OPEN;
        }
        // 在编辑器内打开链接的处理，比如 iframe 上的打开链接。
        shell.openExternal(details.url);
        return {action: "deny"};
    });
};

export {bindWebviewDevToolsShortcut, handleWebContentsCreated};
