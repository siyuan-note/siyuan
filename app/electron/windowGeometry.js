const isWindowGeometry = value => value?.version === 1 &&
    ["x", "y", "width", "height"].every(key => Number.isSafeInteger(value[key]) && Math.abs(value[key]) < 10000000) &&
    value.width > 0 && value.height > 0 && typeof value.maximized === "boolean" && typeof value.fullscreen === "boolean";

const captureWindowGeometry = window => ({
    version: 1,
    ...window.getNormalBounds(),
    maximized: window.isMaximized(),
    fullscreen: window.isFullScreen(),
});

// 标题栏仍可操作时保留跨屏边界，否则移入当前显示器工作区。
const normalizeWindowGeometry = (value, screen) => {
    if (!isWindowGeometry(value)) {
        return;
    }
    const bounds = {x: value.x, y: value.y, width: Math.max(493, value.width), height: Math.max(376, value.height)};
    const reachable = screen.getAllDisplays().some(({workArea}) => {
        const visibleWidth = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
        return visibleWidth >= 160 && bounds.y >= workArea.y && bounds.y + 32 <= workArea.y + workArea.height;
    });
    if (reachable) {
        return bounds;
    }
    const {workArea} = screen.getDisplayMatching({x: value.x, y: value.y, width: value.width, height: value.height});
    const width = Math.max(493, Math.min(value.width, workArea.width));
    const height = Math.max(376, Math.min(value.height, workArea.height));
    return {
        x: Math.max(workArea.x, Math.min(value.x, workArea.x + Math.max(0, workArea.width - width))),
        y: Math.max(workArea.y, Math.min(value.y, workArea.y + Math.max(0, workArea.height - height))),
        width,
        height,
    };
};

const leaveFullScreen = window => new Promise(resolve => {
    const finish = () => {
        clearTimeout(timer);
        window.removeListener("leave-full-screen", finish);
        resolve(!window.isDestroyed() && !window.isFullScreen());
    };
    const timer = setTimeout(finish, 3000);
    window.once("leave-full-screen", finish);
    window.setFullScreen(false);
    if (!window.isFullScreen()) {
        finish();
    }
});

const restoreWindowGeometry = async (window, value, screen) => {
    const bounds = normalizeWindowGeometry(value, screen);
    if (!bounds || window.isDestroyed()) {
        return false;
    }
    // macOS 退出全屏为异步操作，完成后再设置普通窗口边界。
    if (window.isFullScreen() && !await leaveFullScreen(window)) {
        return false;
    }
    if (window.isDestroyed()) {
        return false;
    }
    if (window.isMinimized()) {
        window.restore();
    }
    if (window.isMaximized()) {
        window.unmaximize();
    }
    window.setBounds(bounds);
    if (value.maximized) {
        window.maximize();
    }
    if (value.fullscreen) {
        window.setFullScreen(true);
    }
    return true;
};

module.exports = {captureWindowGeometry, normalizeWindowGeometry, restoreWindowGeometry};
