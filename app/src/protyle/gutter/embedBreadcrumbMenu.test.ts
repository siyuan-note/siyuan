import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

test("breadcrumb submenus persist overrides and delete attributes when returning to defaults", () => {
    const constants = {} as typeof import("../../constants");
    runInNewContext(transpileModule(readFileSync("src/constants.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {exports: constants, SIYUAN_VERSION: "test", NODE_ENV: "test"});
    const attributes = new Map<string, string>([["data-node-id", "embed"]]);
    const nodeElement = {
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
    };
    const requests: unknown[] = [];
    let saved: () => void;
    let renders = 0;
    const api: {embedBreadcrumbMenu?: (protyle: object, node: object) => IMenu[]} = {};
    const dependencies = {...constants,
        fetchPost: (url: string, data: unknown, callback: () => void) => {
            requests.push([url, JSON.parse(JSON.stringify(data))]); saved = callback;
        },
        blockRender: (_protyle: object, node: object) => {
            assert.equal(node, nodeElement);
            assert.equal(attributes.has("data-render"), false);
            renders++;
        },
    };
    runInNewContext(transpileModule(readFileSync("src/protyle/gutter/embedBreadcrumbMenu.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText, {exports: api, require: () => dependencies,
        window: {siyuan: {languages: new Proxy({}, {get: (_, key) => key})}}});
    const open = () => api.embedBreadcrumbMenu({}, nodeElement);
    for (const [index, attribute] of ["breadcrumb", constants.Constants.CUSTOM_SY_EMBED_BREADCRUMB_PARENT_PATH].entries()) {
        assert.deepEqual(Array.from(open()[index].submenu, item => item.id), ["enable", "disable", "default"]);
        for (const [id, value] of [["disable", "false"], ["enable", "true"], ["default", null]]) {
            const parent = open()[index];
            assert.equal(parent.type, "submenu");
            assert.equal(parent.iconHTML, "", "no placeholder icon is rendered");
            const option = parent.submenu.find(item => item.id === id);
            assert.equal(option.iconHTML, "");
            attributes.set("data-render", "true");
            const previous = attributes.get(attribute);
            option.click(undefined, undefined);
            assert.equal(attributes.get(attribute), previous, "failed or pending saves preserve the current preference");
            saved();
            assert.equal(attributes.get(attribute) ?? null, value);
            assert.deepEqual(requests.at(-1), ["/api/attr/setBlockAttrs", {id: "embed", attrs: {[attribute]: value}}]);
            assert.deepEqual(Array.from(open()[index].submenu.filter(item => item.checked), item => item.id), [id]);
        }
    }
    assert.equal(renders, 6);
});
