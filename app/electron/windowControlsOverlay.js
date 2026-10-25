const styles = new WeakMap();

// 首帧按当前界面密度预留按钮区，渲染进程加载后再按实际主题和缩放校正。
// 数值对应 util/_density.scss 里舒适与紧凑两套 --b3-ui-toolbar-height / --b3-ui-panel-height。
const CAPTION_HEIGHTS = {
    comfortable: {toolbar: 32, panel: 42},
    compact: {toolbar: 28, panel: 34},
};

// 融合页签和独立文档窗口的顶栏使用面板高度，普通顶栏和设置窗口使用工具栏高度。
const getCaptionHeight = (compact = false, panel = false) =>
    CAPTION_HEIGHTS[compact === true ? "compact" : "comfortable"][panel === true ? "panel" : "toolbar"];

const getTitleBarOverlayOptions = (platform = process.platform, height = getCaptionHeight()) => {
    if (platform !== "win32") {
        return false;
    }
    return {color: "#00000000", symbolColor: "#808080", height};
};

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

module.exports = {getCaptionHeight, getTitleBarOverlayOptions, updateTitleBarOverlay};
