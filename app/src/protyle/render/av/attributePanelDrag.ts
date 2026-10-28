import {getAVAttributeRows} from "./attributePanelLayout";

export interface IAVAttributeDropTarget {
    element: HTMLElement;
    before: boolean;
    horizontal: boolean;
}

export const clearAVAttributeDropTarget = (element: HTMLElement) => {
    element.querySelectorAll(".dragover__top, .dragover__bottom, .dragover__left, .dragover__right").forEach(item => {
        item.classList.remove("dragover__top", "dragover__bottom", "dragover__left", "dragover__right");
    });
};

export const getAVAttributeDropTarget = (block: HTMLElement, dragged: HTMLElement, x: number, y: number,
                                         hitElement?: HTMLElement): IAVAttributeDropTarget | undefined => {
    if (!block.isConnected || dragged.parentElement !== block) {
        return;
    }
    const rows = getAVAttributeRows(block).filter(row => row.getClientRects().length > 0);
    const candidates = rows.map(element => {
        const rect = element.getBoundingClientRect();
        const handle = element.querySelector<HTMLElement>('[draggable="true"]');
        const left = handle?.getClientRects().length ? Math.min(rect.left, handle.getBoundingClientRect().left) : rect.left;
        return {element, rect, left};
    })
        .filter(({rect}) => y >= rect.top && y <= rect.bottom);
    if (candidates.length === 0) {
        return;
    }
    const bounds = block.getBoundingClientRect();
    if (x < Math.min(bounds.left, ...candidates.map(item => item.left)) || x > bounds.right) {
        return;
    }
    const style = getComputedStyle(block);
    const horizontal = style.display === "grid" && style.gridTemplateColumns.split(" ").length === 2 &&
        style.getPropertyValue("--b3-database-attr-column-flow").trim() !== "1";
    let closest: typeof candidates[number];
    let distance = Infinity;
    for (const candidate of candidates) {
        const {rect} = candidate;
        if (candidate.element === hitElement && x >= candidate.left && x <= rect.right) {
            closest = candidate;
            break;
        }
        const dx = Math.max(candidate.left - x, 0, x - rect.right);
        const dy = Math.max(rect.top - y, 0, y - rect.bottom);
        const current = dx * dx + dy * dy;
        if (current < distance) {
            closest = candidate;
            distance = current;
        }
    }
    if (!closest) {
        return;
    }
    // 双栏中源字段移除后会让后续字段补位，向后移动时插在目标之后，才能占据目标原来的格位。
    const before = horizontal ? rows.indexOf(dragged) > rows.indexOf(closest.element) :
        y < closest.rect.top + closest.rect.height / 2;
    return {element: closest.element, before, horizontal};
};

export const getAVAttributePreviousID = (element: HTMLElement) => {
    const rows = getAVAttributeRows(element.parentElement);
    return rows[rows.indexOf(element) - 1]?.dataset.colId || "";
};

export const getAVAttributeSort = (dragged: HTMLElement, target: IAVAttributeDropTarget) => {
    const block = dragged.parentElement;
    if (!block || target.element.parentElement !== block || target.element === dragged) {
        return;
    }
    const rows = getAVAttributeRows(block);
    const oldIndex = rows.indexOf(dragged);
    if (oldIndex < 0) {
        return;
    }
    const undoPreviousID = rows[oldIndex - 1]?.dataset.colId || "";
    const remaining = rows.filter(row => row !== dragged);
    const targetIndex = remaining.indexOf(target.element);
    if (targetIndex < 0) {
        return;
    }
    const previousID = remaining[targetIndex - (target.before ? 1 : 0)]?.dataset.colId || "";
    if (previousID === undoPreviousID) {
        return;
    }
    return {id: dragged.dataset.colId, previousID, undoPreviousID};
};
