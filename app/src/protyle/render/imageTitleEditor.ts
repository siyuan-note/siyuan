import * as dayjs from "dayjs";
import {hideTooltip} from "../../dialog/tooltip";
import {getImageTitle, setImageTitle} from "./imageTitle";
import {hasClosestBlock} from "../util/hasClosest";
import {updateTransaction} from "../wysiwyg/transaction";
import {TABLE_CELL_RICH_ATTRIBUTE} from "../util/tableCellRichValue";

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
        if (text.querySelector("textarea")) {
            return true;
        }
        finishActive?.(true);
        hideTooltip();
        const originalTitle = getImageTitle(image);
        const originalContent = Array.from(text.childNodes);
        const input = document.createElement("textarea");
        input.className = "b3-text-field fn__block";
        input.rows = 1;
        input.value = originalTitle;
        input.setAttribute("aria-label", window.siyuan.languages.title);
        const resize = () => {
            input.style.height = "auto";
            input.style.height = `${Math.min(input.scrollHeight, Math.max(60, window.innerHeight * 0.4))}px`;
        };
        input.addEventListener("input", resize);
        let finished = false;
        const finish = (save: boolean) => {
            if (finished) {
                return;
            }
            finished = true;
            finishActive = undefined;
            const value = input.value;
            const current = root.contains(image) && root.contains(text) && text.contains(input);
            if (!current) {
                return;
            }
            text.replaceChildren(...originalContent);
            const currentTitle = getImageTitle(image);
            if (currentTitle !== originalTitle) {
                text.textContent = currentTitle;
                return;
            }
            if (!save || !canEdit(title) || value === originalTitle) {
                return;
            }
            const oldHTML = block.outerHTML;
            setImageTitle(image, value);
            text.textContent = value;
            block.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, block, oldHTML);
        };
        finishActive = finish;
        input.addEventListener("blur", () => finish(true));
        input.addEventListener("keydown", event => {
            event.stopPropagation();
            if (event.isComposing || event.keyCode === 229) {
                return;
            }
            if (event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                finish(event.key === "Enter");
                title.focus();
            }
        });
        for (const name of ["input", "beforeinput", "keyup", "compositionstart", "compositionend", "paste", "cut", "copy", "focusout", "dblclick"]) {
            input.addEventListener(name, event => event.stopPropagation());
        }
        text.replaceChildren(input);
        resize();
        input.focus();
        input.select();
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
