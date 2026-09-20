import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {getZoomFocusScrollAttr, shouldFocusAfterZoom} from "../protyle/util/focusRestore";

const source = createSourceFile("protyle.ts", readFileSync("src/menus/protyle.ts", "utf8"), ScriptTarget.ES2021, true);
const declaration = source.statements.find(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(source) === "zoomOut"));
const compiled = transpileModule(declaration.getText(source).replace(/^export /, "") + "\nglobalThis.zoom = zoomOut;", {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const exitFocus = async (parentID: string, code = 0) => {
    const renders: any[] = [];
    let response: Promise<void>;
    const element = {
        getBoundingClientRect: () => ({height: 20}),
        classList: {contains: () => false},
    };
    const context: any = {
        window: {siyuan: {config: {editor: {dynamicLoadBlocks: 64}}}},
        Constants: {CB_GET_HTML: "html", CB_GET_FOCUS: "focus"},
        isPhablet: () => false,
        isEncryptedBox: () => false,
        hasClosestByClassName: (): undefined => undefined,
        fetchPost: (_url: string, _params: unknown, callback: (data: unknown) => Promise<void>) => {
            response = callback({});
        },
        fetchSyncPost: async () => ({code, data: {parentID}}),
        onGet: (options: unknown) => renders.push(options),
        getZoomFocusScrollAttr,
        shouldFocusAfterZoom,
        getFirstBlock: (target: unknown) => target,
        focusBlock: () => {},
        focusByOffset: () => {},
    };
    runInNewContext(compiled, context);
    context.zoom({
        protyle: {
            options: {},
            block: {rootID: "root"},
            wysiwyg: {element: {querySelector: () => element}},
        },
        id: "root",
        focusId: "nested-block",
        focusPosition: {start: 2, end: 2},
    });
    await response;
    return renders[0];
};

test("exiting a folded search result restores focus to the visible ancestor before rendering", async () => {
    const render = await exitFocus("folded-list-item");
    assert.equal(render.scrollAttr.focusId, "folded-list-item");
    assert.equal(render.scrollAttr.focusStart, undefined);
    assert.equal(render.scrollAttr.focusEnd, undefined);
    assert.equal(render.focusAfterZoom, true);
    assert.ok(render.action.includes("focus"));
});

test("exiting a visible block preserves its cursor offsets", async () => {
    const render = await exitFocus("nested-block");
    assert.equal(render.scrollAttr.focusId, "nested-block");
    assert.equal(render.scrollAttr.focusStart, 2);
    assert.equal(render.scrollAttr.focusEnd, 2);
});

test("an unavailable ancestor does not discard the original focus target", async () => {
    for (const [parentID, code] of [["", 0], ["", -1]] as const) {
        const render = await exitFocus(parentID, code);
        assert.equal(render.scrollAttr.focusId, "nested-block");
        assert.equal(render.scrollAttr.focusStart, 2);
    }
});
