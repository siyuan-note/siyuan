export const preserveRelationPosition = (list: HTMLElement, movingRow?: HTMLElement) => {
    const scrollTop = list.scrollTop;
    const scrollLeft = list.scrollLeft;
    const top = list.getBoundingClientRect().top;
    const candidates = Array.from(list.querySelectorAll<HTMLElement>('[data-relation-type="candidate"]'));
    const anchor = candidates.find(row => row !== movingRow && row.getBoundingClientRect().bottom > top);
    const anchorID = anchor?.dataset.rowId;
    const anchorTop = anchor?.getBoundingClientRect().top;
    let current = list.querySelector<HTMLElement>(".b3-menu__item--current");
    if (current === movingRow && movingRow?.dataset.relationType === "candidate") {
        const index = candidates.indexOf(movingRow);
        current = candidates[index + 1] || candidates[index - 1];
    }
    const currentID = current?.dataset.rowId;
    return () => {
        const rows = Array.from(list.querySelectorAll<HTMLElement>("[data-row-id]"));
        const restoredAnchor = rows.find(row => row.dataset.rowId === anchorID && row.dataset.relationType === "candidate");
        list.scrollTop = restoredAnchor ? list.scrollTop + restoredAnchor.getBoundingClientRect().top - anchorTop : scrollTop;
        list.scrollLeft = scrollLeft;
        if (currentID) {
            list.querySelectorAll(".b3-menu__item--current").forEach(row => row.classList.remove("b3-menu__item--current"));
            rows.find(row => row.dataset.rowId === currentID)?.classList.add("b3-menu__item--current");
        }
    };
};
