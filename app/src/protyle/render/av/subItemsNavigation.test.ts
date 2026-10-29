import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {clampGroupTableVirtualData} from "./groupTableVirtual";

it("folding a repeated group row restores that occurrence, preserves its viewport anchor and resets stale virtual windows", () => {
    const module = {exports: {}};
    const queries: string[] = [];
    const removed: string[] = [];
    const changes: unknown[][] = [];
    const anchors: unknown[][] = [];
    let focused = false;
    let canceledLocate = false;
    const body = {dataset: {groupId: "second"}};
    const row = {dataset: {id: "shared"}, getBoundingClientRect: () => ({top: 200, height: 36})};
    const replacement = {getBoundingClientRect: () => ({top: 236}),
        querySelector: () => ({focus: () => { focused = true; }})};
    const block = {removeAttribute: (key: string) => removed.push(key),
        querySelector: (selector: string) => {
            queries.push(selector);
            return {querySelector: (inner: string) => { queries.push(inner); return replacement; }};
        }};
    const protyle = {contentElement: {scrollTop: 1000}};
    runInNewContext(ts.transpileModule(readFileSync(join(__dirname, "subItemsNavigation.ts"), "utf8"), {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
    }).outputText, {module, exports: module.exports,
        require: (id: string) => ({
            "../../../constants": {Constants: {ATTRIBUTE_V_SCROLL: "v-scroll"}},
            "./render": {avRender: (_block: HTMLElement, _protyle: IProtyle, callback: () => void) => callback()},
            "./subItemsState": {toggleSubItems: (...args: unknown[]) => changes.push(args),
                setSubItemsViewportAnchor: (...args: unknown[]) => anchors.push(args)},
            "./backlinkScroll": {getBacklinkScrollElement: (): HTMLElement | undefined => undefined},
            "./locateState": {locateRequests: {delete: () => { canceledLocate = true; }}},
        }[id]),
    });
    const api = module.exports as typeof import("./subItemsNavigation");
    const target = {getAttribute: (key: string) => key === "data-type" ? "av-sub-items-toggle" : "true",
        closest: (selector: string) => selector === ".av__body" ? body : row};
    assert.equal(api.navigateSubItems(target as unknown as Element, block as unknown as HTMLElement, protyle as IProtyle), true);
    assert.equal(canceledLocate, true);
    assert.deepEqual(removed, ["v-scroll", "data-render"]);
    assert.equal(changes[0][2], "second");
    assert.equal(changes[0][4], false);
    assert.equal(anchors[0][2], "second");
    assert.deepEqual(queries, ['.av__body[data-group-id="second"]', '.av__row[data-id="shared"]']);
    assert.equal(protyle.contentElement.scrollTop, 1036);
    assert.equal(focused, true);
});

it("expanded table/list data uses the row window budget even when its root page is small", () => {
    const source = ts.createSourceFile("render.ts", readFileSync(join(__dirname, "render.ts"), "utf8"), ts.ScriptTarget.ES2022, true);
    const statement = source.statements.find(node => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some(declaration => declaration.name.getText(source) === "getTableHTMLs"));
    assert.ok(statement);
    const mounted: number[] = [];
    const attributes: string[] = [];
    const dependencies = {
        clampGroupTableVirtualData,
        getRowHTML: (options: {rowIndex: number}) => { mounted.push(options.rowIndex); return "<div></div>"; },
        Constants: {ATTRIBUTE_V_SCROLL: "v-scroll"},
        window: {siyuan: {languages: {avSubItemsCounts: "${roots}/${matches}"}}},
        escapeHtml: (value: string) => value,
        GROUP_TABLE_ESTIMATED_ROW_HEIGHT: 36,
    };
    const render = new Function(...Object.keys(dependencies), ts.transpileModule(statement.getText(source), {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText + "\nreturn getTableHTMLs;")(...Object.values(dependencies));
    const rows = Array.from({length: 501}, (_, index) => ({id: `item-${index}`}));
    const data = {columns: [] as IAVColumn[], rows, rowCount: 10001, pageSize: 50,
        nested: {rootCount: 10000, rootLoaded: 50, matchedCount: 10001, page: 1, pageSize: 50}};
    for (const avType of ["table", "list"]) {
        mounted.length = 0;
        render(data, {dataset: {avType}, setAttribute: (key: string) => attributes.push(key)});
        assert.equal(mounted.length, 100);
        assert.equal(mounted[99], 99);
        assert.equal(attributes.at(-1), "v-scroll");
        mounted.length = 0;
        render(data, {dataset: {avType}, setAttribute: () => {}},
            {renderedStart: 150, renderedEnd: 249, topSpacerHeight: 5400});
        assert.equal(mounted.length, 100);
        assert.equal(mounted[0], 150);
        assert.equal(mounted[99], 249);
    }
});
