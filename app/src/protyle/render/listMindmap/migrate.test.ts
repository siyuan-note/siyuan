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
        CUSTOM_SY_READONLY: "custom-sy-readonly", CB_GET_HISTORY: "history", CB_GET_BACKLINK: "backlink",
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

test("closing the editor cancels rendering while a migration request is pending", async () => {
    const {run, cancel, protyle, completions} = setup();
    run(protyle, "source", [], () => assert.fail("closed editor rendered"));
    await tick();
    cancel(protyle);
    completions[0]({code: 0, data: {blocks: []}});
    await tick();
});

test("opening a document migrates once and resumes only the newest pending render", async () => {
    const {run, protyle, calls, completions} = setup();
    const rendered: string[] = [];
    assert.equal(run(protyle, "old render", [], (html: string) => rendered.push(html)), true);
    assert.equal(run(protyle, "latest render", [], (html: string) => rendered.push(html)), true);
    await tick();
    assert.equal(calls.length, 1);
    completions[0]({code: 0, data: {blocks: []}});
    await tick();
    assert.deepEqual(rendered, ["latest render"]);
    assert.equal(run(protyle, "undo", [], () => assert.fail("undo retriggered migration")), false);
    assert.equal(calls.length, 1);
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
    run(protyle, "first", [], (html: string) => rendered.push(html));
    await tick();
    protyle.block.rootID = "second";
    run(protyle, "second", [], (html: string) => rendered.push(html));
    await tick();
    completions[0]({code: 0, data: {blocks: []}});
    completions[1]({code: -1});
    await tick();
    assert.deepEqual(rendered, ["second"]);
    assert.equal(run(protyle, "source", [], () => assert.fail("retry")), false);
});
