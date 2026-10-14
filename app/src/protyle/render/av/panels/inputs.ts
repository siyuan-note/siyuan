import { getFilterByPath, getEditableFilters, getFiltersHTML, bindInlineFilterEvents } from "../filter";
import { setPosition } from "../../../../util/setPosition";
import { hasClosestByClassName } from "../../../util/hasClosest";
import { getColId } from "../col";
import { updateCellsValue } from "../cell";
import type { IAVPanelContext } from "./types";
export const bindAVPanelInputs = (context: IAVPanelContext) => {
    // 过滤分组 AND/OR 切换（select 的 change 事件，不走 click 分发）
    context.avPanelElement.addEventListener("change", (event: Event) => {
        const select = event.target as HTMLElement;
        if (select.dataset.type !== "toggleCombination") {
            return;
        }
        const path = select.dataset.path;
        const oldFilters = JSON.parse(JSON.stringify(context.data.view.filters));
        const node = "" === path
            ? (context.data.view.filters[0] && (context.data.view.filters[0].filters || context.data.view.filters[0].combination) ? context.data.view.filters[0] : undefined)
            : getFilterByPath(getEditableFilters(context.data), path);
        if (node) {
            node.combination = (select as HTMLSelectElement).value === "or" ? "or" : "and";
        }
        context.saveFilters(JSON.parse(JSON.stringify(context.data.view.filters)), oldFilters);
        // 重渲染以同步所有只读且/或标签（index >= 2 的节点显示的是只读 span）
        context.menuElement.innerHTML = getFiltersHTML(context.data);
        bindInlineFilterEvents(context.avPanelElement as HTMLElement, context.data, context.options.protyle, context.blockID, context.avID, context.options.filterOperation);
        setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
        event.stopPropagation();
    });
    // 多选排序
    context.avPanelElement.addEventListener("mousedown", (event: MouseEvent & {
        target: HTMLElement;
    }) => {
        if (event.button === 1 && !hasClosestByClassName(event.target, "b3-menu")) {
            document.querySelector(".av__panel").dispatchEvent(new CustomEvent("click", { detail: "close" }));
        }
        if (event.button !== 0 || context.options.type !== "select")
            return;
        const selectedElement = event.target.closest(".b3-chip--middle") as HTMLElement;
        if (!selectedElement || !selectedElement.parentElement.classList.contains("b3-chips") ||
            event.target.closest('[data-type="removeCellOption"]')) {
            return;
        }
        const colId = getColId(context.options.cellElements[0], context.data.viewType);
        const colData = context.fields.find((item) => item.id === colId);
        if (colData?.type !== "mSelect" ||
            selectedElement.parentElement.querySelectorAll(".b3-chip--middle").length < 2) {
            return;
        }
        event.preventDefault();
        const documentSelf = document;
        documentSelf.ondragstart = () => false;
        let ghostElement: HTMLElement;
        const diffPosition = { x: 0, y: 0 };
        const startPosition = { x: event.clientX, y: event.clientY };
        const oldValue = Array.from(selectedElement.parentElement.querySelectorAll(".b3-chip--middle"))
            .map((item: HTMLElement) => item.dataset.content);
        documentSelf.onmousemove = (moveEvent: MouseEvent & {
            target: HTMLElement;
        }) => {
            moveEvent.preventDefault();
            moveEvent.stopPropagation();
            if (!ghostElement) {
                if (Math.hypot(moveEvent.clientX - startPosition.x, moveEvent.clientY - startPosition.y) < 5) {
                    return;
                }
                ghostElement = selectedElement.cloneNode(true) as HTMLElement;
                document.body.append(ghostElement);
                ghostElement.setAttribute("id", "dragGhost");
                ghostElement.style.pointerEvents = "none";
                ghostElement.style.position = "fixed";
                ghostElement.style.zIndex = (window.siyuan.zIndex++).toString();
                selectedElement.style.opacity = ".38";
                document.body.style.cursor = "grabbing";
                const selectedRect = selectedElement.getBoundingClientRect();
                diffPosition.x = moveEvent.clientX - selectedRect.left;
                diffPosition.y = moveEvent.clientY - selectedRect.top;
            }
            ghostElement.style.top = (moveEvent.clientY - diffPosition.y) + "px";
            ghostElement.style.left = (moveEvent.clientX - diffPosition.x) + "px";
            const targetElement = moveEvent.target.closest(".b3-chip--middle") as HTMLElement;
            if (targetElement && targetElement !== selectedElement) {
                const nodeRect = targetElement.getBoundingClientRect();
                if (moveEvent.clientX > nodeRect.left + nodeRect.width / 2 &&
                    moveEvent.clientX < nodeRect.right + 8) {
                    targetElement.after(selectedElement);
                }
                else if (moveEvent.clientX <= nodeRect.left + nodeRect.width / 2 &&
                    moveEvent.clientX > nodeRect.left - 8) {
                    targetElement.before(selectedElement);
                }
            }
        };
        documentSelf.onmouseup = () => {
            documentSelf.onmousemove = null;
            documentSelf.onmouseup = null;
            documentSelf.ondragstart = null;
            documentSelf.onselectstart = null;
            documentSelf.onselect = null;
            ghostElement?.remove();
            selectedElement.style.opacity = "";
            document.body.style.cursor = "";
            if (!ghostElement) {
                return;
            }
            const newValue: IAVCellSelectValue[] = [];
            selectedElement.parentElement.querySelectorAll(".b3-chip--middle").forEach((item: HTMLElement) => {
                newValue.push({ content: item.dataset.content, color: item.dataset.valueColor });
            });
            context.suppressSelectClick = true;
            setTimeout(() => {
                context.suppressSelectClick = false;
            });
            if (newValue.some((item, index) => item.content !== oldValue[index])) {
                updateCellsValue(context.options.protyle, context.options.blockElement as HTMLElement, newValue, context.options.cellElements);
            }
        };
    });
};
