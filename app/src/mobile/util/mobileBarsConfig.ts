export const MOBILE_BARS_CONFIG_KEY = "local-mobile-bars";

export const isMobileBarsAutoHide = () =>
    window.siyuan.storage[MOBILE_BARS_CONFIG_KEY]?.autoHide !== false;

export const createDefaultMobileBarsConfig = () => ({
    autoHide: true,
    sidebarSwipe: true,
    sidebarButtons: true,
});

export const resolveMobileSidebarConfig = (config?: {autoHide?: boolean, sidebarSwipe?: boolean, sidebarButtons?: boolean} | null) => {
    const stored = !config || Object.keys(config).length === 0 ? createDefaultMobileBarsConfig() : config;
    return {
        sidebarSwipe: stored.sidebarSwipe !== false,
        // 保留已存储的侧栏访问方式，并确保至少有一个入口。
        sidebarButtons: stored.sidebarButtons === true || stored.sidebarSwipe === false,
    };
};

export const getMobileSidebarConfig = () =>
    resolveMobileSidebarConfig(window.siyuan.storage[MOBILE_BARS_CONFIG_KEY]);
