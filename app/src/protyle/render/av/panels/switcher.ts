import { getSwitcherHTML, bindSwitcherEvent, addView, setAVBlockVisibleViewIDs, openViewMenu } from "../view";
import { getAVVisibleViewIDs, getAVVisibleViewIDsAfterHidingAll } from "../viewVisibility";
import { Constants } from "../../../../constants";
import { clearSelect } from "../../../util/clear";
import { transaction } from "../../../wysiwyg/transaction";
import type { IAVPanelDescriptor } from "./types";
export const switcherPanel: IAVPanelDescriptor = {
    render: context => {
        context.html = getSwitcherHTML(context.data.views, context.data.viewID, context.options.blockElement);
        return true;
    },
    bind: context => {
        bindSwitcherEvent({ protyle: context.options.protyle, menuElement: context.menuElement, blockElement: context.options.blockElement });
    },
    actions: {
        "av-add": (context, action) => {
            window.siyuan.menus.menu.remove();
            addView(context.options.protyle, context.options.blockElement);
            context.avPanelElement.remove();
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "av-view-show-all": (context, action) => {
            if (setAVBlockVisibleViewIDs(context.options.protyle, context.options.blockElement, context.data.views.map((view) => view.id))) {
                context.rerenderSwitcher();
            }
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "av-view-hide-all": (context, action) => {
            const visibleViewIDs = getAVVisibleViewIDs(context.options.blockElement, context.data.views);
            const viewIDs = getAVVisibleViewIDsAfterHidingAll(visibleViewIDs, context.data.viewID);
            if (setAVBlockVisibleViewIDs(context.options.protyle, context.options.blockElement, viewIDs)) {
                context.rerenderSwitcher();
            }
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "av-view-visibility": (context, action) => {
            const viewID = action.target.closest<HTMLElement>(".b3-menu__item")?.dataset.id;
            const visibleViewIDs = getAVVisibleViewIDs(context.options.blockElement, context.data.views);
            const viewIDs = visibleViewIDs.includes(viewID) ?
                visibleViewIDs.filter((item) => item !== viewID) :
                visibleViewIDs.concat(viewID);
            if (setAVBlockVisibleViewIDs(context.options.protyle, context.options.blockElement, viewIDs)) {
                context.rerenderSwitcher();
            }
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "av-view-switch": (context, action) => {
            if (!action.target.parentElement.classList.contains("b3-menu__item--current")) {
                const previousViewID = context.data.viewID;
                context.data.viewID = action.target.parentElement.dataset.id;
                context.options.blockElement.setAttribute(Constants.CUSTOM_SY_AV_VIEW, context.data.viewID);
                clearSelect(["row", "galleryItem"], context.options.blockElement);
                context.avPanelElement.querySelector(".b3-menu__item--current")?.classList.remove("b3-menu__item--current");
                action.target.parentElement.classList.add("b3-menu__item--current");
                transaction(context.options.protyle, [{
                        action: "setAttrViewBlockView",
                        blockID: context.blockID,
                        id: action.target.parentElement.dataset.id,
                        avID: context.avID
                    }], [{
                        action: "setAttrViewBlockView",
                        blockID: context.blockID,
                        id: previousViewID,
                        avID: context.avID
                    }]);
            }
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "av-view-edit": (context, action) => {
            if (action.target.parentElement.classList.contains("b3-menu__item--current")) {
                openViewMenu({
                    protyle: context.options.protyle,
                    blockElement: context.options.blockElement as HTMLElement,
                    element: action.target.parentElement
                });
            }
            else {
                const previousViewID = context.data.viewID;
                context.data.viewID = action.target.parentElement.dataset.id;
                context.options.blockElement.setAttribute(Constants.CUSTOM_SY_AV_VIEW, context.data.viewID);
                clearSelect(["row", "galleryItem"], context.options.blockElement);
                context.avPanelElement.querySelector(".b3-menu__item--current")?.classList.remove("b3-menu__item--current");
                action.target.parentElement.classList.add("b3-menu__item--current");
                transaction(context.options.protyle, [{
                        action: "setAttrViewBlockView",
                        blockID: context.blockID,
                        id: action.target.parentElement.dataset.id,
                        avID: context.avID,
                    }], [{
                        action: "setAttrViewBlockView",
                        blockID: context.blockID,
                        id: previousViewID,
                        avID: context.avID,
                    }]);
                window.siyuan.menus.menu.remove();
                openViewMenu({
                    protyle: context.options.protyle,
                    blockElement: context.options.blockElement as HTMLElement,
                    element: action.target.parentElement
                });
            }
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        }
    },
};
