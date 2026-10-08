import { getAssetHTML, bindAssetEvent, addAssetLink, updateAssetCell, editAssetItem } from "../asset";
import { setPosition } from "../../../../util/setPosition";
import { Constants } from "../../../../constants";
import { assetMenu } from "../../../../menus/protyle";
import { getAssetExtension } from "../../../../util/pathName";
import { isBrowserRenderableImagePath } from "../../../../util/imageURL";
import { previewAttrViewImages } from "../../../preview/image";
import { openLink } from "../../../../editor/openLink";
import type { IAVPanelDescriptor } from "./types";
export const assetPanel: IAVPanelDescriptor = {
    render: context => {
        context.html = getAssetHTML(context.options.cellElements);
        return true;
    },
    bind: context => {
        bindAssetEvent({
            protyle: context.options.protyle,
            menuElement: context.menuElement,
            cellElements: context.options.cellElements,
            blockElement: context.options.blockElement
        });
        setTimeout(() => {
            setPosition(context.menuElement, context.cellRect.left, context.cellRect.bottom, context.cellRect.height, 0, true);
        }, Constants.TIMEOUT_LOAD); // 等待加载
    },
    actions: {
        "addAssetLink": (context, action) => {
            addAssetLink(context.options.protyle, context.options.cellElements, action.target, context.options.blockElement, action.target.dataset.assetType as "image" | "file", context.options.keepMenuOpen);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "addAssetExist": (context, action) => {
            const rect = action.target.getBoundingClientRect();
            assetMenu(context.options.protyle, {
                x: rect.right,
                y: rect.bottom,
                w: action.target.parentElement.clientWidth + 8,
                h: rect.height
            }, (url, name) => {
                let value: IAVCellAssetValue;
                if (Constants.SIYUAN_ASSETS_IMAGE.includes(getAssetExtension(url).toLowerCase()) &&
                    isBrowserRenderableImagePath(url)) {
                    value = {
                        type: "image",
                        content: url,
                        name: ""
                    };
                }
                else {
                    value = {
                        type: "file",
                        content: url,
                        name
                    };
                }
                updateAssetCell({
                    protyle: context.options.protyle,
                    cellElements: context.options.cellElements,
                    addValue: [value],
                    blockElement: context.options.blockElement
                });
                if (!context.options.keepMenuOpen) {
                    window.siyuan.menus.menu.remove();
                }
            }, undefined, context.options.keepMenuOpen);
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "openAssetItem": (context, action) => {
            const assetLink = action.target.parentElement.dataset.content;
            if (action.target.parentElement.dataset.type === "image" &&
                isBrowserRenderableImagePath(assetLink)) {
                previewAttrViewImages(assetLink, context.avID, context.options.blockElement.getAttribute("data-node-id"), context.options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW), context.options.blockElement.querySelector('[data-type="av-search"]')?.textContent.trim() || "");
            }
            else {
                openLink(context.options.protyle.app, assetLink, action.event, action.event.ctrlKey || action.event.metaKey);
            }
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        },
        "editAssetItem": (context, action) => {
            editAssetItem({
                protyle: context.options.protyle,
                cellElements: context.options.cellElements,
                blockElement: context.options.blockElement,
                content: action.target.parentElement.dataset.content,
                type: action.target.parentElement.dataset.type as "image" | "file",
                name: action.target.parentElement.dataset.name,
                index: parseInt(action.target.parentElement.dataset.index),
                rect: action.target.parentElement.getBoundingClientRect(),
                keepMenuOpen: context.options.keepMenuOpen,
            });
            action.event.preventDefault();
            action.event.stopPropagation();
            return "handled";
        }
    },
};
