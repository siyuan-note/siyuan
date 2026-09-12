export const bindPanelSearch = (inputElement: HTMLInputElement, searchElement: Element, onFilter: () => void, options: {
    trim?: boolean;
    activeClass?: string | false;
    updateLabel?: boolean;
    trigger?: "input" | "enter";
} = {}) => {
    inputElement.addEventListener("blur", () => {
        inputElement.classList.add("fn__none");
        const value = inputElement.value;
        const hasKeyword = Boolean(options.trim === false ? value : value.trim());
        if (options.activeClass !== false) {
            searchElement.classList.toggle(options.activeClass || "block__icon--active", hasKeyword);
        }
        if (options.updateLabel !== false) {
            searchElement.setAttribute("aria-label", window.siyuan.languages.search + (hasKeyword ? " " + value : ""));
        }
    });
    if (options.trigger === "enter") {
        inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
            if (!event.isComposing && event.key === "Enter") {
                onFilter();
            }
        });
    } else {
        inputElement.addEventListener("input", (event: InputEvent) => {
            if (!event.isComposing) {
                onFilter();
            }
        });
        inputElement.addEventListener("compositionend", () => onFilter());
    }

    // 由面板在处理焦点后调用，保持搜索输入框的聚焦顺序。
    return () => {
        inputElement.classList.remove("fn__none");
        inputElement.select();
    };
};
