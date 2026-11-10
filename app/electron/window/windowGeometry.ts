import type {BrowserWindow, Rectangle, Screen} from "electron";
import {MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH} from "../shared/desktopDefaults";

type WindowGeometry = {
    version: number;
    x: number;
    y: number;
    width: number;
    height: number;
    maximized: boolean;
    fullscreen: boolean;
};

const BOUND_KEYS = ["x", "y", "width", "height"] as const;
const GEOMETRY_LIMIT = 10000000;

// 校验来自本地存储的窗口几何数据，越界值按无效处理而不是截断。
const isWindowGeometry = (value: unknown): value is WindowGeometry => {
    const candidate = value as WindowGeometry;
    return candidate?.version === 1 &&
        BOUND_KEYS.every(key => Number.isSafeInteger(candidate[key]) && Math.abs(candidate[key]) < GEOMETRY_LIMIT) &&
        candidate.width > 0 && candidate.height > 0 &&
        typeof candidate.maximized === "boolean" && typeof candidate.fullscreen === "boolean";
};

const captureWindowGeometry = (window: BrowserWindow): WindowGeometry => ({
    version: 1,
    ...window.getNormalBounds(),
    maximized: window.isMaximized(),
    fullscreen: window.isFullScreen(),
});

// 标题栏仍可操作时保留跨屏边界，否则移入当前显示器工作区。
const normalizeWindowGeometry = (value: unknown, screen: Screen): Rectangle | undefined => {
    if (!isWindowGeometry(value)) {
        return;
    }
    const bounds = {x: value.x, y: value.y, width: Math.max(MIN_WINDOW_WIDTH, value.width),
        height: Math.max(MIN_WINDOW_HEIGHT, value.height)};
    const reachable = screen.getAllDisplays().some(({workArea}) => {
        const visibleWidth = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
        return visibleWidth >= 160 && bounds.y >= workArea.y && bounds.y + 32 <= workArea.y + workArea.height;
    });
    if (reachable) {
        return bounds;
    }
    const {workArea} = screen.getDisplayMatching({x: value.x, y: value.y, width: value.width, height: value.height});
    const width = Math.max(MIN_WINDOW_WIDTH, Math.min(value.width, workArea.width));
    const height = Math.max(MIN_WINDOW_HEIGHT, Math.min(value.height, workArea.height));
    return {
        x: Math.max(workArea.x, Math.min(value.x, workArea.x + Math.max(0, workArea.width - width))),
        y: Math.max(workArea.y, Math.min(value.y, workArea.y + Math.max(0, workArea.height - height))),
        width,
        height,
    };
};

const leaveFullScreen = (window: BrowserWindow): Promise<boolean> => new Promise<boolean>(resolve => {
    const finish = (): void => {
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

const restoreWindowGeometry = async (window: BrowserWindow, value: unknown, screen: Screen): Promise<boolean> => {
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
    const geometry = value as WindowGeometry;
    if (geometry.maximized) {
        window.maximize();
    }
    if (geometry.fullscreen) {
        window.setFullScreen(true);
    }
    return true;
};

export {captureWindowGeometry, normalizeWindowGeometry, restoreWindowGeometry};
