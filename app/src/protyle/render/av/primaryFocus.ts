import {popTextCell} from "./cell";
import {openAVBindBlock} from "./bindBlock";
/// #if !MOBILE
import {focusByOffset} from "../../util/selection";
/// #endif

// 打开条目后只在首次完成渲染时进入标题或主键编辑，刷新不重复聚焦，也不覆盖现有内容。
export const focusDatabasePrimary = (root: Element, protyle: IProtyle,
                                        request: {avID: string; itemID: string; boundBlockID?: string; focusPrimary?: boolean; focusTitle?: boolean; bindPrimary?: boolean}) => {
    if ((!request.focusPrimary && !request.focusTitle && !request.bindPrimary) || !root.isConnected) {
        return;
    }
    delete request.focusPrimary;
    const bindPrimary = request.bindPrimary;
    delete request.bindPrimary;
    const focusTitle = request.focusTitle;
    delete request.focusTitle;
    if (protyle.disabled || window.siyuan.isPublish || protyle.options.history?.created || protyle.options.history?.snapshot) {
        return;
    }
    if (focusTitle && !bindPrimary && request.boundBlockID && request.boundBlockID === protyle.block?.rootID) {
        /// #if MOBILE
        const titleInput = document.getElementById("toolbarName") as HTMLInputElement;
        if (titleInput && !titleInput.disabled && !titleInput.readOnly && titleInput.getClientRects().length) {
            titleInput.focus({preventScroll: true});
            titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
            return;
        }
        /// #else
        const title = protyle.title?.editElement;
        if (title?.isContentEditable && title.getClientRects().length) {
            title.focus({preventScroll: true});
            focusByOffset(title, title.textContent.length, title.textContent.length);
            return;
        }
        /// #endif
    }
    const field = root.querySelector<HTMLElement>(
        `[data-av-id="${request.avID}"] [data-primary="true"] [data-row-id="${request.itemID}"]`);
    if (field) {
        if (bindPrimary) {
            openAVBindBlock(protyle, field);
            return;
        }
        const input = field.querySelector<HTMLInputElement>("input");
        if (input && !input.disabled && !input.readOnly) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        } else if (!input) {
            popTextCell(protyle, [field], "block");
        }
    }
};
