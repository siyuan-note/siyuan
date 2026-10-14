import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("util.ts", readFileSync("src/editor/util.ts", "utf8"), ScriptTarget.ES2021, true);
const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => ["openFile", "openFileById"].includes(item.name.getText(source))));
const compiled = transpileModule(declarations.map(item => item.getText(source).replace(/^export /, "")).join("\n") +
    "\nglobalThis.open = openFile; globalThis.openById = openFileById;", {
    compilerOptions: {target: ScriptTarget.ES2021},
}).outputText;

const makeEditor = (name: string, activePane: boolean, focused: boolean, activeTime: number, rootID = "doc") => ({
    name,
    element: {activePane},
    headElement: {
        classList: {contains: (value: string) => value === "item--focus" && focused},
        getAttribute: (value: string) => value === "data-activetime" ? String(activeTime) : null,
    },
    editor: {protyle: {block: {rootID}}},
    parent: {parent: {element: {}}},
});

const setup = (editors: ReturnType<typeof makeEditor>[]) => {
    const switched: {editor: ReturnType<typeof makeEditor>, options: any}[] = [];
    let uninitializedChecks = 0;
    const context: any = {
        document: {querySelectorAll: (): Element[] => [], querySelector: (): Element => null},
        HTMLElement: class {},
        getAllModels: () => ({editor: editors}),
        hasClosestByClassName: (element: {activePane: boolean}, name: string) =>
            name === "layout__wnd--active" && element.activePane,
        pdfIsLoading: () => false,
        switchEditor: (editor: ReturnType<typeof makeEditor>, options: any) => switched.push({editor, options}),
        getUnInitTab: () => { uninitializedChecks++; },
        shouldCheckOtherWindows: () => false,
        getWndByLayout: (): undefined => undefined,
        window: {siyuan: {layout: {}}},
        fetchSyncPost: async () => ({code: 0, data: {rootID: "doc", rootTitle: "Document"}}),
    };
    runInNewContext(compiled, context);
    return {context, switched, getUninitializedChecks: () => uninitializedChecks};
};

for (const focusedIndex of [0, 1, 2]) {
    test(`reuses focused duplicate ${focusedIndex + 1} in the active pane`, async () => {
        const editors = [0, 1, 2].map(index => makeEditor(`tab-${index}`, true, index === focusedIndex, 100 + index));
        const {context, switched} = setup(editors);
        let opened: unknown;
        const result = await context.open({rootID: "doc", id: "heading", afterOpen: (editor: unknown) => { opened = editor; }});
        assert.equal(switched.length, 1);
        assert.equal(switched[0].editor, editors[focusedIndex]);
        assert.equal(opened, editors[focusedIndex]);
        assert.equal(result, editors[focusedIndex].parent);
    });
}

test("the active pane's focused document wins over a newer match in another pane", async () => {
    const editors = [makeEditor("other-pane", false, true, 300), makeEditor("current", true, true, 100)];
    const {context, switched} = setup(editors);
    await context.open({rootID: "doc", id: "doc"});
    assert.equal(switched[0].editor, editors[1]);
});

test("dock focus falls back to the most recently active matching document", async () => {
    const editors = [makeEditor("older", false, true, 100), makeEditor("recent", false, true, 200),
        makeEditor("unrelated", false, true, 300, "other")];
    const {context, switched} = setup(editors);
    await context.open({rootID: "doc", id: "heading"});
    assert.equal(switched[0].editor, editors[1]);
});

test("an unrelated focused tab preserves matching document reuse in the active pane", async () => {
    const editors = [makeEditor("hidden", true, false, 100), makeEditor("unrelated", true, true, 300, "other"),
        makeEditor("recent", false, true, 200)];
    const {context, switched} = setup(editors);
    await context.open({rootID: "doc", id: "heading"});
    assert.equal(switched[0].editor, editors[0]);
});

test("multiple hidden matches preserve the first active-pane fallback", async () => {
    const editors = [makeEditor("first-hidden", true, false, 100), makeEditor("second-hidden", true, false, 200),
        makeEditor("unrelated", true, true, 300, "other")];
    const {context, switched} = setup(editors);
    await context.open({rootID: "doc", id: "heading"});
    assert.equal(switched[0].editor, editors[0]);
});

for (const options of [
    {id: "doc"},
    {id: "heading", scrollPosition: "start", action: ["focus", "outline", "html"]},
    {id: "heading", zoomIn: true, action: ["focus", "all", "html"]},
    {id: "referenced-block", keepCursor: true},
]) {
    test(`openFileById preserves navigation options for ${JSON.stringify(options)}`, async () => {
        const editors = [makeEditor("hidden", true, false, 100), makeEditor("current", true, true, 200)];
        const {context, switched} = setup(editors);
        await context.openById({app: {}, ...options});
        assert.equal(switched.length, 1);
        assert.equal(switched[0].editor, editors[1]);
        for (const [key, value] of Object.entries(options)) {
            assert.equal(switched[0].options[key], value);
        }
    });
}

for (const options of [{openNewTab: true}, {position: "right"}, {position: "bottom"}]) {
    test(`explicit opening bypasses existing editor reuse: ${JSON.stringify(options)}`, async () => {
        const {context, switched, getUninitializedChecks} = setup([makeEditor("existing", true, true, 100)]);
        await context.open({rootID: "doc", id: "doc", ...options});
        assert.equal(switched.length, 0);
        assert.equal(getUninitializedChecks(), 0);
    });
}

test("uninitialized tab lookup remains available when no matching editor is loaded", async () => {
    const {context, switched, getUninitializedChecks} = setup([makeEditor("other", true, true, 100, "other")]);
    await context.open({rootID: "doc", id: "doc"});
    assert.equal(switched.length, 0);
    assert.equal(getUninitializedChecks(), 1);
});
