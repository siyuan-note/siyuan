import { getViewHTML, bindViewEvent, getFieldsByData } from "../view";
import { openAutomationMenu } from "../automation";
import { isMobile } from "../../../../util/functions";
import { setPosition } from "../../../../util/setPosition";
import { getLayoutHTML, bindLayoutEvent, updateLayout } from "../layout";
import { openConditionalColorsMenu } from "../conditionalColorMenu";
import { openEmojiPanel, unicode2Emoji } from "../../../../emoji";
import { transaction } from "../../../wysiwyg/transaction";
import { setPageSize } from "../row";
import { setGalleryCover, setGallerySize, setGalleryRatio } from "../gallery/util";
import { goGroupsDate, goGroupsSort, setGroupMethod, getGroupsHTML, bindGroupsEvent, getGroupsMethodHTML, getGroupsNumberHTML, bindGroupsNumber } from "../groups";
import type { IAVPanelDescriptor, TAVPanelActionResult } from "./types";
export const configPanel: IAVPanelDescriptor = {
    render: context => {
        context.html = getViewHTML(context.data);
        return true;
    },
    bind: context => {
        bindViewEvent({ protyle: context.options.protyle, data: context.data, menuElement: context.menuElement, blockElement: context.options.blockElement });
    },
    actions: {
        "automations": (context, action) => {
            window.siyuan.menus.menu.remove();
            void openAutomationMenu({
                protyle: context.options.protyle,
                blockElement: context.options.blockElement as HTMLElement,
                avID: context.data.id,
                menuElement: context.menuElement,
                onResize: () => {
                    if (!isMobile()) {
                        delete context.menuElement.dataset.positionX;
                        setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
                    }
                },
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "go-config": (context, action) => {
            if (context.menuElement.classList.contains("av__conditional-panel") ||
                context.menuElement.classList.contains("av__automation-panel")) {
                delete context.menuElement.dataset.positionX;
            }
            context.menuElement.classList.remove("av__conditional-panel", "av__automation-panel");
            if (context.options.filterOperation) {
                context.avPanelElement.remove();
                context.openPanel({
                    protyle: context.options.protyle,
                    blockElement: context.options.blockElement,
                    type: "edit",
                    colId: context.options.filterOperation.keyID,
                });
                action.event.preventDefault();
                action.event.stopPropagation();
                return "handled";
            }
            context.menuElement.classList.remove("av__filter-panel");
            context.menuElement.innerHTML = getViewHTML(context.data);
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            bindViewEvent({ protyle: context.options.protyle, data: context.data, menuElement: context.menuElement, blockElement: context.options.blockElement });
            window.siyuan.menus.menu.remove();
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "go-layout": (context, action) => {
            context.menuElement.classList.remove("av__filter-panel");
            context.menuElement.innerHTML = getLayoutHTML(context.data);
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            bindLayoutEvent({ protyle: context.options.protyle, data: context.data, menuElement: context.menuElement, blockElement: context.options.blockElement });
            window.siyuan.menus.menu.remove();
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "goConditionalColors": (context, action) => {
            window.siyuan.menus.menu.remove();
            openConditionalColorsMenu({
                protyle: context.options.protyle,
                blockElement: context.options.blockElement as HTMLElement,
                data: context.data,
                menuElement: context.menuElement,
                onResize: () => {
                    if (!isMobile()) {
                        delete context.menuElement.dataset.positionX;
                        setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
                    }
                },
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "update-view-icon": (context, action) => {
            const rect = action.target.getBoundingClientRect();
            openEmojiPanel("", "av", {
                x: rect.left,
                y: rect.bottom + 4,
                h: rect.height,
                w: rect.width
            }, (unicode) => {
                transaction(context.options.protyle, [{
                        action: "setAttrViewViewIcon",
                        avID: context.avID,
                        id: context.data.viewID,
                        data: unicode,
                    }], [{
                        action: "setAttrViewViewIcon",
                        id: context.data.viewID,
                        avID: context.avID,
                        data: action.target.dataset.icon,
                    }]);
                action.target.innerHTML = unicode ? unicode2Emoji(unicode) : '<svg style="width: 14px;height: 14px;"><use xlink:href="#iconTable"></use></svg>';
                action.target.dataset.icon = unicode;
            }, action.target.querySelector("img"), {
                ownerElement: context.options.protyle.element,
                targetID: context.options.protyle.block.rootID,
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "set-page-size": (context, action) => {
            setPageSize({
                target: action.target,
                protyle: context.options.protyle,
                avID: context.avID,
                nodeElement: context.options.blockElement
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "duplicate-view": (context, action) => {
            const id = Lute.NewNodeID();
            transaction(context.options.protyle, [{
                    action: "duplicateAttrViewView",
                    avID: context.avID,
                    previousID: context.data.viewID,
                    id,
                    blockID: context.blockID
                }], [{
                    action: "removeAttrViewView",
                    avID: context.avID,
                    id,
                    blockID: context.blockID
                }]);
            context.avPanelElement.remove();
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "delete-view": (context, action) => {
            transaction(context.options.protyle, [{
                    action: "removeAttrViewView",
                    avID: context.avID,
                    id: context.data.viewID,
                    blockID: context.blockID
                }]);
            context.avPanelElement.remove();
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "set-gallery-cover": (context, action) => {
            setGalleryCover({
                target: action.target,
                protyle: context.options.protyle,
                nodeElement: context.options.blockElement,
                view: context.data.view as IAVGallery
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "set-gallery-size": (context, action) => {
            setGallerySize({
                target: action.target,
                protyle: context.options.protyle,
                nodeElement: context.options.blockElement,
                view: context.data.view as IAVGallery
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "set-gallery-ratio": (context, action) => {
            setGalleryRatio({
                target: action.target,
                protyle: context.options.protyle,
                nodeElement: context.options.blockElement,
                view: context.data.view as IAVGallery
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "set-layout": async (context, action): Promise<TAVPanelActionResult> => {
            const updatedData = await updateLayout({
                target: action.target,
                protyle: context.options.protyle,
                nodeElement: context.options.blockElement,
                data: context.data
            });
            if (!updatedData) {
                return "handled";
            }
            context.data = updatedData;
            context.fields = getFieldsByData(context.data);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "goGroupsDate": (context, action) => {
            goGroupsDate({
                target: action.target,
                menuElement: context.menuElement,
                protyle: context.options.protyle,
                blockElement: context.options.blockElement,
                data: context.data
            });
            context.fields = getFieldsByData(context.data);
            action.event.stopPropagation();
            action.event.preventDefault();
            return "handled";
        },
        "goGroupsSort": (context, action) => {
            goGroupsSort({
                target: action.target,
                menuElement: context.menuElement,
                protyle: context.options.protyle,
                blockElement: context.options.blockElement,
                data: context.data
            });
            context.fields = getFieldsByData(context.data);
            action.event.stopPropagation();
            action.event.preventDefault();
            return "handled";
        },
        "setGroupMethod": (context, action) => {
            setGroupMethod({
                protyle: context.options.protyle,
                fieldId: action.target.getAttribute("data-id"),
                data: context.data,
                menuElement: context.menuElement,
                blockElement: context.options.blockElement,
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "goGroups": async (context, action): Promise<TAVPanelActionResult> => {
            if (context.menuElement.querySelector('[data-type="avGroupRange"]') && context.closeCB) {
                await context.closeCB();
            }
            context.closeCB = undefined;
            if ((context.data.view.group && context.data.view.group.field) || action.target.classList.contains("block__icon")) {
                context.menuElement.innerHTML = getGroupsHTML(context.fields, context.data.view);
                bindGroupsEvent({
                    protyle: context.options.protyle,
                    menuElement: context.menuElement,
                    blockElement: context.options.blockElement,
                    data: context.data
                });
            }
            else {
                context.menuElement.innerHTML = getGroupsMethodHTML(context.fields, context.data.view.group, context.data.viewType);
            }
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "goGroupsMethod": (context, action) => {
            window.siyuan.menus.menu.remove();
            context.menuElement.innerHTML = getGroupsMethodHTML(context.fields, context.data.view.group, context.data.viewType);
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "getGroupsNumber": (context, action) => {
            window.siyuan.menus.menu.remove();
            context.menuElement.innerHTML = getGroupsNumberHTML(context.data.view.group);
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            context.closeCB = bindGroupsNumber({
                protyle: context.options.protyle,
                data: context.data,
                menuElement: context.menuElement,
                blockElement: context.options.blockElement
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "hideGroup": (context, action) => {
            window.siyuan.menus.menu.remove();
            const useElement = action.target.firstElementChild;
            const isHide = useElement.getAttribute("xlink:href") !== "#iconEye";
            useElement.setAttribute("xlink:href", isHide ? "#iconEye" : "#iconEyeoff");
            let oldGroupHidden;
            let showCount = 0;
            context.data.view.groups.forEach((item) => {
                if (item.id === action.target.dataset.id) {
                    oldGroupHidden = item.groupHidden;
                    item.groupHidden = isHide ? 0 : 2;
                }
                if (item.groupHidden === 0) {
                    showCount++;
                }
            });
            action.target.parentElement.classList[isHide ? "remove" : "add"]("b3-menu__item--hidden");
            context.menuElement.querySelector('[data-type="hideGroups"]').innerHTML = `${window.siyuan.languages[showCount === 0 ? "showAll" : "hideAll"]}
<span class="fn__space"></span>
<svg><use xlink:href="#iconEye${showCount === 0 ? "" : "off"}"></use></svg>`;
            transaction(context.options.protyle, [{
                    action: "hideAttrViewGroup",
                    avID: context.data.id,
                    blockID: context.blockID,
                    id: action.target.dataset.id,
                    data: isHide ? 0 : 2,
                }], [{
                    action: "hideAttrViewGroup",
                    avID: context.data.id,
                    blockID: context.blockID,
                    id: action.target.dataset.id,
                    data: oldGroupHidden
                }]);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "hideGroups": (context, action) => {
            window.siyuan.menus.menu.remove();
            const isShow = action.target.querySelector("use").getAttribute("xlink:href") === "#iconEyeoff";
            action.target.innerHTML = `${window.siyuan.languages[isShow ? "showAll" : "hideAll"]}
<span class="fn__space"></span>
<svg><use xlink:href="#iconEye${isShow ? "" : "off"}"></use></svg>`;
            context.data.view.groups.forEach((item) => {
                item.groupHidden = isShow ? 2 : 0;
                const itemElement = action.target.parentElement.parentElement.querySelector(`.b3-menu__item[data-id="${item.id}"]`);
                itemElement.classList[isShow ? "add" : "remove"]("b3-menu__item--hidden");
                itemElement.querySelector(".b3-menu__action use")?.setAttribute("xlink:href", `#iconEye${isShow ? "off" : ""}`);
            });
            transaction(context.options.protyle, [{
                    action: "hideAttrViewAllGroups",
                    avID: context.data.id,
                    blockID: context.blockID,
                    data: isShow,
                }], [{
                    action: "hideAttrViewAllGroups",
                    avID: context.data.id,
                    blockID: context.blockID,
                    data: !isShow
                }]);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "removeGroups": (context, action) => {
            window.siyuan.menus.menu.remove();
            transaction(context.options.protyle, [{
                    action: "removeAttrViewGroup",
                    avID: context.data.id,
                    blockID: context.blockID,
                }], [{
                    action: "setAttrViewGroup",
                    avID: context.data.id,
                    blockID: context.blockID,
                    data: context.data.view.group
                }]);
            context.data.view.group = null;
            delete context.data.view.groups;
            context.menuElement.innerHTML = getGroupsHTML(context.fields, context.data.view);
            setPosition(context.menuElement, context.tabRect.right - context.menuElement.clientWidth, context.tabRect.bottom, context.tabRect.height, 0, true);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        }
    },
};
