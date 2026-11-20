import {getTopBarHeight} from "../../../layout/getTopBarHeight";
import {isMobile} from "../../../util/functions";

export const setAVCellPanelPosition = (menu: HTMLElement, cell: DOMRect, margin = 0) => {
    if (isMobile()) return;

    const {width, height} = menu.getBoundingClientRect();
    menu.style.left = Math.max(margin, Math.min(cell.left, window.innerWidth - width - margin)) + "px";
    menu.style.top = Math.max(getTopBarHeight(), margin, Math.min(cell.top, window.innerHeight - height - margin)) + "px";
};
