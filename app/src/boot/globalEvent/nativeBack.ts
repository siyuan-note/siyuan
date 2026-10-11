import {destroyAVRichTextEditor} from "../../protyle/render/av/richTextEditor";
import {AV_CELL_EDITOR_CLOSE_EVENT} from "../../protyle/render/av/cellEditor";
import {getZIndex} from "../../util/zIndex";

// Android 桌面布局按实际层级关闭一个浮层，保留底层文档和面板的浏览状态。
export const closeDesktopBackLayer = () => {
    const siyuan = window.siyuan;
    if (!siyuan) {
        return false;
    }
    const layers: Array<{zIndex: number, close: () => void}> = [];
    const addLayer = (element: HTMLElement | null | undefined, close: () => void) => {
        if (!element?.isConnected || element.closest(".fn__none")) {
            return;
        }
        let zIndex = 0;
        for (let parent = element; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
                return;
            }
            const computedZIndex = Number(style.zIndex);
            zIndex = Math.max(zIndex, getZIndex(parent), Number.isFinite(computedZIndex) ? computedZIndex : 0);
        }
        layers.push({zIndex, close});
    };
    const menu = siyuan.menus?.menu;
    addLayer(menu?.element, () => menu.remove(true));
    siyuan.dialogs?.forEach(dialog => {
        addLayer(dialog.element.querySelector(".b3-dialog"), () => dialog.destroy());
    });
    siyuan.blockPanels?.forEach(panel => {
        if ((panel.targetElement || typeof panel.x === "number") && panel.element.getAttribute("data-pin") === "false") {
            addLayer(panel.element, () => panel.destroy());
        }
    });
    const viewer = siyuan.viewer;
    if (viewer && !viewer.destroyed) {
        addLayer(viewer.viewer, () => viewer.hide());
    }
    document.querySelectorAll<HTMLElement>(".protyle-img").forEach(element => {
        addLayer(element, () => element.remove());
    });
    document.querySelectorAll<HTMLElement>(".av__panel").forEach(element => {
        addLayer(element, () => {
            if ((element.querySelector('[data-type="goSearchRollupCol"]') && !element.querySelector(".b3-text-field")) ||
                element.querySelector('[data-type="addAssetExist"]')) {
                element.dispatchEvent(new CustomEvent("click", {detail: "close"}));
            } else {
                element.remove();
            }
        });
    });
    document.querySelectorAll<HTMLElement>(".av__mask").forEach(element => {
        addLayer(element, () => {
            if (element.classList.contains("av__richtext-mask")) {
                destroyAVRichTextEditor(true);
            } else {
                if (element.contains(document.activeElement)) {
                    (document.activeElement as HTMLElement).blur();
                }
                element.dispatchEvent(new CustomEvent(AV_CELL_EDITOR_CLOSE_EVENT));
            }
        });
    });
    [siyuan.layout?.leftDock, siyuan.layout?.rightDock, siyuan.layout?.bottomDock].forEach(dock => {
        if (dock?.isFloating() && dock.isPanelVisible() && dock.layout.element.style.opacity === "1") {
            addLayer(dock.layout.element, () => dock.togglePanel(false));
        }
    });
    layers.sort((left, right) => right.zIndex - left.zIndex);
    if (layers.length > 0) {
        layers[0].close();
        return true;
    }
    // 关闭动画尚未结束时仍消费返回，避免连续按键触发整页导航。
    return siyuan.dialogs?.some(dialog => dialog.element.dataset.dialogClosing === "true") ?? false;
};

export const registerDesktopBackNavigation = () => {
    if (window.JSAndroid) {
        window.goBack = () => {
            if (!closeDesktopBackLayer()) {
                window.history.back();
            }
        };
    }
};
