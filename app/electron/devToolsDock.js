// Windows 默认停靠到底部，关闭重开即可从可能被窗口控制按钮遮挡的位置恢复。
// 保留调用方显式指定的选项；其他平台未指定位置时沿用 Electron 上次使用的位置。
const openDevTools = (contents, platform = process.platform, options = {}) => {
    if (!contents || contents.isDestroyed()) {
        return;
    }
    const normalized = platform === "win32" ? {mode: "bottom"} : {};
    if (options && typeof options === "object") {
        if (["left", "right", "bottom", "undocked", "detach"].includes(options.mode)) {
            normalized.mode = options.mode;
        }
        if (typeof options.activate === "boolean") {
            normalized.activate = options.activate;
        }
        if (typeof options.title === "string") {
            normalized.title = options.title;
        }
    }
    if (Object.keys(normalized).length) {
        contents.openDevTools(normalized);
    } else {
        contents.openDevTools();
    }
};

const toggleDevTools = (contents, platform = process.platform) => {
    if (!contents || contents.isDestroyed()) {
        return;
    }
    if (contents.isDevToolsOpened()) {
        contents.closeDevTools();
        return;
    }
    openDevTools(contents, platform);
};

module.exports = {openDevTools, toggleDevTools};
