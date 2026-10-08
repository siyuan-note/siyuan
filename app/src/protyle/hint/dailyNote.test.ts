import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {canReferenceDailyNoteNotebook, getLastDailyNoteNotebookId} from "../../util/dailyNote";
import {parseDailyNoteDate} from "../../util/dailyNoteDate";
import {escapeHtml} from "../../util/escape";

const code = transpileModule(readFileSync(join(__dirname, "dailyNote.ts"), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText;

const createContext = () => {
    const calls: {path: string, body: {notebook?: string, date?: string, id?: string}}[] = [];
    let choose: ((notebook: string) => void) | undefined;
    let fail = false;
    const selected: string[] = [];
    const storage: Record<string, string> = {};
    const appWindow = {siyuan: {
        config: {readonly: false, appearance: {lang: "en"}}, storage,
        notebooks: [{id: "daily", name: "Daily <notes>", closed: false},
            {id: "normal", name: "Notes", closed: false}, {id: "encrypted", name: "Secret", closed: false}],
        languages: {dailyNote: "Daily Note", plsChoose: "Choose a notebook", dailyNoteDateInvalid: "Enter a complete date"},
    }};
    const mocks: Record<string, unknown> = {
        "../../constants": {Constants: {LOCAL_DAILYNOTEID: "last", SIYUAN_APPID: "app"}},
        "../../util/dailyNote": {canReferenceDailyNoteNotebook, getLastDailyNoteNotebookId},
        "../../util/dailyNoteDate": {parseDailyNoteDate},
        "../../util/escape": {escapeHtml},
        "../../util/pathName": {isEncryptedBox: (id: string) => id === "encrypted"},
        "../../util/mount": {selectDailyNoteNotebook: (notebooks: {id: string}[], callback: (id: string) => void) => {
            selected.push(...notebooks.map(item => item.id));
            choose = callback;
        }},
        "../../util/fetch": {fetchPost: (path: string, body: {notebook?: string, date?: string, id?: string},
                                       callback: (response: unknown) => void) => {
            calls.push({path, body});
            callback(fail ? {code: -1} : path.endsWith("getDocInfo") ?
                {code: 0, data: {name: "Renamed daily note", ial: {title: "Date"}}} : {code: 0, data: {id: "existing"}});
        }},
    };
    const exported = {};
    runInNewContext(code, {exports: exported, window: appWindow, require: (path: string) => mocks[path]});
    const functions = exported as {
        getDailyNoteHint: (key: string, protyle: unknown) => {value: string, html: string} | undefined,
        createDailyNoteReference: (protyle: unknown, date: string, notebook: string, callback: (id: string, title: string) => void) => void,
    };
    return {functions, calls, storage, selected, appWindow, choose: (id: string) => choose?.(id), setFail: () => { fail = true; }};
};

const protyle = {notebookId: "normal", hint: {splitChar: "[["}};

test("daily note candidates show dates and notebook names without creating documents", () => {
    const context = createContext();
    context.storage.last = "daily";
    const hint = context.functions.getDailyNoteHint("2026-09-25", protyle);
    assert.equal(hint?.value, "daily-note:2026-09-25:daily");
    assert.ok(hint?.html.includes("Daily &lt;notes>"));
    assert.equal(context.calls.length, 0);
    assert.equal(context.functions.getDailyNoteHint("project today", protyle), undefined);
    assert.equal(context.functions.getDailyNoteHint("03/04", protyle)?.value, "");
    assert.equal(context.functions.getDailyNoteHint("today", {...protyle, hint: {splitChar: "(("}}), undefined);
    context.appWindow.siyuan.config.readonly = true;
    assert.equal(context.functions.getDailyNoteHint("today", protyle), undefined);
});

test("selecting a date reuses its previewed notebook and inserts the real document title", () => {
    const context = createContext();
    context.storage.last = "normal";
    let inserted = "";
    context.functions.createDailyNoteReference(protyle, "2026-09-25", "daily", (id, title) => { inserted = `${id}:${title}`; });
    assert.equal(context.calls[0].body.notebook, "daily");
    assert.equal(context.calls[0].body.date, "2026-09-25");
    assert.equal(inserted, "existing:Renamed daily note");
    context.setFail();
    context.functions.createDailyNoteReference(protyle, "2026-09-25", "daily", () => assert.fail("failed creation inserted a reference"));
});

test("an unselected notebook requires choosing and preserves encrypted boundaries", () => {
    const context = createContext();
    context.functions.createDailyNoteReference(protyle, "2026-09-25", "", () => {});
    assert.equal(context.calls.length, 0);
    assert.deepEqual(context.selected, ["daily", "normal"]);
    context.choose("encrypted");
    assert.equal(context.calls.length, 0);
    context.choose("daily");
    assert.equal(context.calls[0].body.notebook, "daily");
    const encrypted = createContext();
    encrypted.storage.last = "normal";
    const source = {...protyle, notebookId: "encrypted"};
    assert.ok(encrypted.functions.getDailyNoteHint("today", source)?.value.endsWith(":"));
    encrypted.functions.createDailyNoteReference(source, "2026-09-25", "normal", () => {});
    assert.deepEqual(encrypted.selected, ["encrypted"]);
});
