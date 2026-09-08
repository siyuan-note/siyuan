import {setTabTitleNavigationEditing} from "../render/tabsRender";
import type {TVerticalDirection} from "./verticalCaret";
import {getHorizontalDistanceToRect} from "./verticalGeometry";

export interface IHostVerticalRegion {
    owner: HTMLElement;
    title: HTMLElement | null;
    content: HTMLElement | null;
    database: boolean;
    setTitleEditing?: (editing: boolean) => boolean;
}

const hostRegions = [
    {className: "callout", title: ":scope > .callout-info > .callout-title", content: ":scope > .callout-content"},
    {className: "tab-item", title: ":scope > .tab-item-info > .tab-item-title, " +
        ":scope > .tab-item-info > [tabs-title] > .tab-item-title", content: ":scope > .tab-item-content"},
    {className: "av", title: ".av__title", content: ""},
];

export const getHostVerticalRegion = (element: Element): IHostVerticalRegion | undefined => {
    const descriptor = hostRegions.find(item => element.classList.contains(item.className));
    if (!descriptor) {
        return;
    }
    return {
        owner: element as HTMLElement,
        title: element.querySelector<HTMLElement>(descriptor.title),
        content: descriptor.content ? element.querySelector<HTMLElement>(descriptor.content) : null,
        database: descriptor.className === "av",
        setTitleEditing: descriptor.className === "tab-item" ?
            editing => setTabTitleNavigationEditing(element as HTMLElement, editing) : undefined,
    };
};

export const getHostVerticalTitleRegion = (node: Node): IHostVerticalRegion | undefined => {
    const element = node.nodeType === 3 ? node.parentElement : node as Element;
    let ancestor: Element | null = element;
    while (ancestor && !ancestor.classList.contains("protyle-wysiwyg")) {
        const region = getHostVerticalRegion(ancestor);
        if (region) {
            return region.title?.contains(node) ? region : undefined;
        }
        ancestor = ancestor.parentElement;
    }
};

const getLayoutRect = (element: Element) => Array.from(element.getClientRects())
    .find(rect => rect.width > 0.5 && rect.height > 0.5);

export const getTableBoundaryCell = (table: HTMLTableElement, direction: TVerticalDirection,
                                     goalX: number): HTMLTableCellElement | undefined => {
    const rows = Array.from(table.rows).filter(row => row.closest("table") === table && getLayoutRect(row));
    const boundaryRow = rows[direction === "down" ? 0 : rows.length - 1];
    const rowRect = boundaryRow && getLayoutRect(boundaryRow);
    if (!rowRect) {
        return;
    }
    let cells = Array.from(table.querySelectorAll<HTMLTableCellElement>("th, td")).filter(cell => {
        if (cell.closest("table") !== table || cell.classList.contains("fn__none")) {
            return false;
        }
        const rect = getLayoutRect(cell);
        return rect && Math.min(rect.bottom, rowRect.bottom) - Math.max(rect.top, rowRect.top) > 0.5;
    });
    if (cells.length === 0) {
        cells = Array.from(boundaryRow.cells).filter(cell => !cell.classList.contains("fn__none") && getLayoutRect(cell));
    }
    let closestCell: HTMLTableCellElement | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    let closestCenterDistance = Number.POSITIVE_INFINITY;
    cells.forEach(cell => {
        const rect = getLayoutRect(cell);
        if (!rect) {
            return;
        }
        const distance = getHorizontalDistanceToRect(goalX, rect);
        const centerDistance = Math.abs(goalX - (rect.left + rect.right) / 2);
        if (distance < closestDistance || (distance === closestDistance && centerDistance < closestCenterDistance)) {
            closestCell = cell;
            closestDistance = distance;
            closestCenterDistance = centerDistance;
        }
    });
    return closestCell;
};
