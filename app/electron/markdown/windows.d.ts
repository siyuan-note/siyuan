// `markdown/windows.js` 的声明。独立 Markdown 编辑器保持 CommonJS，主进程以严格模式引用它。
import type {BrowserWindow, IpcMain, NativeTheme, WebContents} from "electron";

/** 标题栏按钮区由主进程注入，Markdown 模块不直接引用 window 目录。 */
export type MarkdownWindowControls = {
    getOptions: (platform: NodeJS.Platform, height: number) => unknown;
    update: (window: BrowserWindow, style: {height?: number; symbolColor?: string},
        platform?: NodeJS.Platform) => boolean;
};

export type MarkdownWindowsOptions = {
    app: {getLocale: () => string};
    BrowserWindow: typeof BrowserWindow;
    ipcMain: IpcMain;
    dialog: unknown;
    shell: unknown;
    protocol: unknown;
    nativeTheme: NativeTheme;
    /** 应用目录，用于定位 Markdown 前端产物与语言资源。 */
    rootDirectory: string;
    /** 偏好、恢复记录与文件的持久化目录。 */
    configDirectory: string;
    /** 菜单与提示使用的语言；省略时按系统语言选择。 */
    lang?: string;
    platform?: NodeJS.Platform;
    /** 所有 Markdown 窗口都已关闭时回调，由入口决定是否退出进程。 */
    onEmpty?: () => void;
    windowControls: MarkdownWindowControls;
};

/** 独立 Markdown 窗口管理器。 */
export type MarkdownWindows = {
    /** 打开一个编辑窗口；省略文件时进入空白编辑器。 */
    open: (file?: string) => Promise<void>;
    /** 处理一次启动参数；不含文件请求时返回 false。 */
    handleLaunch: (argv: string[], cwd: string) => Promise<boolean>;
    hasWindows: () => boolean;
    hasPendingWork: () => boolean;
    owns: (contents: Pick<WebContents, "id">) => boolean;
    focus: () => void;
    /** 请求所有窗口准备退出，任一窗口取消时返回 false。 */
    prepareQuit: () => Promise<boolean>;
    /** 关闭所有窗口，任一窗口取消时返回 false。 */
    closeAll: () => Promise<boolean>;
    cancelQuit: () => void;
};

export declare const createMarkdownWindows: (options: MarkdownWindowsOptions) => MarkdownWindows;

/** 在 app ready 之前登记 Markdown 自定义协议。 */
export declare const registerMarkdownSchemes: (protocol: unknown) => void;

export declare const trustedEvent: (event: unknown, record: unknown) => boolean;
