import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

for (const viewType of ["table", "list"] as const) {
    test(`${viewType} nested virtual windows reserve every unmounted row at the measured height`, () => {
        const bottom = {dataset: {rowCount: "401"}, style: {height: "14436px"}};
        const rows = Array.from({length: 100}, (_, index) => ({
            dataset: {id: `row-${index}`, index: String(index)}, offsetHeight: 40,
        }));
        const body = {
            dataset: {groupId: ""}, closest: () => block,
            querySelectorAll: (): HTMLElement[] => [],
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
                "../../../constants": {Constants: {ATTRIBUTE_V_SCROLL: "data-v-scroll"}},
                "./viewType": {isTableLikeView: (type: string) => type === "table" || type === "list"},
                "./backlinkScroll": {getBacklinkScrollElement: (): null => null},
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
