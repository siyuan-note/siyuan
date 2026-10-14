import {addClearButton} from "../../../util/addClearButton";
import {focusBlock} from "../../util/selection";
import {electronUndo} from "../../undo";
/// #if MOBILE
import {activeBlur} from "../../../mobile/util/keyboardToolbar";
/// #endif

const composingSearches = new WeakMap<HTMLElement, {render?: () => void}>();

export const deferAvSearchRender = (searchInputElement: HTMLElement, render: () => void) => {
    const composition = composingSearches.get(searchInputElement);
    if (!composition) {
        return false;
    }
    composition.render = render;
    return true;
};

export const captureAvSearchSelection = (searchInputElement: HTMLElement) => {
    if (!searchInputElement || document.activeElement !== searchInputElement) {
        return;
    }
    const selection = getSelection();
    if (!selection?.rangeCount || !searchInputElement.contains(selection.anchorNode) ||
        !searchInputElement.contains(selection.focusNode)) {
        return;
    }
    const offset = (node: Node, position: number) => {
        const range = document.createRange();
        range.selectNodeContents(searchInputElement);
        range.setEnd(node, position);
        return range.toString().length;
    };
    return {
        anchor: offset(selection.anchorNode, selection.anchorOffset),
        focus: offset(selection.focusNode, selection.focusOffset),
    };
};

const collapseAvSearch = (searchInputElement: HTMLElement, viewsElement: HTMLElement) => {
    viewsElement.classList.remove("av__views--show", "av__views--search");
    searchInputElement.style.width = "0";
    searchInputElement.style.paddingLeft = "0";
    searchInputElement.style.marginRight = "0";
};

export const bindAvSearch = (options: {
    blockElement: HTMLElement,
    query?: string,
    isSearching?: boolean,
    selection?: ReturnType<typeof captureAvSearchSelection>,
    onChange: () => void,
}) => {
    const viewsElement = options.blockElement.querySelector(".av__views") as HTMLElement;
    const searchInputElement = options.blockElement.querySelector('[data-type="av-search"]') as HTMLElement;
    searchInputElement.textContent = options.query || "";
    if (options.isSearching) {
        searchInputElement.focus();
        if (options.selection) {
            const node = searchInputElement.firstChild || searchInputElement;
            const length = searchInputElement.textContent.length;
            getSelection().setBaseAndExtent(node, Math.min(options.selection.anchor, length),
                node, Math.min(options.selection.focus, length));
        }
    }
    searchInputElement.addEventListener("compositionstart", (event: KeyboardEvent) => {
        event.stopPropagation();
        composingSearches.set(searchInputElement, {});
    });
    searchInputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        electronUndo(event);
    });
    const searchInputChange = (event: Event) => {
        event.stopPropagation();
        if ((event as KeyboardEvent).isComposing || composingSearches.has(searchInputElement)) {
            return;
        }
        if (searchInputElement.textContent || document.activeElement === searchInputElement) {
            viewsElement.classList.add("av__views--show", "av__views--search");
        } else {
            viewsElement.classList.remove("av__views--show", "av__views--search");
        }
        options.onChange();
    };
    searchInputElement.addEventListener("input", searchInputChange);
    // 剪切不会触发 input
    searchInputElement.addEventListener("cut", (event) => {
        setTimeout(() => {
            searchInputChange(event);
        });
    });
    searchInputElement.addEventListener("compositionend", () => {
        const render = composingSearches.get(searchInputElement)?.render;
        composingSearches.delete(searchInputElement);
        options.onChange();
        if (render) {
            // 等待组合输入的最终 input 和选区更新后，再重建搜索框。
            setTimeout(() => {
                if (searchInputElement.isConnected) {
                    render();
                }
            });
        }
    });
    searchInputElement.addEventListener("blur", (event: KeyboardEvent) => {
        if (event.isComposing) {
            return;
        }
        if (!searchInputElement.textContent) {
            collapseAvSearch(searchInputElement, viewsElement);
        }
    });
    addClearButton({
        inputElement: searchInputElement,
        right: 0,
        width: "1em",
        height: searchInputElement.clientHeight,
        clearCB() {
            collapseAvSearch(searchInputElement, viewsElement);
            focusBlock(options.blockElement);
            options.onChange();
            /// #if MOBILE
            activeBlur();
            /// #endif
        }
    });
};
