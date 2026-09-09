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
    if (protyle.options.backlinkData && !initialized.has(element)) {
        initialized.add(element);
        // 编辑后新增的正文立即保持可见，不等待反链请求刷新。
        element.addEventListener("focusout", () => {
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
