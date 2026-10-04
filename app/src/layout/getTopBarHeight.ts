export const getTopBarHeight = () => {
    if (document.getElementById("sidebar")) {
        return 0;
    }
    return document.querySelector<HTMLElement>(".toolbar--settings")?.clientHeight ||
        document.getElementById("toolbar")?.clientHeight ||
        document.querySelector<HTMLElement>(".layout-tab-bar")?.clientHeight || 0;
};
