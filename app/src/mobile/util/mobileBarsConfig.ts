export const MOBILE_BARS_CONFIG_KEY = "local-mobile-bars";

export const isMobileBarsAutoHide = () =>
    window.siyuan.storage[MOBILE_BARS_CONFIG_KEY]?.autoHide !== false;

export const resolveMobileSidebarConfig = (config: {sidebarSwipe?: boolean, sidebarButtons?: boolean} = {}) => ({
    sidebarSwipe: config.sidebarSwipe !== false,
    sidebarButtons: config.sidebarButtons === true || config.sidebarSwipe === false,
});

export const getMobileSidebarConfig = () =>
    resolveMobileSidebarConfig(window.siyuan.storage[MOBILE_BARS_CONFIG_KEY]);
