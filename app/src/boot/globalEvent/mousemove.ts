import {getAllEditor, getAllModels} from "../../layout/getAll";
import {isWindow} from "../../util/functions";
import {hasClosestBlock, hasClosestByClassName, hasClosestByTag} from "../../protyle/util/hasClosest";
import {getColIndex} from "../../protyle/util/table";

export const getTableResizeBounds = (tableElement: HTMLTableElement) => {
    const captionElement = tableElement.querySelector("caption");
    let top = 0;
    if (captionElement && captionElement.style.captionSide !== "bottom") {
        const tableRect = tableElement.getBoundingClientRect();
        top = Math.max(0, Math.min(tableRect.height,
            captionElement.getBoundingClientRect().bottom - tableRect.top));
    }
    return {
        top,
        height: Math.max(0, Math.min(tableElement.querySelector("colgroup").clientHeight,
            tableElement.clientHeight - top)),
    };
};

const getRightBlock = (element: HTMLElement, x: number, y: number) => {
    let left = x + 34;
    let nodeElement = element;
    if (nodeElement && nodeElement.classList.contains("protyle-action")) {
        return nodeElement;
    }
    let lastNodeElement;
    while (nodeElement && (
        nodeElement.classList.contains("list") || nodeElement.classList.contains("li") ||
        nodeElement.classList.contains("bq") || nodeElement.classList.contains("callout")
    )) {
        nodeElement = document.elementFromPoint(left, y) as HTMLElement;
        const calloutInfoElement = hasClosestByClassName(nodeElement, "callout-info");
        if (calloutInfoElement) {
            nodeElement = calloutInfoElement;
            break;
        }
        nodeElement = hasClosestBlock(nodeElement) as HTMLElement;
        if (lastNodeElement && lastNodeElement === nodeElement) {
            break;
        }
        lastNodeElement = nodeElement;
        if (nodeElement) {
            if (nodeElement.classList.contains("bq") || nodeElement.classList.contains("callout")) {
                left += 10;
            } else {
                left += 34;
            }
        } else {
            left += 34;
        }
    }
    return nodeElement;
};

export const windowMouseMove = (event: MouseEvent) => {
    if (document.body.classList.contains("body--blur") || document.getElementById("progress")) {
        // 非激活状态下不执行 https://ld246.com/article/1693474547631
        return;
    }
    // https://github.com/siyuan-note/siyuan/pull/8793
    const coordinates = window.siyuan.coordinates ?? (window.siyuan.coordinates = {
        pageX: 0,
        pageY: 0,
        clientX: 0,
        clientY: 0,
        screenX: 0,
        screenY: 0,
    });
    coordinates.pageX = event.pageX;
    coordinates.pageY = event.pageY;
    coordinates.clientX = event.clientX;
    coordinates.clientY = event.clientY;
    coordinates.screenX = event.screenX;
    coordinates.screenY = event.screenY;

    // breadcrumb
    if (window.siyuan.hideBreadcrumb) {
        window.siyuan.hideBreadcrumb = false;
        getAllEditor().forEach(item => {
            if (item.protyle.breadcrumb?.element.classList.contains("protyle-breadcrumb__bar--hide")) {
                item.protyle.breadcrumb.element.classList.remove("protyle-breadcrumb__bar--hide");
                item.protyle.breadcrumb.render(item.protyle, true);
            }
        });
    }
    const target = event.target as Element;
    // Dock
    if (window.siyuan.layout.bottomDock && !isWindow()) {
        const docks = [
            window.siyuan.layout.leftDock,
            window.siyuan.layout.rightDock,
            window.siyuan.layout.bottomDock
        ];
        const inDockOverlay = hasClosestByClassName(target, "b3-menu") ||
            hasClosestByClassName(target, "tooltip") ||
            hasClosestByClassName(target, "block__popover") ||
            hasClosestByClassName(target, "b3-dialog", true);
        if (event.buttons !== 0 || inDockOverlay) {
            docks.forEach(dock => dock.clearDockHoverTimeout());
        } else {
            const toolbarHeight = document.getElementById("toolbar").clientHeight;
            const statusHeight = document.getElementById("status").clientHeight;
            const inYRange = event.clientY > toolbarHeight && event.clientY < window.innerHeight - statusHeight;
            const canTrigger = !hasClosestByClassName(target, "layout--float") &&
                !hasClosestByClassName(target, "protyle-toolbar") &&
                !hasClosestByClassName(target, "protyle-util");
            const leftDock = window.siyuan.layout.leftDock;
            const leftTrigger = canTrigger && inYRange && !leftDock.pin && leftDock.layout.element.clientWidth > 0 &&
                event.clientX < Math.max(document.getElementById("dockLeft").clientWidth + 1, 16) &&
                // 隐藏停靠栏会导致点击两侧内容触发浮动面板弹出，因此需减小鼠标范围
                (leftDock.elements[0].clientWidth > 0 || event.clientX < 8);
            if (leftTrigger || leftDock.layout.element.contains(target)) {
                leftDock.showDockByHover();
            } else {
                leftDock.hideDockByHover();
            }

            const rightDock = window.siyuan.layout.rightDock;
            const rightTrigger = canTrigger && inYRange && !rightDock.pin && rightDock.layout.element.clientWidth > 0 &&
                event.clientX > window.innerWidth - Math.max(document.getElementById("dockRight").clientWidth - 2, 16) &&
                (rightDock.elements[0].clientWidth > 0 || event.clientX > window.innerWidth - 8);
            if (rightTrigger || rightDock.layout.element.contains(target)) {
                rightDock.showDockByHover();
            } else {
                rightDock.hideDockByHover();
            }

            const bottomDock = window.siyuan.layout.bottomDock;
            const bottomTrigger = canTrigger && !bottomDock.pin && bottomDock.layout.element.clientHeight > 0 &&
                event.clientY > Math.min(window.innerHeight - 10, window.innerHeight - statusHeight);
            if (bottomTrigger || bottomDock.layout.element.contains(target)) {
                bottomDock.showDockByHover();
            } else {
                bottomDock.hideDockByHover();
            }
        }
    }

    // gutter
    const eventPath0 = event.composedPath()[0] as HTMLElement;
    if (eventPath0 && eventPath0.nodeType !== 3 && eventPath0.classList.contains("protyle-wysiwyg") && eventPath0.style.paddingLeft) {
        // 光标在编辑器右边也需要进行显示
        const mouseElement = document.elementFromPoint(eventPath0.getBoundingClientRect().left + parseInt(eventPath0.style.paddingLeft) + 13, event.clientY);
        const blockElement = hasClosestBlock(mouseElement);
        if (blockElement) {
            const targetBlockElement = getRightBlock(blockElement, blockElement.getBoundingClientRect().left + 1, event.clientY);
            if (!targetBlockElement) {
                return;
            }
            const allModels = getAllModels();
            let findNode = false;
            allModels.editor.find(item => {
                if (item.editor.protyle.wysiwyg.element === eventPath0) {
                    item.editor.protyle.gutter.render(item.editor.protyle, targetBlockElement, mouseElement);
                    findNode = true;
                    return true;
                }
            });
            if (!findNode) {
                window.siyuan.blockPanels.find(item => {
                    item.editors.find(eItem => {
                        if (eItem.protyle.wysiwyg.element.contains(eventPath0)) {
                            eItem.protyle.gutter.render(eItem.protyle, targetBlockElement, mouseElement);
                            findNode = true;
                            return true;
                        }
                    });
                    if (findNode) {
                        return true;
                    }
                });
            }
            if (!findNode) {
                allModels.backlink.find(item => {
                    item.editors.find(eItem => {
                        if (eItem.protyle.wysiwyg.element === eventPath0) {
                            eItem.protyle.gutter.render(eItem.protyle, targetBlockElement, mouseElement);
                            findNode = true;
                            return true;
                        }
                    });
                    if (findNode) {
                        return true;
                    }
                });
            }
        }
        return;
    }
    if (eventPath0 && eventPath0.nodeType !== 3 && (
        eventPath0.classList.contains("li") ||
        eventPath0.classList.contains("list") ||
        (eventPath0.classList.contains("protyle-action") && eventPath0.parentElement.getAttribute("data-type") === "NodeListItem")
    )) {
        // 光标在列表下部应显示右侧的元素，而不是列表本身
        const targetBlockElement = getRightBlock(eventPath0, eventPath0.getBoundingClientRect().left + 1, event.clientY);
        if (!targetBlockElement) {
            return;
        }
        const allModels = getAllModels();
        let findNode = false;
        allModels.editor.find(item => {
            if (item.editor.protyle.wysiwyg.element.contains(eventPath0)) {
                item.editor.protyle.gutter.render(item.editor.protyle, targetBlockElement);
                findNode = true;
                return true;
            }
        });
        if (!findNode) {
            window.siyuan.blockPanels.find(item => {
                item.editors.find(eItem => {
                    if (eItem.protyle.wysiwyg.element.contains(eventPath0)) {
                        eItem.protyle.gutter.render(eItem.protyle, targetBlockElement);
                        findNode = true;
                        return true;
                    }
                });
                if (findNode) {
                    return true;
                }
            });
        }
        if (!findNode) {
            allModels.backlink.find(item => {
                item.editors.find(eItem => {
                    if (eItem.protyle.wysiwyg.element.contains(eventPath0)) {
                        eItem.protyle.gutter.render(eItem.protyle, targetBlockElement);
                        findNode = true;
                        return true;
                    }
                });
                if (findNode) {
                    return true;
                }
            });
        }
        return;
    }

    if (eventPath0 && eventPath0.nodeType !== 3 && eventPath0.classList.contains("av")) {
        // 数据库居中时光标在数据库侧边 https://github.com/siyuan-note/siyuan/issues/13853
        if (eventPath0.getAttribute("data-type") === "NodeAttributeView") {
            const rowElement = hasClosestByClassName(document.elementFromPoint(eventPath0.firstElementChild.getBoundingClientRect().left + 10, event.clientY), "av__row");
            if (rowElement && !rowElement.classList.contains("av__row--header")) {
                getAllEditor().find(item => {
                    if (item.protyle.wysiwyg.element.contains(eventPath0)) {
                        item.protyle.gutter.render(item.protyle, eventPath0, rowElement);
                        return true;
                    }
                });
                return;
            }
        }
    }

    if (!hasClosestByClassName(target, "protyle", true)) {
        document.querySelectorAll(".protyle-gutters").forEach(item => {
            item.classList.add("fn__none");
            item.innerHTML = "";
        });
    }

    const blockElement = hasClosestByClassName(target, "table");
    if (blockElement && blockElement.style.cursor !== "col-resize" && !hasClosestByClassName(blockElement, "protyle-wysiwyg__embed")) {
        const cellElement = (hasClosestByTag(target, "TH") || hasClosestByTag(target, "TD")) as HTMLTableCellElement;
        const tableElement = blockElement.querySelector("table");
        const resizeElement = blockElement.querySelector(".table__resize");
        const resizeActionElement = resizeElement?.parentElement;
        if (cellElement && tableElement && resizeElement && resizeActionElement) {
            if (blockElement.style.textAlign === "center" || blockElement.style.textAlign === "right") {
                resizeActionElement.style.left = tableElement.offsetLeft + "px";
            } else {
                resizeActionElement.style.left = "";
            }

            if (tableElement.getAttribute("contenteditable") === "true") {
                const resizeBounds = getTableResizeBounds(tableElement);
                const rect = cellElement.getBoundingClientRect();
                if (rect.right - event.clientX < 3 && rect.right - event.clientX > 0) {
                    resizeElement.setAttribute("data-col-index", (getColIndex(cellElement) + cellElement.colSpan - 1).toString());
                    // 记录基础 left（不含 scrollLeft），以便横向滚动后重新定位 https://github.com/siyuan-note/siyuan/issues/13828
                    resizeElement.setAttribute("data-left", (cellElement.offsetWidth + cellElement.offsetLeft - 3).toString());
                    resizeElement.setAttribute("style", `top:${resizeBounds.top}px;height:${resizeBounds.height}px;left: ${Math.round(cellElement.offsetWidth + cellElement.offsetLeft - blockElement.firstElementChild.scrollLeft - 3)}px;display:block`);
                } else if (event.clientX - rect.left < 3 && event.clientX - rect.left > 0 && cellElement.previousElementSibling) {
                    resizeElement.setAttribute("data-col-index", (getColIndex(cellElement) - 1).toString());
                    resizeElement.setAttribute("data-left", (cellElement.offsetLeft - 3).toString());
                    resizeElement.setAttribute("style", `top:${resizeBounds.top}px;height:${resizeBounds.height}px;left: ${Math.round(cellElement.offsetLeft - blockElement.firstElementChild.scrollLeft - 3)}px;display:block`);
                }
            }
        }
    }
};
