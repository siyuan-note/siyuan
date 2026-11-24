import {getTopBarHeight} from "../../../layout/getTopBarHeight";
import {isMobile} from "../../../util/functions";
import {setAVCellPanelPosition} from "./cellPanelPosition";

// 日期范围、时间及年月编辑器都会改变内容高度；滚动仍由原菜单 items 承担。
export const bindDatePanelPosition = (menu: HTMLElement, getAnchor: () => DOMRect) => {
    if (isMobile()) { return () => {}; }
    const doc = menu.ownerDocument;
    const view = doc.defaultView;
    const content = menu.querySelector<HTMLElement>(".b3-menu__items > div");
    let disposed = false;
    menu.classList.add("av__date-panel");
    const update = () => {
        if (disposed || !menu.isConnected || !content?.isConnected) { return; }
        menu.style.maxHeight = Math.max(0, view.innerHeight - getTopBarHeight()) + "px";
        const anchor = getAnchor();
        if (anchor) { setAVCellPanelPosition(menu, anchor); }
    };
    const resize = new view.ResizeObserver(update);
    resize.observe(menu);
    if (content) { resize.observe(content); }
    const destroy = () => {
        if (disposed) { return; }
        disposed = true;
        resize.disconnect();
        removal.disconnect();
        view.removeEventListener("resize", update);
        view.removeEventListener("pagehide", destroy);
    };
    const removal = new view.MutationObserver(() => {
        if (!menu.isConnected || !content?.isConnected) { destroy(); }
    });
    removal.observe(doc.body, {childList: true, subtree: true});
    view.addEventListener("resize", update);
    view.addEventListener("pagehide", destroy);
    update();
    return destroy;
};
