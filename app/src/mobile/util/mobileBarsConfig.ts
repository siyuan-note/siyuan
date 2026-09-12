export const MOBILE_BARS_CONFIG_KEY = "local-mobile-bars";

export const isMobileBarsAutoHide = () =>
    window.siyuan.storage[MOBILE_BARS_CONFIG_KEY]?.autoHide !== false;
