import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {clampGroupTableVirtualData} from "./groupTableVirtual";

const source = ts.createSourceFile("render.ts", readFileSync(join(__dirname, "render.ts"), "utf8"),
    ts.ScriptTarget.ES2022, true);
const statement = source.statements.find(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some(declaration => declaration.name.getText(source) === "getTableHTMLs"));
assert.ok(statement);
const compiled = ts.transpileModule(statement.getText(source), {
    compilerOptions: {target: ts.ScriptTarget.ES2022},
}).outputText;

const setup = (avType: "table" | "list") => {
    const mounted: number[] = [];
    const attributes = new Map<string, string>();
    const render = runInNewContext(compiled + "\ngetTableHTMLs;", {
        clampGroupTableVirtualData,
        getRowHTML: ({rowIndex}: {rowIndex: number}) => { mounted.push(rowIndex); return "<div></div>"; },
        Constants: {ATTRIBUTE_V_SCROLL: "data-v-scroll"},
        window: {siyuan: {languages: {}}},
    }) as (data: IAVTable, element: HTMLElement, virtualData?: IAVVirtualData) => string;
    const block = {dataset: {avType}, setAttribute: (name: string, value: string) => attributes.set(name, value)};
    return {
        mounted, attributes,
        render: (count: number, pageSize: number, virtualData?: IAVVirtualData) => {
            mounted.length = 0;
            return render({columns: [], rows: Array.from({length: count}, (_, id) => ({id: String(id)})),
                rowCount: 500, pageSize} as IAVTable, block as unknown as HTMLElement, virtualData);
        },
    };
};

for (const avType of ["table", "list"] as const) {
    test(`${avType} cumulative loading bounds mounted rows independently of the page step`, () => {
        for (const pageSize of [50, 100, 200]) {
            for (const count of [0, 50, 100, 101, 167, 500]) {
                const h = setup(avType);
                const html = h.render(count, pageSize);
                assert.equal(h.mounted.length, Math.min(count, 100), `${pageSize}/${count}`);
                assert.equal(h.attributes.has("data-v-scroll"), count > 100, `${pageSize}/${count}`);
                assert.match(html, new RegExp(`data-size="${pageSize}"`));
            }
        }
    });

    test(`${avType} shrinking results restores visible rows instead of retaining an out-of-range window`, () => {
        const h = setup(avType);
        const restored = {renderedStart: 90, renderedEnd: 99, topSpacerHeight: 3240};
        const html = h.render(3, 200, restored);
        assert.deepEqual(h.mounted, [0, 1, 2]);
        assert.doesNotMatch(html, /av__spacer/);
        assert.deepEqual(restored, {renderedStart: 90, renderedEnd: 99, topSpacerHeight: 3240});
        assert.doesNotMatch(h.render(0, 200, restored), /av__spacer/);
        assert.deepEqual(h.mounted, []);
    });

    test(`${avType} refresh retains a valid deep window and clips its end to the remaining results`, () => {
        const h = setup(avType);
        const restored = {renderedStart: 90, renderedEnd: 99, topSpacerHeight: 3240};
        assert.match(h.render(167, 100, restored), /height: 3240px/);
        assert.deepEqual(h.mounted, Array.from({length: 10}, (_, id) => 90 + id));
        h.render(95, 100, restored);
        assert.deepEqual(h.mounted, [90, 91, 92, 93, 94]);
    });

    test(`${avType} located windows retain their absolute row indexes`, () => {
        const h = setup(avType);
        const html = h.render(167, 100, {renderedStart: 10, renderedEnd: 19,
            topSpacerHeight: 360, rowOffset: 400, locate: true});
        assert.deepEqual(h.mounted, Array.from({length: 10}, (_, id) => 410 + id));
        assert.match(html, /height: 360px/);
    });
}
