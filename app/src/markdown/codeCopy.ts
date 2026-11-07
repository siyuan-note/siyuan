export const renderMarkdownCodeCopy = (_code: HTMLElement, menu: HTMLElement) => {
    const textarea = menu.querySelector("textarea");
    const button = menu.querySelector<HTMLElement>("span");
    if (!textarea || !button) return;
    const document = menu.ownerDocument;
    const labels = (document.defaultView as unknown as {VditorI18n?: {copy: string; copied: string}}).VditorI18n;
    const label = button.getAttribute("aria-label");
    // 独立编辑器的 CSP 禁止内联事件，复制控件使用外部事件监听器。
    button.removeAttribute("onclick");
    button.removeAttribute("onmouseover");
    button.setAttribute("role", "button");
    button.tabIndex = 0;
    button.addEventListener("mouseover", () => button.setAttribute("aria-label", label));
    const copy = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        const active = document.activeElement;
        const input = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement ? active : undefined;
        const inputSelection = input && input.selectionStart !== null ?
            {start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection} : undefined;
        const selection = document.getSelection();
        const ranges = Array.from({length: selection?.rangeCount ?? 0}, (_, index) => selection.getRangeAt(index).cloneRange());
        textarea.select();
        try {
            if (document.execCommand("copy")) button.setAttribute("aria-label", labels?.copied ?? label);
        } finally {
            textarea.blur();
            if (active instanceof HTMLElement && active.isConnected) active.focus({preventScroll: true});
            selection?.removeAllRanges();
            ranges.forEach(range => selection?.addRange(range));
            if (inputSelection && input.isConnected) {
                input.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction);
            }
        }
    };
    button.addEventListener("click", copy);
    button.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") copy(event);
    });
};
