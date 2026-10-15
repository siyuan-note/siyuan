import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {canReferenceDailyNoteNotebook, getLastDailyNoteNotebookId} from "../../util/dailyNote";
import {parseDailyNoteDate} from "../../util/dailyNoteDate";
import {escapeAttr, escapeHtml} from "../../util/escape";

const code = transpileModule(readFileSync(join(__dirname, "dailyNote.ts"), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText;

const createContext = () => {
    const calls: {path: string, body: {notebook?: string, date?: string, id?: string}}[] = [];
    let choose: ((notebook: string) => void) | undefined;
    let fail = false;
    let existed = true;
    const selected: string[] = [];
    const storage: Record<string, string> = {};
    const appWindow = {siyuan: {
        config: {readonly: false, appearance: {lang: "en"}}, storage,
        notebooks: [{id: "daily", name: "Daily <notes>", closed: false},
            {id: "normal", name: "Notes", closed: false}, {id: "encrypted", name: "Secret", closed: false}],
        languages: {dailyNote: "Daily Note", fileTree11: "New daily note", plsChoose: "Choose a notebook"},
    }};
    const mocks: Record<string, unknown> = {
        "../../constants": {Constants: {LOCAL_DAILYNOTEID: "last", SIYUAN_APPID: "app"}},
        "../../util/dailyNote": {canReferenceDailyNoteNotebook, getLastDailyNoteNotebookId},
        "../../util/dailyNoteDate": {parseDailyNoteDate},
        "../../util/escape": {escapeAttr, escapeHtml},
        "../util/compatibility": {setStorageVal() {}},
        "../../util/pathName": {isEncryptedBox: (id: string) => id === "encrypted"},
        "../../util/mount": {selectDailyNoteNotebook: (notebooks: {id: string}[], callback: (id: string) => void) => {
            selected.push(...notebooks.map(item => item.id));
            choose = callback;
        }},
        "../../util/fetch": {fetchSyncPost: async (path: string, body: {notebook?: string, date?: string}) => {
            calls.push({path, body});
            return fail ? {code: -1} : {code: 0, data: {id: existed ? "existing" : "", existed,
                title: existed ? "Renamed <note>" : "Sep 25, 2026", hPath: existed ? "/Moved/Renamed <note>" : "/Daily/Sep 25, 2026"}};
        }, fetchPost: (path: string, body: {notebook?: string, date?: string, id?: string},
                                       callback: (response: unknown) => void) => {
            calls.push({path, body});
            callback(fail ? {code: -1} : path.endsWith("getDocInfo") ?
                {code: 0, data: {name: "Renamed daily note", ial: {title: "Date"}}} : {code: 0, data: {id: "existing"}});
        }},
    };
    const exported = {};
    runInNewContext(code, {exports: exported, window: appWindow, require: (path: string) => mocks[path]});
    const functions = exported as {
        getDailyNoteHints: (key: string, protyle: unknown) => Promise<{value: string, html: string}[]>,
        createDailyNoteReference: (protyle: unknown, date: string, notebook: string, callback: (id: string, title: string) => void) => void,
    };
    return {functions, calls, storage, selected, appWindow, choose: (id: string) => choose?.(id),
        setFail: () => { fail = true; }, setMissing: () => { existed = false; }};
};

const protyle = {notebookId: "normal", hint: {splitChar: "[["}};

test("daily note candidates show authenticated names and full paths without creating documents", async () => {
    const context = createContext();
    context.storage.last = "daily";
    const [hint] = await context.functions.getDailyNoteHints("2026-09-25", protyle);
    assert.equal(hint?.value, "daily-note:2026-09-25:daily");
    assert.ok(hint?.html.includes("Daily &lt;notes>/Moved/Renamed &lt;note>"));
    assert.ok(hint?.html.includes("popover__block\" data-id=\"existing\""));
    assert.ok(hint?.html.includes("<mark>Renamed &lt;note></mark>"));
    assert.equal(context.calls[0].path, "/api/filetree/getDailyNoteInfo");
    assert.equal(context.calls.length, 1);
    assert.equal((await context.functions.getDailyNoteHints("project today", protyle)).length, 0);
    assert.equal((await context.functions.getDailyNoteHints("03/04", protyle)).length, 0);
    assert.equal((await context.functions.getDailyNoteHints("10/", protyle)).length, 0);
    assert.equal((await context.functions.getDailyNoteHints("today", {...protyle, hint: {splitChar: "(("}})).length, 0);
    context.appWindow.siyuan.config.readonly = true;
    assert.equal((await context.functions.getDailyNoteHints("today", protyle)).length, 0);
});

test("missing daily notes display resolved creation titles and calendar-plus icons", async () => {
    const context = createContext();
    context.storage.last = "daily";
    context.setMissing();
    const [hint] = await context.functions.getDailyNoteHints("2026-09-25", protyle);
    assert.ok(hint.html.includes("#iconCalendarPlus"));
    assert.ok(hint.html.includes("New daily note <mark>Sep 25, 2026</mark>"));
    assert.ok(hint.html.includes("Daily &lt;notes>/Daily/Sep 25, 2026"));
    assert.ok(!hint.html.includes("popover__block"));
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

test("an unselected notebook offers actual paths and preserves encrypted boundaries", async () => {
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
    const hints = await encrypted.functions.getDailyNoteHints("today", source);
    assert.equal(hints.length, 1);
    assert.ok(hints[0].value.endsWith(":encrypted"));
    encrypted.functions.createDailyNoteReference(source, "2026-09-25", "normal", () => {});
    assert.deepEqual(encrypted.selected, ["encrypted"]);
    const undecided = createContext();
    const candidates = await undecided.functions.getDailyNoteHints("2026-09-25", protyle);
    assert.equal(candidates.length, 2);
    assert.ok(undecided.calls.every(call => call.path.endsWith("getDailyNoteInfo")));
});
