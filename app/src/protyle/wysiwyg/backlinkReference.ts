const initialized = new WeakSet<HTMLElement>();

const isPureReference = (element: HTMLElement) => {
    const content = element.querySelector(":scope > [contenteditable]");
    let hasReference = false;
    if (!content) {
        return false;
    }
    for (const node of Array.from(content.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
            continue;
        }
        if (node instanceof HTMLElement && (node.dataset.type || "").split(" ").includes("block-ref")) {
            hasReference = true;
            continue;
        }
        return false;
    }
    return hasReference;
};

export const updateBacklinkReferenceVisibility = (protyle: IProtyle) => {
    const element = protyle.wysiwyg.element;
    element.toggleAttribute("data-backlink-hide-reference",
        Boolean(protyle.options.backlinkData) && protyle.element.getAttribute("data-ismention") !== "true" &&
        window.siyuan.config.editor.backlinkHideReference === true);
    if (!element.hasAttribute("data-backlink-hide-reference")) {
        element.removeAttribute("data-backlink-task-focus");
    }
    if (protyle.options.backlinkData && !initialized.has(element)) {
        initialized.add(element);
        // 任务点击保留隐藏布局，同时沿用编辑器的焦点、撤销和拖拽处理。
        element.addEventListener("pointerdown", event => {
            const action = event.target instanceof Element ? event.target.closest(".protyle-action--task") : null;
            element.toggleAttribute("data-backlink-task-focus", Boolean(
                event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey &&
                !protyle.disabled && element.hasAttribute("data-backlink-hide-reference") &&
                action?.parentElement.classList.contains("li") && action.closest(".protyle-wysiwyg") === element &&
                (!element.matches(":focus-within") || element.hasAttribute("data-backlink-task-focus"))
            ));
        }, true);
        // 键盘操作和正文输入恢复完整结构，避免在隐藏引用块时编辑正文。
        const restoreReferences = () => element.removeAttribute("data-backlink-task-focus");
        element.addEventListener("keydown", restoreReferences, true);
        element.addEventListener("beforeinput", restoreReferences, true);
        // 编辑后新增的正文立即保持可见，不等待反链请求刷新。
        element.addEventListener("focusout", event => {
            if (!(event.relatedTarget instanceof Node) || !element.contains(event.relatedTarget)) {
                restoreReferences();
            }
            element.querySelectorAll<HTMLElement>("[data-backlink-reference]").forEach(reference => {
                if (!isPureReference(reference)) {
                    reference.removeAttribute("data-backlink-reference");
                    reference.parentElement.removeAttribute("data-backlink-reference-list");
                }
            });
        });
    }
};

export const markBacklinkReference = (root: HTMLElement | DocumentFragment, referenceBlockID: string) => {
    if (!referenceBlockID) {
        return;
    }
    const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-node-id]"));
    if (root instanceof HTMLElement && root.hasAttribute("data-node-id")) {
        elements.unshift(root);
    }
    elements.forEach(element => {
        if (element.dataset.nodeId === referenceBlockID && isPureReference(element)) {
            element.setAttribute("data-backlink-reference", "true");
            const parent = element.parentElement;
            if (parent?.classList.contains("li") && parent.querySelector(":scope > [data-node-id]") === element) {
                parent.setAttribute("data-backlink-reference-list", "true");
            }
        }
    });
};
