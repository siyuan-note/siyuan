import { getRelationHTML, bindRelationEvent, openSearchAV, updateRelation, setRelationCell } from "../relation";
import { fetchPost } from "../../../../util/fetch";
import { Constants } from "../../../../constants";
import { getColId } from "../col";
import type { IAVPanelDescriptor } from "./types";
export const relationPanel: IAVPanelDescriptor = {
    render: context => {
        context.html = getRelationHTML(context.data, context.options.cellElements);
        if (!context.html) {
            if (!context.options.data && context.relationDataRetryCount < 5 && context.options.blockElement.isConnected &&
                context.options.cellElements?.every(item => item.isConnected)) {
                context.relationDataRetryCount++;
                // 关系配置事务完成后渲染接口可能短暂返回旧字段，等待数据一致后再判断是否需要配置
                window.setTimeout(() => {
                    if (document.querySelector(".av__panel") || !context.options.blockElement.isConnected ||
                        !context.options.cellElements?.every(item => item.isConnected)) {
                        return;
                    }
                    fetchPost("/api/av/renderAttributeView", context.fetchPayload, response => {
                        if (!document.querySelector(".av__panel")) {
                            context.renderData(response.data as IAV);
                        }
                    });
                }, Constants.TIMEOUT_TRANSITION);
                return false;
            }
            context.openPanel({
                protyle: context.options.protyle,
                blockElement: context.options.blockElement,
                type: "edit",
                colId: getColId(context.options.cellElements[0], context.data.viewType)
            });
            return false;
        }
        return true;
    },
    bind: context => {
        context.closeCB = bindRelationEvent({
            menuElement: context.menuElement,
            cellElements: context.options.cellElements,
            protyle: context.options.protyle,
            blockElement: context.options.blockElement
        });
    },
    actions: {
        "goSearchAV": (context, action) => {
            openSearchAV({
                avID: context.avID,
                target: action.target,
                purpose: "selectRelation",
                blockID: context.options.blockElement.getAttribute("data-node-id"),
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "updateRelation": (context, action) => {
            updateRelation({
                protyle: context.options.protyle,
                avElement: context.avPanelElement,
                avID: context.avID,
                colsData: context.fields,
                blockElement: context.options.blockElement,
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "setRelationCell": (context, action) => {
            context.menuElement.querySelector(".b3-menu__item--current")?.classList.remove("b3-menu__item--current");
            action.target.classList.add("b3-menu__item--current");
            setRelationCell(context.options.protyle, context.options.blockElement as HTMLElement, action.target, context.options.cellElements);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        }
    },
};
