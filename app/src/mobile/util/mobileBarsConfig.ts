export const MOBILE_BARS_CONFIG_KEY = "local-mobile-bars";

export const isMobileBarsAutoHide = () =>
    window.siyuan.storage[MOBILE_BARS_CONFIG_KEY]?.autoHide !== false;

export const createDefaultMobileBarsConfig = () => ({
    autoHide: true,
    sidebarSwipe: true,
    sidebarButtons: true,
});

export const resolveMobileSidebarConfig = (config: {sidebarSwipe?: boolean, sidebarButtons?: boolean} | null = createDefaultMobileBarsConfig()) => ({
    sidebarSwipe: config?.sidebarSwipe !== false,
    // 保留已存储的侧栏访问方式，并确保至少有一个入口。
    sidebarButtons: config?.sidebarButtons === true || config?.sidebarSwipe === false,
});

export const getMobileSidebarConfig = () =>
    resolveMobileSidebarConfig(window.siyuan.storage[MOBILE_BARS_CONFIG_KEY]);
