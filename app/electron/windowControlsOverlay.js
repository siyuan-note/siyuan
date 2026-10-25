const styles = new WeakMap();

const getTitleBarOverlayOptions = (platform = process.platform) => platform === "win32" ? {
    color: "#00000000",
    symbolColor: "#808080",
} : false;

// 只接收本窗口的尺寸和图标颜色，背景透出页面，保留主题的透明与渐变效果。
const updateTitleBarOverlay = (win, data, platform = process.platform) => {
    if (platform !== "win32" || !win || win.isDestroyed() || !data || !Number.isInteger(data.height) ||
        data.height < 1 || data.height > 256 || typeof data.symbolColor !== "string" ||
        !data.symbolColor || data.symbolColor.length > 100) {
        return false;
    }
    const style = {color: "#00000000", symbolColor: data.symbolColor, height: data.height};
    const key = JSON.stringify(style);
    if (styles.get(win) === key) return true;
    try {
        win.setTitleBarOverlay(style);
        styles.set(win, key);
        return true;
    } catch {
        return false;
    }
};

module.exports = {getTitleBarOverlayOptions, updateTitleBarOverlay};
