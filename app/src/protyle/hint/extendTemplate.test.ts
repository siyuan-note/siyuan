import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const loadInsertion = () => {
    const source = readFileSync("src/protyle/hint/extend.ts", "utf8");
    const start = source.indexOf("const templateInsertRequests");
    const end = source.indexOf("export const hintRenderWidget", start);
    assert.ok(start >= 0 && end > start);
    const pending: Array<{callback: (response: object) => void; signal: AbortSignal}> = [];
    const inserted: string[] = [];
    const focused: object[] = [];
    const confirms: Array<() => void> = [];
    const exports: {hintRenderTemplate?: (path: string, protyle: object, node: object) => void} = {};
    const range = {startContainer: {isConnected: true}};
    const protyle = {block: {rootID: "original", parentID: "parent"}, toolbar: {range: {cloneRange: () => range}},
        wysiwyg: {element: {isConnected: true, closest: (): Element => null, querySelectorAll: (): Element[] => []}}};
    const node = {isConnected: true};
    runInNewContext(transpileModule(source.slice(start, end), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2022},
    }).outputText, {
        exports,
        window: {siyuan: {languages: {}}},
        guardTemplateHTTPRequest: () => {
            const controller = new AbortController();
            return {signal: controller.signal, cancel: () => controller.abort(), dispose: () => {}};
        },
        fetchPost: (_url: string, _data: object, callback: (response: object) => void, _headers: object,
                    _failure: unknown, signal: AbortSignal) => {
            pending.push({callback, signal});
            return Promise.resolve();
        },
        getContenteditableElement: (): Element => null,
        focusByRange: (value: object) => focused.push(value),
        insertHTML: (value: string) => inserted.push(value),
        blockRender: () => {}, processRender: () => {}, highlightRender: () => {}, hideElements: () => {},
        genTemplateDocTreePlanHTML: () => "plan",
        confirmDialog: (_title: string, _text: string, confirm: () => void) => confirms.push(confirm),
    });
    return {pending, inserted, focused, confirms, range, protyle, node,
        start: () => exports.hintRenderTemplate("template", protyle, node),
        respond: (index: number, plan = false) => pending[index].callback({data: {content: "rendered",
            ...(plan ? {docTreePlan: {id: "plan"}} : {})}})};
};

test("repeated template insertion cancels the obsolete transport and ignores its response", () => {
    const state = loadInsertion();
    state.start();
    state.start();
    assert.equal(state.pending[0].signal.aborted, true);
    state.respond(0);
    assert.equal(state.inserted.length, 0);
    state.respond(1);
    assert.deepEqual(state.inserted, ["rendered"]);
    assert.equal(state.focused[0], state.range);
});

test("navigation and detached source ranges cannot receive delayed template content", () => {
    for (const change of ["root", "parent", "node", "range"]) {
        const state = loadInsertion();
        state.start();
        if (change === "root") state.protyle.block.rootID = "new-root";
        if (change === "parent") state.protyle.block.parentID = "new-parent";
        if (change === "node") state.node.isConnected = false;
        if (change === "range") state.range.startContainer.isConnected = false;
        state.respond(0);
        assert.equal(state.inserted.length, 0);
    }
});

test("document-tree approval rechecks the original document after HTTP rendering finishes", () => {
    const state = loadInsertion();
    state.start();
    state.respond(0, true);
    state.protyle.block.rootID = "new-root";
    state.confirms[0]();
    assert.equal(state.inserted.length, 0);
});
