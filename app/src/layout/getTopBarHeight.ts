import {isMobile} from "../util/functions";

export const getTopBarHeight = () => {
    // 移动端顶部栏由各自的面板负责，这里统一按移动端判定返回 0
    if (isMobile()) {
        return 0;
    }
    return document.querySelector<HTMLElement>(".toolbar--settings")?.clientHeight ||
        document.getElementById("toolbar")?.clientHeight ||
        document.querySelector<HTMLElement>(".layout-tab-bar")?.clientHeight || 0;
};
