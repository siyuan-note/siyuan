import {before, describe, it} from "node:test";
import * as assert from "node:assert/strict";

let getHostVerticalTitleRegion: typeof import("./verticalRegion").getHostVerticalTitleRegion;
let getTableBoundaryCell: typeof import("./verticalRegion").getTableBoundaryCell;

before(async () => {
    Object.assign(globalThis, {SIYUAN_VERSION: "test", NODE_ENV: "test"});
    ({getHostVerticalTitleRegion, getTableBoundaryCell} = await import("./verticalRegion"));
});

class RegionElement {
    nodeType = 1;
    parentElement: RegionElement | null = null;
    title: RegionElement | null = null;
    content: RegionElement | null = null;
    constructor(private className: string) {}
    classList = {contains: (name: string) => this.className === name};
    querySelector(selector: string) {
        return selector.includes("title") ? this.title : this.content;
    }
    contains(node: RegionElement): boolean {
        return node === this || !!node.parentElement && this.contains(node.parentElement);
    }
}

const region = (name: string, parent?: RegionElement) => {
    const owner = new RegionElement(name);
    owner.parentElement = parent || null;
    owner.title = new RegionElement("callout-title");
    owner.title.parentElement = owner;
    owner.content = new RegionElement("content");
    owner.content.parentElement = owner;
    return owner;
};

describe("host vertical title ownership", () => {
    it("resolves each host title independently of shared title styling", () => {
        for (const name of ["callout", "tab-item", "av"]) {
            const owner = region(name);
            assert.equal(getHostVerticalTitleRegion(owner.title as unknown as Node)?.owner, owner);
        }
    });

    it("uses the tab item instead of an enclosing callout", () => {
        const callout = region("callout");
        const tab = region("tab-item", callout.content);
        assert.equal(getHostVerticalTitleRegion(tab.title as unknown as Node)?.owner, tab);
    });

    it("resolves a title through its paragraph wrapper and formatted text", () => {
        const tab = region("tab-item");
        const wrapper = new RegionElement("p");
        wrapper.parentElement = tab;
        tab.title.parentElement = wrapper;
        const text = {nodeType: 3, parentElement: tab.title};
        assert.equal(getHostVerticalTitleRegion(text as unknown as Node)?.owner, tab);
    });

    it("does not treat body content as a title", () => {
        const tab = region("tab-item", region("callout").content);
        assert.equal(getHostVerticalTitleRegion(tab.content as unknown as Node), undefined);
    });
});

const layoutRect = (left: number, right: number, top: number, bottom: number) => ({
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
});

describe("table vertical regions", () => {
    it("selects a cell from the boundary row at the horizontal goal", () => {
        const table = {rows: [], cells: []} as unknown as HTMLTableElement & {
            rows: HTMLTableRowElement[];
            cells: HTMLTableCellElement[];
        };
        const cell = (left: number, right: number, top: number, bottom: number) => ({
            classList: {contains: () => false},
            closest: () => table,
            getClientRects: () => [layoutRect(left, right, top, bottom)],
        }) as unknown as HTMLTableCellElement;
        const row = (top: number, bottom: number, cells: HTMLTableCellElement[]) => ({
            cells,
            closest: () => table,
            getClientRects: () => [layoutRect(0, 200, top, bottom)],
        }) as unknown as HTMLTableRowElement;
        const firstLeft = cell(0, 100, 0, 20);
        const firstRight = cell(100, 200, 0, 20);
        const lastLeft = cell(0, 100, 20, 40);
        const lastRight = cell(100, 200, 20, 40);
        table.rows.push(row(0, 20, [firstLeft, firstRight]), row(20, 40, [lastLeft, lastRight]));
        table.cells.push(firstLeft, firstRight, lastLeft, lastRight);
        table.querySelectorAll = (() => table.cells) as unknown as typeof table.querySelectorAll;

        assert.equal(getTableBoundaryCell(table, "down", 160), firstRight);
        assert.equal(getTableBoundaryCell(table, "up", 160), lastRight);
    });

    it("includes a row-spanning cell in the last logical row", () => {
        const table = {rows: [], cells: []} as unknown as HTMLTableElement & {
            rows: HTMLTableRowElement[];
            cells: HTMLTableCellElement[];
        };
        const spanningCell = {
            classList: {contains: () => false},
            closest: () => table,
            getClientRects: () => [layoutRect(0, 100, 0, 40)],
        } as unknown as HTMLTableCellElement;
        const lastCell = {
            classList: {contains: () => false},
            closest: () => table,
            getClientRects: () => [layoutRect(100, 200, 20, 40)],
        } as unknown as HTMLTableCellElement;
        const firstRow = {
            cells: [spanningCell],
            closest: () => table,
            getClientRects: () => [layoutRect(0, 200, 0, 20)],
        } as unknown as HTMLTableRowElement;
        const lastRow = {
            cells: [lastCell],
            closest: () => table,
            getClientRects: () => [layoutRect(0, 200, 20, 40)],
        } as unknown as HTMLTableRowElement;
        table.rows.push(firstRow, lastRow);
        table.cells.push(spanningCell, lastCell);
        table.querySelectorAll = (() => table.cells) as unknown as typeof table.querySelectorAll;

        assert.equal(getTableBoundaryCell(table, "up", 50), spanningCell);
    });
});
