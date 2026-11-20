import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {transpileModule, ModuleKind, ScriptTarget} from "typescript";

test("select menus retain their anchor after a field is replaced and still avoid viewport overflow", () => {
    const viewport = {innerWidth: 1200, innerHeight: 800};
    const positionExports = {} as typeof import("./cellPanelPosition");
    const compile = (file: string) => transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
    }).outputText;
    runInNewContext(compile(join(__dirname, "cellPanelPosition.ts")), {
        exports: positionExports,
        require: () => ({getTopBarHeight: () => 30, isMobile: () => false}),
        window: viewport,
    });
    const exports = {} as typeof import("./selectPosition");
    runInNewContext(compile(join(__dirname, "selectPosition.ts")), {
        exports, require: () => positionExports,
    });
    let height = 100;
    const menu = {
        style: {left: "", top: ""},
        dataset: {} as Record<string, string>,
        getBoundingClientRect() {
            const left = parseFloat(this.style.left);
            const top = parseFloat(this.style.top);
            return {left, top, right: left + 200, bottom: top + height, height, width: 200};
        },
    };
    let rect = {left: 900, top: 590};
    const field = {isConnected: true, getBoundingClientRect: () => rect};
    const position = () => exports.setSelectMenuPosition(menu as unknown as HTMLElement,
        field as unknown as HTMLElement);
    position();
    assert.equal(menu.style.left, "900px");
    assert.equal(menu.style.top, "590px");

    field.isConnected = false;
    rect = {left: 0, top: 0};
    height = 220;
    position();
    assert.equal(menu.style.left, "900px");
    assert.equal(menu.style.top, "580px");
    assert.ok(parseFloat(menu.style.top) + height <= viewport.innerHeight);
    height = 100;
    position();
    assert.equal(menu.style.top, "590px");

    field.isConnected = true;
    rect = {left: 1100, top: 20};
    position();
    assert.equal(menu.style.left, "1000px");
    assert.equal(menu.style.top, "30px");

    field.isConnected = false;
    const otherMenu = {style: {}, dataset: {}};
    exports.setSelectMenuPosition(otherMenu as unknown as HTMLElement, field as unknown as HTMLElement);
    assert.deepEqual(otherMenu.style, {});
});
