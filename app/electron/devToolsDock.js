// Windows 的窗口控制按钮由系统绘制在页面之上，开发者工具停靠在右侧会被遮挡，这里固定停靠到底部。
// 其他平台不带参数打开，沿用 Electron 上次使用的停靠位置。
const openDevTools = (contents, platform = process.platform) => {
    if (!contents || contents.isDestroyed()) {
        return;
    }
    if (platform === "win32") {
        contents.openDevTools({mode: "bottom"});
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
