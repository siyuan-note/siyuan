import {Constants} from "../../constants";
import {dragOverScroll, stopScrollAnimation} from "./dragover";

const COLUMN_DRAG_TYPE = `${Constants.SIYUAN_DROP_GUTTER}NodeAttributeView${Constants.ZWSP}Col${Constants.ZWSP}`.toLowerCase();

export const scrollDraggedAVColumn = (event: DragEvent & {target: HTMLElement}) => {
    if (!event.dataTransfer.types.some(type => type.startsWith(COLUMN_DRAG_TYPE))) {
        return false;
    }
    const source = window.siyuan.dragElement;
    const header = source?.closest(".av__row--header");
    const scroll = header?.closest<HTMLElement>(".av__scroll");
    if (!source?.isConnected || !header || event.target.closest(".av__row--header") !== header ||
        !scroll || scroll.scrollWidth <= scroll.clientWidth) {
        stopScrollAnimation();
        return true;
    }
    const bounds = scroll.getBoundingClientRect();
    const headerBounds = header.getBoundingClientRect();
    let left = Math.max(0, bounds.left);
    let right = Math.min(window.innerWidth, bounds.right);
    let top = Math.max(0, headerBounds.top);
    let bottom = Math.min(window.innerHeight, headerBounds.bottom);
    // 固定表头包含所有列，拖拽边缘应使用滚动容器与分屏、浮窗的可见交集。
    for (const selector of [".protyle-content", ".block__content", ".layout-tab-container"]) {
        const viewport = header.closest(selector)?.getBoundingClientRect();
        if (viewport) {
            left = Math.max(left, viewport.left);
            right = Math.min(right, viewport.right);
            top = Math.max(top, viewport.top);
            bottom = Math.min(bottom, viewport.bottom);
        }
    }
    if (left >= right || top >= bottom || event.clientX < left || event.clientX > right ||
        event.clientY < top || event.clientY > bottom) {
        stopScrollAnimation();
    } else {
        dragOverScroll(event, new DOMRect(left, top, right - left, bottom - top), scroll, "x", () =>
            source.isConnected && header.isConnected && scroll.isConnected && window.siyuan.dragElement === source &&
            source.closest(".av__row--header") === header && header.closest(".av__scroll") === scroll);
    }
    return true;
};
