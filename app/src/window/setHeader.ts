import {isWindow} from "../util/functions";
import {Wnd} from "../layout/Wnd";
import {getAllTabs, getAllWnds} from "../layout/getAll";
import {Editor} from "../editor";
import {Asset} from "../asset";
import {Constants} from "../constants";

export const setTabPosition = (onlyPadding = false) => {
    const isWindowMode = isWindow();
    const wndsTemp: Wnd[] = [];
    if (isWindowMode) {
        getAllWnds(window.siyuan.layout.layout, wndsTemp);
    } else if (window.siyuan.config.appearance.hideToolbar) {
        if (!window.siyuan.layout.centerLayout) {
            return;
        }
        getAllWnds(window.siyuan.layout.centerLayout, wndsTemp);
    }

    if (wndsTemp.length === 0) {
        return;
    }

    const centerRect = (isWindowMode ? window.siyuan.layout.layout : window.siyuan.layout.centerLayout).element.getBoundingClientRect();
    const toolbarDragElement = document.getElementById("drag");
    const toolbarDragRect = toolbarDragElement?.getBoundingClientRect() || {left: 0, right: 0};
    if (toolbarDragElement) {
        toolbarDragElement.style.removeProperty("--b3-toolbar-drag-left");
        toolbarDragElement.style.removeProperty("--b3-toolbar-drag-right");
    }
    wndsTemp.forEach(item => {
        const headerElement = item.headersElement.parentElement;
        const headerRect = headerElement.getBoundingClientRect();
        headerElement.style.paddingLeft = "";
        (headerElement.lastElementChild as HTMLElement).style.marginRight = "";
        headerElement.style.visibility = "";
        if (headerRect.top <= 0) {
            // header padding
            if (isWindowMode) {
                if (headerRect.left === 0) {
                    headerElement.style.paddingLeft = getComputedStyle(document.body).getPropertyValue("--b3-toolbar-left-mac");
                }
            } else {
                if (headerRect.left > toolbarDragRect.left && headerRect.left === centerRect.left) {
                    toolbarDragElement.style.setProperty("--b3-toolbar-drag-left", headerRect.left - toolbarDragRect.left + "px");
                } else if (headerRect.left < toolbarDragRect.left) {
                    headerElement.style.paddingLeft = (toolbarDragRect.left - headerRect.left) + "px";
                }
            }

            if (isWindowMode) {
                if (headerRect.right === centerRect.right) {
                    (headerElement.lastElementChild as HTMLElement).style.marginRight = document.querySelector(".toolbar__window").clientWidth + "px";
                }
            } else {
                if (headerRect.right < toolbarDragRect.right && headerRect.right === centerRect.right) {
                    toolbarDragElement.style.setProperty("--b3-toolbar-drag-right", toolbarDragRect.right - headerRect.right + "px");
                } else if (headerRect.right > toolbarDragRect.right) {
                    // 不能取 clientWidth，因为设置了 min-width(64) 导致 clientWidth 大于实际宽度
                    if (headerRect.right - toolbarDragRect.right + 64 > headerRect.width) {
                        headerElement.style.visibility = "hidden";
                    } else {
                        (headerElement.lastElementChild as HTMLElement).style.marginRight = (headerRect.right - toolbarDragRect.right) + "px";
                    }
                }
            }
        }

        if (onlyPadding) {
            return;
        }

        item.element.classList.remove("layout__wnd--right", "layout__wnd--left", "layout__wnd--center");
        (item.element.querySelector(".layout-tab-container") as HTMLElement).style.backgroundColor = "";
        const dragElement = headerElement.querySelector(".item--readonly .fn__flex-1") as HTMLElement;
        if (headerRect.top <= 0) {
            // empty
            if (headerElement.classList.contains("fn__none")) {
                (item.element.querySelector(".layout-tab-container") as HTMLElement).style.backgroundColor = "transparent";
                return;
            }
            // header transparent
            item.element.classList.add("layout__wnd--center");
            if (!isWindowMode) {
                if (headerRect.left - 1 <= centerRect.left) {
                    item.element.classList.add("layout__wnd--left");
                }
                if (headerRect.right + 1 >= centerRect.right) {
                    item.element.classList.add("layout__wnd--right");
                }
            }
            dragElement.parentElement.parentElement.style.minWidth = "56px";
            dragElement.style.height = dragElement.parentElement.clientHeight + "px";
            (dragElement.style as CSSStyleDeclarationElectron).WebkitAppRegion = "drag";
        } else {
            dragElement.parentElement.parentElement.style.minWidth = "";
            dragElement.style.height = "";
            (dragElement.style as CSSStyleDeclarationElectron).WebkitAppRegion = "";
        }
    });
};


export const setModelsHash = () => {
    if (!isWindow()) {
        return;
    }
    let hash = "";
    getAllTabs().forEach(tab => {
        if (!tab.model) {
            const initTab = tab.headElement.getAttribute("data-initdata");
            if (initTab) {
                const initTabData = JSON.parse(initTab);
                if (initTabData.instance === "Editor") {
                    hash += initTabData.rootId + Constants.ZWSP;
                }
            }
        } else if (tab.model instanceof Editor) {
            hash += tab.model.editor.protyle.block.rootID + Constants.ZWSP;
        } else if (tab.model instanceof Asset) {
            hash += tab.model.path + Constants.ZWSP;
        }
    });
    window.location.hash = hash;
};
