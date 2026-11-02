import type {Input, OpenDevToolsOptions, WebContents} from "electron";

type DevToolsMode = "left" | "right" | "bottom" | "undocked" | "detach";

// Electron 要求 mode 必填，但未指定位置时要沿用上次使用的位置，因此先按可缺省构造。
type DevToolsOpenOptions = {mode?: DevToolsMode; activate?: boolean; title?: string};

const DEVTOOLS_MODES: DevToolsMode[] = ["left", "right", "bottom", "undocked", "detach"];

// Windows 默认停靠到底部，关闭重开即可从可能被窗口控制按钮遮挡的位置恢复。
// 保留调用方显式指定的选项；其他平台未指定位置时沿用 Electron 上次使用的位置。
const openDevTools = (contents: WebContents, platform = process.platform,
    options: {
        mode?: unknown;
        activate?: unknown;
        title?: unknown;
        [key: string]: unknown;
    } = {}): void => {
    if (!contents || contents.isDestroyed()) {
        return;
    }
    const normalized: DevToolsOpenOptions = platform === "win32" ? {mode: "bottom"} : {};
    if (options && typeof options === "object") {
        if (typeof options.mode === "string" && DEVTOOLS_MODES.includes(options.mode as DevToolsMode)) {
            normalized.mode = options.mode as DevToolsMode;
        }
        if (typeof options.activate === "boolean") {
            normalized.activate = options.activate;
        }
        if (typeof options.title === "string") {
            normalized.title = options.title;
        }
    }
    if (Object.keys(normalized).length) {
        contents.openDevTools(normalized as OpenDevToolsOptions);
    } else {
        contents.openDevTools();
    }
};

const toggleDevTools = (contents: WebContents, platform = process.platform): void => {
    if (!contents || contents.isDestroyed()) {
        return;
    }
    if (contents.isDevToolsOpened()) {
        contents.closeDevTools();
        return;
    }
    openDevTools(contents, platform);
};

// DevTools 快捷键：macOS 为 Cmd+Alt+I，其他平台为 Ctrl+Shift+I。
// 字符与物理键任一命中即算，避免非拉丁键盘布局下按不出 I 键。
const isDevToolsShortcut = (input: Input, platform = process.platform): boolean => {
    const modifiers = platform === "darwin" ? input.meta && input.alt && !input.control && !input.shift :
        input.control && input.shift && !input.meta && !input.alt;
    return !!modifiers && (input.key?.toLowerCase() === "i" || input.code === "KeyI");
};

export {openDevTools, toggleDevTools, isDevToolsShortcut};
