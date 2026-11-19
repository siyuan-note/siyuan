import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {canRunBrowser, runBrowserCase} from "../../../datePicker/test/browser";

test("attribute date scrolling does not borrow a nested relation table scroll container", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const source = readFileSync("src/protyle/render/av/cell.ts", "utf8");
    const fragment = source.slice(source.indexOf("export const cellScrollIntoView ="),
        source.indexOf("export const getTypeByCellElement ="));
    const scroll = transpileModule(fragment, {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText;
    const result = await runBrowserCase(async sources => {
        document.body.innerHTML = '<div class="protyle-db-row"><div id="attribute" data-av-type="table">' +
            '<div class="av__row"><span class="custom-attr__avvalue" data-col-id="date">2026-11-11</span></div>' +
            '<div class="av"><div class="av__header"></div><div class="av__scroll"></div></div></div></div>';
        const exports = {} as {cellScrollIntoView: (block: HTMLElement, cell: Element, onlyHeight: boolean) => void};
        new Function("exports", "ensureAVColumnWindow", "hasClosestByClassName", sources.scroll)(exports,
            (): undefined => undefined, (element: Element, name: string) => element.closest("." + name));
        const attribute = document.querySelector<HTMLElement>("#attribute");
        const nestedScroll = attribute.querySelector<HTMLElement>(".av__scroll");
        exports.cellScrollIntoView(attribute, attribute.querySelector(".custom-attr__avvalue"), false);
        if (nestedScroll.scrollLeft !== 0) { throw Error("Attribute editing must not move nested relation columns"); }
        const table = document.createElement("div");
        table.innerHTML = '<div class="av__scroll"><div class="av__body--unfreeze"><div class="av__row"><span class="av__cell" data-col-id="date">date</span></div></div></div>';
        document.body.append(table);
        exports.cellScrollIntoView(table, table.querySelector(".av__cell"), false);
        return "attribute and table scrolling passed";
    }, {scroll});
    assert.match(result, /attribute and table scrolling passed/);
});
