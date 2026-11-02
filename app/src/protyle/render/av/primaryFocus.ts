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
        const title = protyle.title;
        const sourceAware = protyle.block.rootID !== protyle.notebookId;
        let isTitleVisible: () => boolean;
        /// #if MOBILE
        if (sourceAware && window.siyuan.mobile.editor?.protyle !== protyle) {
            return;
        }
        isTitleVisible = () => {
            const input = document.getElementById(sourceAware ? "toolbarNameReadonly" : "toolbarName") as HTMLInputElement;
            return Boolean(input && !input.disabled && input.getClientRects().length &&
                window.siyuan.mobile.editor?.protyle === protyle);
        };
        /// #else
        isTitleVisible = () => Boolean(title?.editElement?.getClientRects().length);
        /// #endif
        if (sourceAware && title && isTitleVisible()) {
            // 标题完整源加载后再聚焦，重绘与迟到响应不能重复抢占光标。
            return title.openEditor(() => root.isConnected && protyle.title === title &&
                protyle.block.rootID === request.boundBlockID && isTitleVisible())
                .catch(error => console.error(error));
        }
        /// #if MOBILE
        const titleInput = document.getElementById("toolbarName") as HTMLInputElement;
        if (titleInput && !titleInput.disabled && !titleInput.readOnly && titleInput.getClientRects().length) {
            titleInput.focus({preventScroll: true});
            titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
            return;
        }
        /// #else
        const titleElement = title?.editElement;
        if (titleElement?.isContentEditable && titleElement.getClientRects().length) {
            titleElement.focus({preventScroll: true});
            focusByOffset(titleElement, titleElement.textContent.length, titleElement.textContent.length);
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
