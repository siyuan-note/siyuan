import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {canRunBrowser, runBrowserCase} from "../../datePicker/test/browser";

test("pinned dock dividers reach a stable minimum across pointer samples and repeated drags", {
    skip: !canRunBrowser, timeout: 45000,
}, async () => {
    const source = createSourceFile("util.ts", readFileSync("src/layout/util.ts", "utf8"), ScriptTarget.Latest, true);
    const declaration = source.statements.filter(isVariableStatement).flatMap(statement =>
        Array.from(statement.declarationList.declarations)).find(item => item.name.getText(source) === "addResize");
    assert.ok(declaration);
    const code = transpileModule(`const addResize = ${declaration.initializer.getText(source)};`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const result = await runBrowserCase(async sources => {
        const equal = (actual: number, expected: number) => {
            if (Math.abs(actual - expected) > 1) throw Error(`${actual} != ${expected}`);
        };
        const addResize = new Function("getAllModels", "getAllEditor", "adjustLayout", "setTabPosition", "resizeTabs",
            "isWindow", sources.addResize + "\nreturn addResize;")(
            () => ({editor: [] as unknown[]}), (): unknown[] => [], () => {}, () => {}, () => {}, () => false,
        );
        const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        for (const position of ["Left", "Right", "Bottom"]) {
            for (const minimum of position === "Bottom" ? [64] : [232, 320]) {
                document.body.innerHTML = '<div id="panes"><div id="dock"></div><div class="layout__center fn__flex-1"></div></div>';
                const parent = document.getElementById("panes");
                const dock = document.getElementById("dock");
                const center = parent.querySelector<HTMLElement>(".layout__center");
                if (position !== "Left") parent.append(dock);
                parent.style.cssText = `display:flex;width:800px;height:600px;flex-direction:${position === "Bottom" ? "column" : "row"}`;
                dock.style.cssText = position === "Bottom" ? "height:300px;flex-shrink:0" : "width:400px;flex-shrink:0";
                center.style.cssText = "flex:1;min-width:0;min-height:0";
                let prepared = 0;
                let saves = 0;
                const docks = Object.fromEntries(["Left", "Right", "Bottom"].map(name => [name.toLowerCase() + "Dock", {
                    layout: {element: name === position ? dock : document.createElement("div")},
                    getResponsiveMinimumSize: () => minimum,
                    prepareForManualResize: () => prepared++, setSize: () => saves++,
                }]));
                Object.assign(window, {siyuan: {layout: docks}});
                addResize({resize: position === "Bottom" ? "tb" : "lr", element: dock});
                const divider = parent.querySelector<HTMLElement>(".layout__resize");
                divider.style.cssText = position === "Bottom" ? "height:4px;flex-shrink:0" : "width:4px;flex-shrink:0";
                const size = () => position === "Bottom" ? dock.clientHeight : dock.clientWidth;
                const drag = async (samples: number[], flushEverySample: boolean) => {
                    const initial = size();
                    divider.dispatchEvent(new MouseEvent("mousedown", {clientX: 500, clientY: 500}));
                    for (const shrink of samples) {
                        const delta = position === "Left" ? -shrink : shrink;
                        document.dispatchEvent(new MouseEvent("mousemove", {clientX: 500 + delta, clientY: 500 + delta}));
                        if (flushEverySample) {
                            await frame();
                            equal(size(), Math.max(Math.min(initial, minimum), initial - shrink));
                        }
                    }
                    document.dispatchEvent(new MouseEvent("mouseup"));
                    equal(size(), Math.max(Math.min(initial, minimum), initial - samples.at(-1)));
                    if (document.onmousemove || document.onmouseup || document.body.classList.contains("fn__pointer-none")) {
                        throw Error("Divider did not finish resizing");
                    }
                };
                await drag([20, 2000], true);
                equal(size(), minimum);
                await drag([-100, 0, 2000], true);
                equal(size(), minimum);
                await drag([-100], false);
                await drag([2000], false);
                equal(size(), minimum);
                dock.style[position === "Bottom" ? "height" : "width"] = "40px";
                await drag([100], false);
                equal(size(), 40);
                await drag([40 - minimum], false);
                equal(size(), minimum);
                if (position !== "Bottom" && prepared < 1 || saves < 1) throw Error("Dock state was not saved");
            }
        }
        return "Pinned dock resizing passed";
    }, {addResize: code});
    assert.match(result, /Pinned dock resizing passed/);
});
