export const MAP_CONFIG_CHANGED_EVENT = "siyuan-map-config-changed";

export const notifyMapConfigChanged = () => {
    window.dispatchEvent(new CustomEvent(MAP_CONFIG_CHANGED_EVENT));
};
