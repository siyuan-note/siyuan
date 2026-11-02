// Markdown 窗口测试用的标题栏按钮区替身：语义与 window/windowControlsOverlay.ts 一致，
// 让 CommonJS 测试不必加载已迁移为 TypeScript 的主进程模块。
const windowControls = {
    getOptions: (platform, height) => platform === "win32"
        ? {color: "#00000000", symbolColor: "#808080", height} : false,
    update: (window, style, platform) => {
        if (platform !== "win32") return false;
        window.setTitleBarOverlay({color: "#00000000", ...style});
        return true;
    },
};

module.exports = {windowControls};
