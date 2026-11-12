import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {compile, Logger} from "sass";
import {browserSources, canRunBrowser, runBrowserCase} from "../../../datePicker/test/browser";

test("table totals align with headers and fixed rows retain frozen columns across viewport changes", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sources = browserSources({render: "src/protyle/render/av/render.ts", row: "src/protyle/render/av/row.ts",
        frozen: "src/protyle/render/av/frozenColumns.ts"});
    Object.assign(sources, Object.fromEntries(["base", "mobile"].map(entry => [entry,
        compile(`src/assets/scss/${entry}.scss`, {logger: Logger.silent}).css])));
    Object.assign(sources, Object.fromEntries(["daylight", "midnight"].map(theme => [theme,
        readFileSync(`appearance/themes/${theme}/theme.css`, "utf8")])));
    const result = await runBrowserCase(async sources => {
        const check = (condition: boolean, message: string) => { if (!condition) throw Error(message); };
        const close = (actual: number, expected: number, context: string) =>
            check(Math.abs(actual - expected) < 1, `${context}: expected ${expected}, got ${actual}`);
        const frozen = {} as typeof import("./frozenColumns");
        new Function("exports", sources.frozen)(frozen);
        const row = {} as typeof import("./row");
        new Function("exports", "require", sources.row)(row, () => ({...frozen, hasTopClosestByAttribute: () => false}));
        const render = {} as {tableHTML: (data: unknown, element: HTMLElement, virtual?: unknown) => string};
        new Function("exports", "require", sources.render + "\nexports.tableHTML = getTableHTMLs;")(render, () => ({
            clampGroupTableVirtualData: (value: unknown) => value, getTableRowBudget: () => 100,
            GROUP_TABLE_INITIAL_ROW_BUDGET: 100, getColIconByType: () => "iconText",
            escapeAttr: (value: string) => value, escapeHtml: (value: string) => value, getCalcValue: () => "Total",
        }));
        Object.assign(window, {siyuan: {languages: {newCol: "Column", calc: "Calculate", newRow: "Add", loadMore: "More"}}});
        const style = document.createElement("style");
        document.head.append(style);
        const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        for (const entry of ["base", "mobile"]) {
            for (const theme of ["daylight", "midnight"]) {
                style.textContent = sources[entry] + sources[theme] +
                    "body{margin:0}.fixture{position:relative;margin:20px;width:500px;height:400px}" +
                    ".fixture .protyle-content{height:400px;overflow:auto}.fixture .protyle-wysiwyg{padding:0;min-height:0}";
                for (const fontSize of [16, 24]) {
                    for (const pin of [-1, 0, 1]) {
                        const context = `${entry}/${theme}/${fontSize}/${pin}`;
                        document.body.innerHTML = '<div class="protyle fixture"><div class="protyle-content">' +
                            '<div class="protyle-wysiwyg"><div style="height:120px"></div>' +
                            '<div class="av" data-av-type="table"><div class="av__container"><div class="av__scroll">' +
                            '<div class="av__body" style="float:left"></div></div></div></div><div style="height:400px"></div></div></div></div>';
                        const wysiwyg = document.querySelector<HTMLElement>(".protyle-wysiwyg");
                        wysiwyg.style.fontSize = `${fontSize}px`;
                        const outer = document.querySelector<HTMLElement>(".protyle-content");
                        const block = document.querySelector<HTMLElement>(".av");
                        const scroll = block.querySelector<HTMLElement>(".av__scroll");
                        const body = block.querySelector<HTMLElement>(".av__body");
                        const columns = [200, 120, 450].map((width, index) => ({id: `c${index}`, name: `C${index}`,
                            width: `${width}px`, type: index === 1 ? "lineNumber" : "text", pin: index === pin,
                            calc: {operator: index === 1 ? "" : "count"}}));
                        columns.splice(1, 0, {id: "hidden", name: "Hidden", width: "300px", type: "text", pin: false,
                            calc: {operator: ""}, ...{hidden: true}});
                        body.innerHTML = render.tableHTML({columns, rows: [], rowCount: 0}, block);
                        const header = body.querySelector<HTMLElement>(".av__row--header");
                        const footer = body.querySelector<HTMLElement>(".av__row--footer");
                        header.insertAdjacentHTML("afterend", '<div style="height:600px"></div>');
                        const aligned = () => {
                            for (const column of columns.filter(column => column.id !== "hidden")) {
                                const a = header.querySelector<HTMLElement>(`[data-col-id="${column.id}"]`).getBoundingClientRect();
                                const b = footer.querySelector<HTMLElement>(`[data-col-id="${column.id}"]`).getBoundingClientRect();
                                close(b.width, parseFloat(column.width), context + " total width " + column.id);
                                close(b.width, a.width, context + " header/total width " + column.id);
                                close(b.left, a.left, context + " header/total position " + column.id);
                            }
                        };
                        await frame();
                        aligned();
                        outer.scrollTop = 220;
                        await frame();
                        row.stickyRow(block, outer, "all");
                        check(header.classList.contains("av__row--header--fixed"), context + " header must be fixed");
                        check(footer.classList.contains("av__row--footer--fixed"), context + " footer must be fixed");
                        for (const left of [100, 180, 0]) {
                            scroll.scrollLeft = left;
                            scroll.dispatchEvent(new Event("scroll"));
                            aligned();
                            if (pin >= 0) {
                                for (const item of [header, footer]) {
                                    close(item.firstElementChild.getBoundingClientRect().left, scroll.getBoundingClientRect().left,
                                        context + " fixed frozen area remains at viewport left");
                                }
                            }
                        }
                        block.style.width = "120px";
                        row.stickyRow(block, outer, "all");
                        check(body.classList.contains("av__body--unfreeze") === (pin >= 0), context + " narrow viewport unfreezes");
                        scroll.scrollLeft = 100;
                        scroll.dispatchEvent(new Event("scroll"));
                        aligned();
                        close(header.firstElementChild.getBoundingClientRect().left,
                            scroll.getBoundingClientRect().left - scroll.scrollLeft, context + " narrow viewport scrolls the prefix");
                        block.style.width = "";
                        row.stickyRow(block, outer, "all");
                        check(!body.classList.contains("av__body--unfreeze"), context + " wider viewport restores freezing");
                        aligned();
                        outer.scrollTop = 0;
                        row.stickyRow(block, outer, "all");
                        check(!header.classList.contains("av__row--header--fixed"), context + " header returns to normal flow");
                        check(!header.style.getPropertyValue("--av-fixed-scroll-left"), context + " horizontal compensation is cleared");
                    }
                }
            }
        }
        return "Frozen table layout cases passed";
    }, sources);
    assert.match(result, /Frozen table layout cases passed/);
});
