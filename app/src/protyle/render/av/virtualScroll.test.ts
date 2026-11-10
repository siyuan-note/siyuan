import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {AVTableRowHeights} from "./tableRowHeights";
import * as groupTableVirtual from "./groupTableVirtual";

test("continuous input restores a target virtual window by row and group identity after sorting", () => {
    const source = readFileSync("src/protyle/render/av/virtualScroll.ts", "utf8");
    const code = source.match(/export const ensureAVTableRow =[\s\S]*?\n};/)[0];
    let mounted = false;
    let rebuilt = 0;
    const target = {dataset: {id: "row-105"}};
    const view = {rows: Array.from({length: 200}, (_, index) => ({id: `row-${index}`}))};
    const body = {dataset: {groupId: "group"}, closest: () => block, classList: {contains: () => false},
        querySelectorAll: () => mounted ? [target] : []};
    const block = {isConnected: true, dataset: {avType: "table"}, querySelectorAll: () => [body]};
    const state = {view, dataOffset: 40, rowHeight: 40};
    const exports = {} as typeof import("./virtualScroll");
    runInNewContext(transpileModule(code, {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022}}).outputText, {
        exports, getBodyData: () => view, bodyStates: new Map([[body, state]]), dataStore: new Map(),
        getBacklinkScrollElement: () => ({clientHeight: 400}), getTableBufferRatio: () => 1,
        getGroupTableViewportWindow: groupTableVirtual.getGroupTableViewportWindow,
        rebuildTableWindow: (_body: unknown, _state: unknown, window: {renderedStart: number; renderedEnd: number}) => {
            assert.ok(window.renderedStart <= 145 && window.renderedEnd >= 145);
            rebuilt++;
            mounted = true;
            return true;
        },
    });
    const restore = (id = "row-105", group = "group") => exports.ensureAVTableRow(block as unknown as HTMLElement, id, group);
    assert.equal(restore(), target);
    assert.equal(rebuilt, 1);
    assert.equal(restore(), target);
    assert.equal(rebuilt, 1, "an existing target is reused");
    assert.equal(restore("row-105", "other"), undefined);
    assert.equal(restore("deleted"), undefined);
    block.isConnected = false;
    assert.equal(restore(), undefined);
});

for (const viewType of ["table", "list"] as const) {
    test(`${viewType} nested virtual windows reserve every unmounted row at the measured height`, () => {
        const bottom = {dataset: {rowCount: "401"}, style: {height: "14436px"}};
        const rows = Array.from({length: 100}, (_, index) => ({
            dataset: {id: `row-${index}`, index: String(index)}, offsetHeight: 40,
        }));
        const body = {
            dataset: {groupId: ""}, closest: () => block,
            querySelectorAll: (selector: string): HTMLElement[] => selector === ".av__row[data-id]" ?
                rows as unknown as HTMLElement[] : [],
            querySelector: (selector: string): unknown => {
                if (selector === ".av__row[data-id]") return rows[0];
                if (selector === ".av__row--util") return {previousElementSibling: rows.at(-1)};
                if (selector === ".av__spacer--bottom") return bottom;
                return null;
            },
        };
        const block = {
            getAttribute: (key: string) => key === "data-v-scroll" ? "true" : viewType,
            querySelectorAll: () => [body],
        };
        const source = readFileSync("src/protyle/render/av/virtualScroll.ts", "utf8");
        const exports = {} as typeof import("./virtualScroll");
        runInNewContext(transpileModule(source, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
        }).outputText, {exports, requestAnimationFrame: () => 1,
            require: (name: string) => ({
                "./columnWindow": {initAVColumnWindow: () => {}},
                "./groupTableVirtual": groupTableVirtual,
                "../../../constants": {Constants: {ATTRIBUTE_V_SCROLL: "data-v-scroll"}},
                "./viewType": {isTableLikeView: (type: string) => type === "table" || type === "list"},
                "./backlinkScroll": {getBacklinkScrollElement: (): null => null},
                "./tableRowHeights": {AVTableRowHeights},
                "./selectionState": {reconcileAVSelectedItemIDs: () => new Set<string>()},
            }[name] || {}),
        });
        const view = {rows: Array.from({length: 501}, (_, index) => ({id: `row-${index}`})), nested: {}};
        exports.initVirtualScroll({blockElement: block as unknown as HTMLElement,
            protyle: {contentElement: {scrollTop: 0, getBoundingClientRect: () => ({top: 0, bottom: 600})}} as IProtyle,
            data: {viewType, view} as IAV});
        assert.equal(bottom.dataset.rowCount, "401");
        assert.equal(bottom.style.height, "16040px");
    });
}
