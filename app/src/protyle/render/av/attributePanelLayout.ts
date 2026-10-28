const observedAttributeLayouts = new WeakSet<HTMLElement>();

export const getAVAttributeRows = (block: HTMLElement) => Array.from(block.children).filter((element): element is HTMLElement =>
    element instanceof HTMLElement && element.classList.contains("av__row") && !!element.dataset.colId);

export const updateAVAttributeLayout = (element: HTMLElement) => {
    const body = element.matches('[data-type="NodeAttributeView"]') ? element.parentElement : element;
    if (!body?.matches(".protyle-db-attr__body, .protyle-db-row__body")) return;
    const blocks = element.matches('[data-type="NodeAttributeView"]') ? [element] :
        Array.from(element.querySelectorAll<HTMLElement>(":scope > [data-type=\"NodeAttributeView\"]"));
    blocks.forEach(block => {
        const rows = getAVAttributeRows(block);
        const visible = rows.filter(row => getComputedStyle(row).display !== "none");
        const split = Math.ceil(visible.length / 2);
        const indices = new Map(visible.map((row, index) => [row, index]));
        rows.forEach(row => {
            const index = indices.get(row);
            const order = index === undefined ? 0 : index < split ? index * 2 : (index - split) * 2 + 1;
            if (row.style.getPropertyValue("--av-field-order") !== String(order)) {
                row.style.setProperty("--av-field-order", String(order));
            }
        });
    });
};

export const observeAVAttributeLayout = (element: HTMLElement) => {
    if (!element.matches(".protyle-db-attr__body, .protyle-db-row__body")) return;
    updateAVAttributeLayout(element);
    if (observedAttributeLayouts.has(element)) return;
    observedAttributeLayouts.add(element);
    const observer = new MutationObserver(records => {
        if (records.some(record => {
            const target = record.target as HTMLElement;
            return target === element || target.parentElement === element || target.classList?.contains("av__row");
        })) updateAVAttributeLayout(element);
    });
    observer.observe(element, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ["class", "data-empty", "data-panel-visibility", "data-panel-show-all"],
    });
};
