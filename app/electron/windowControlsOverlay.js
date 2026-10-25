const styles = new WeakMap();

const getTitleBarOverlayOptions = (platform = process.platform) => platform === "win32" ? {
    color: "#00000000",
    symbolColor: "#808080",
} : false;

// 只接收本窗口的尺寸和图标颜色，背景透出页面，保留主题的透明与渐变效果。
const updateTitleBarOverlay = (win, data, platform = process.platform) => {
    if (platform !== "win32" || !win || win.isDestroyed() || !data || !Number.isInteger(data.height) ||
        data.height < 1 || data.height > 256) {
        return false;
    }
    const applied = styles.get(win) || {};
    // 高度先独立更新，主题颜色无效时仍保持窗口按钮与顶栏对齐。
    try {
        if (applied.height !== data.height) {
            win.setTitleBarOverlay({color: "#00000000", height: data.height});
            applied.height = data.height;
            styles.set(win, applied);
        }
        if (typeof data.symbolColor !== "string" || !data.symbolColor || data.symbolColor.length > 100) {
            return false;
        }
        if (applied.symbolColor !== data.symbolColor) {
            win.setTitleBarOverlay({color: "#00000000", symbolColor: data.symbolColor});
            applied.symbolColor = data.symbolColor;
            styles.set(win, applied);
        }
        return true;
    } catch {
        return false;
    }
};

module.exports = {getTitleBarOverlayOptions, updateTitleBarOverlay};
