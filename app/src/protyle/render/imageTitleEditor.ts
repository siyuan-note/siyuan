import dayjs from "dayjs";
import {hideTooltip} from "../../dialog/tooltip";
import {getImageTitle, setImageTitle} from "./imageTitle";
import {hasClosestBlock} from "../util/hasClosest";
import {updateTransaction} from "../wysiwyg/transaction";
import {TABLE_CELL_RICH_ATTRIBUTE} from "../util/tableCellRichValue";
import {openAnchoredInput} from "../../dialog/anchoredInput";

export const bindImageTitleEditor = (protyle: IProtyle, root: HTMLElement) => {
    let finishActive: (save: boolean) => void;
    const canEdit = (title: HTMLElement) => !protyle.disabled && !window.siyuan.config.readonly &&
        !window.siyuan.isPublish && root.getAttribute("data-readonly") !== "true" &&
        title.closest(".protyle-wysiwyg") === root &&
        !title.closest(".protyle-wysiwyg__embed, .mindmap-view__preview-block") &&
        (!title.closest(`[${TABLE_CELL_RICH_ATTRIBUTE}]`) || title.closest(".table__cell-editor")) &&
        !protyle.toolbar?.isMultiSelectMode();
    const open = (title: HTMLElement) => {
        const image = title.parentElement.querySelector<HTMLImageElement>("img");
        const text = title.querySelector<HTMLElement>(":scope > span");
        const block = hasClosestBlock(title);
        if (!image || !text || !block || !canEdit(title)) {
            return false;
        }
        finishActive?.(true);
        hideTooltip();
        const originalTitle = getImageTitle(image);
        finishActive = openAnchoredInput({
            anchor: title,
            value: originalTitle,
            label: window.siyuan.languages.title,
            isValid: () => {
                if (!root.contains(image) || !root.contains(text) || !canEdit(title)) {
                    return false;
                }
                const currentTitle = getImageTitle(image);
                if (currentTitle !== originalTitle) {
                    text.textContent = currentTitle;
                    return false;
                }
                return true;
            },
            save: value => {
                if (value === originalTitle) {
                    return;
                }
                const oldHTML = block.outerHTML;
                setImageTitle(image, value);
                text.textContent = value;
                block.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
                updateTransaction(protyle, block, oldHTML);
            },
        });
        return true;
    };
    const getTitle = (event: Event) => {
        const title = event.target instanceof Element ? event.target.closest<HTMLElement>(".protyle-action__title") : null;
        return title?.closest(".img") ? title : null;
    };
    const onPress = (event: Event) => {
        if (event instanceof MouseEvent && (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) {
            return;
        }
        const title = getTitle(event);
        if (title && canEdit(title)) {
            event.stopPropagation();
        }
    };
    const onClick = (event: MouseEvent) => {
        const title = getTitle(event);
        if (title && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && open(title)) {
            if (!(event.target instanceof HTMLTextAreaElement)) {
                event.preventDefault();
            }
            event.stopImmediatePropagation();
        }
    };
    const onKeydown = (event: KeyboardEvent) => {
        const title = getTitle(event);
        if (title === event.target && !event.isComposing && (event.key === "Enter" || event.key === " ") && open(title)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    root.addEventListener("mousedown", onPress, true);
    root.addEventListener("pointerdown", onPress, true);
    root.addEventListener("click", onClick, true);
    root.addEventListener("keydown", onKeydown);
    return {
        flush: () => finishActive?.(true),
        destroy: () => {
            finishActive?.(true);
            root.removeEventListener("mousedown", onPress, true);
            root.removeEventListener("pointerdown", onPress, true);
            root.removeEventListener("click", onClick, true);
            root.removeEventListener("keydown", onKeydown);
        },
    };
};
