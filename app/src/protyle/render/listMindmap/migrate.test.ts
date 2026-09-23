import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("migrate.ts", readFileSync("src/protyle/render/listMindmap/migrate.ts", "utf8"), ScriptTarget.Latest, true);
const code = source.statements.filter(isVariableStatement).filter(statement =>
    !statement.declarationList.declarations.some(item => item.name.getText(source) === "replaceLegacyMindmapHTML"))
    .map(statement => statement.getText(source)).join("\n");

const setup = () => {
    const calls: unknown[] = [];
    const completions: ((response: unknown) => void)[] = [];
    const Constants = {
        CUSTOM_SY_READONLY: "custom-sy-readonly", CUSTOM_SY_LIST_MINDMAP: "custom-sy-list-mindmap",
        CB_GET_HISTORY: "history", CB_GET_BACKLINK: "backlink",
        CB_GET_APPEND: "append", CB_GET_BEFORE: "before",
    };
    const exports: {
        migrateLegacyMindmapsBeforeRender?: (...args: unknown[]) => boolean;
        cancelLegacyMindmapMigration?: (protyle: unknown) => void;
    } = {};
    const window = {siyuan: {config: {readonly: false, editor: {readOnly: false}}}};
    runInNewContext(transpileModule(code, {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText, {
        exports, Constants, window, console,
        replaceLegacyMindmapHTML: (html: string) => html,
        waitForPendingTransactions: async (): Promise<void> => undefined,
        fetchSyncPost: (...args: unknown[]) => {
            calls.push(args);
            return new Promise(resolve => completions.push(resolve));
        },
    });
    const protyle = {
        block: {rootID: "doc"}, notebookId: "box", options: {}, disabled: false,
        wysiwyg: {element: {getAttribute: (): string | null => null}, flushPendingInput: (): void => undefined},
    };
    return {run: exports.migrateLegacyMindmapsBeforeRender, cancel: exports.cancelLegacyMindmapMigration,
        protyle, calls, completions, window};
};

const tick = () => new Promise(resolve => setImmediate(resolve));
const mindmap = (content: string) => `<div data-type="NodeCodeBlock" data-subtype="mindmap">${content}</div>`;
const oldListMindmap = (content: string) => `<div data-type="NodeList" custom-sy-list-mindmap="1">${content}</div>`;

test("closing the editor cancels rendering while a migration request is pending", async () => {
    const {run, cancel, protyle, completions} = setup();
    run(protyle, mindmap("source"), [], () => assert.fail("closed editor rendered"));
    await tick();
    cancel(protyle);
    completions[0]({code: 0, data: {blocks: []}});
    await tick();
});

test("opening a document migrates once and resumes only the newest pending render", async () => {
    const {run, protyle, calls, completions} = setup();
    const rendered: string[] = [];
    assert.equal(run(protyle, mindmap("old render"), [], (html: string) => rendered.push(html)), true);
    assert.equal(run(protyle, mindmap("latest render"), [], (html: string) => rendered.push(html)), true);
    await tick();
    assert.equal(calls.length, 1);
    completions[0]({code: 0, data: {blocks: []}});
    await tick();
    assert.deepEqual(rendered, [mindmap("latest render")]);
    assert.equal(run(protyle, mindmap("undo"), [], () => assert.fail("undo retriggered migration")), false);
    assert.equal(calls.length, 1);
});

test("a visible old list mind map waits for its type migration", async () => {
    const {run, protyle, calls, completions} = setup();
    const rendered: string[] = [];
    assert.equal(run(protyle, oldListMindmap("old"), [], (html: string) => rendered.push(html)), true);
    await tick();
    assert.equal(calls.length, 1);
    completions[0]({code: 0, data: {blocks: []}});
    await tick();
    assert.deepEqual(rendered, [oldListMindmap("old")]);
});

test("ordinary documents render while the full document migration runs", async () => {
    const {run, protyle, calls, completions} = setup();
    assert.equal(run(protyle, "<div data-type=\"NodeParagraph\">Content</div>", [], () => assert.fail("render deferred")), false);
    await tick();
    assert.equal(calls.length, 1);
    completions[0]({code: 0, data: {blocks: []}});
    await tick();
});

test("ordinary content supersedes a pending mind map migration", async () => {
    const {run, protyle, completions} = setup();
    run(protyle, mindmap("old"), [], () => assert.fail("stale content rendered"));
    await tick();
    assert.equal(run(protyle, "<div data-type=\"NodeParagraph\">New</div>", [], () => assert.fail("render deferred")), false);
    completions[0]({code: 0, data: {blocks: []}});
    await tick();
});

test("a visible mind map waits for an already running full document migration", async () => {
    const {run, protyle, calls, completions} = setup();
    const rendered: string[] = [];
    assert.equal(run(protyle, "ordinary content", [], () => assert.fail("ordinary content deferred")), false);
    await tick();
    assert.equal(run(protyle, mindmap("visible"), [], (html: string) => rendered.push(html)), true);
    assert.equal(calls.length, 1);
    completions[0]({code: 0, data: {blocks: []}});
    await tick();
    assert.deepEqual(rendered, [mindmap("visible")]);
});

test("read-only, history, backlink, paging and local editors never request migration", async () => {
    for (const mode of ["readonly", "editorReadonly", "disabled", "lite", "history", "backlink", "append", "before", "preview"]) {
        const {run, protyle, calls, window} = setup();
        const actions: string[] = [];
        if (mode === "readonly") {
            window.siyuan.config.readonly = true;
        } else if (mode === "editorReadonly") {
            window.siyuan.config.editor.readOnly = true;
        } else if (["disabled", "lite"].includes(mode)) {
            Object.assign(protyle, {[mode]: true});
        } else if (mode === "preview") {
            Object.assign(protyle.options, {mode: "preview"});
        } else {
            actions.push(mode);
        }
        assert.equal(run(protyle, "source", actions, () => assert.fail(mode)), false, mode);
        await tick();
        assert.equal(calls.length, 0, mode);
    }
});

test("migration failure still opens source and a stale document response cannot replace the current document", async () => {
    const {run, protyle, completions} = setup();
    const rendered: string[] = [];
    run(protyle, mindmap("first"), [], (html: string) => rendered.push(html));
    await tick();
    protyle.block.rootID = "second";
    run(protyle, mindmap("second"), [], (html: string) => rendered.push(html));
    await tick();
    completions[0]({code: 0, data: {blocks: []}});
    completions[1]({code: -1});
    await tick();
    assert.deepEqual(rendered, [mindmap("second")]);
    assert.equal(run(protyle, mindmap("source"), [], () => assert.fail("retry")), false);
});
