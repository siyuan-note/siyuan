import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (file: string) => transpileModule(readFileSync(resolve(__dirname, file), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = () => {
    const runtime = {siyuan: {languages: {fileNameRule: "Invalid filename", _kernel: {106: "Title too long"}}}};
    const timers = new Map<number, () => void>();
    const requests: Array<{url: string, data: any}> = [];
    let timerID = 0;
    const window = {...runtime, setTimeout: (callback: () => void) => {
        timers.set(++timerID, callback);
        return timerID;
    }};
    const constants = {SIZE_TITLE: 512};
    const rename = {};
    runInNewContext(compile("../../editor/rename.ts"), {
        exports: rename,
        window,
        require: (name: string) => name === "../constants" ? {Constants: constants} :
            {showMessage: () => {}, showTooltip: () => {}},
    });
    const moduleExports: {Title?: {prototype: any}} = {};
    runInNewContext(compile("Title.ts"), {
        exports: moduleExports,
        window,
        clearTimeout: (id: number) => timers.delete(id),
        require: (name: string) => {
            if (name === "../../editor/rename") return rename;
            if (name === "../../constants") return {Constants: constants};
            if (name === "../util/selectionOffsets") return {getSelectionOffset: () => ({start: 1026, end: 1026})};
            if (name === "../util/selection") return {focusByOffset: () => {}};
            if (name === "../../dialog/tooltip") return {hideTooltip: () => {}};
            if (name === "../../util/fetch") return {fetchPost: (url: string, data: any) => requests.push({url, data})};
            return {};
        },
    });
    const title = Object.create(moduleExports.Title.prototype);
    title.editElement = {textContent: ""};
    title.setTitle = (value: string) => { title.editElement.textContent = value; };
    title.protyle = {notebookId: "notebook", path: "/document.sy"};
    return {title, timers, requests};
};

test("truncated structured titles replace the pending save and flush the displayed text", () => {
    const {title, timers, requests} = setup();
    for (const [input, expected] of [
        ["a".repeat(513), "a".repeat(512)],
        ["😀".repeat(513), "😀".repeat(512)],
        ["A" + "😀".repeat(512), "A" + "😀".repeat(511)],
        ["文".repeat(513), "文".repeat(512)],
    ]) {
        title.editElement.textContent = "Previous valid title";
        title.rename(title.protyle);
        title.editElement.textContent = input;
        title.rename(title.protyle);
        assert.equal(title.editElement.textContent, expected);
        assert.equal(timers.size, 1);
        title.flushPendingInput();
        assert.equal(timers.size, 0);
        assert.equal(requests.at(-1)?.url, "/api/filetree/renameDoc");
        assert.equal(requests.at(-1)?.data.title, expected);
        assert.equal(requests.at(-1)?.data.notebook, "notebook");
        assert.equal(requests.at(-1)?.data.path, "/document.sy");
    }
    assert.equal(requests.length, 4);
});

test("truncated structured titles also save through the debounce callback", () => {
    const {title, timers, requests} = setup();
    title.editElement.textContent = "x".repeat(513);
    title.rename(title.protyle);
    assert.equal(timers.size, 1);
    timers.values().next().value!();
    title.flushPendingInput();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].data.title, "x".repeat(512));
});

test("invalid structured titles cancel saving when truncation cannot make them valid", () => {
    const {title, timers, requests} = setup();
    for (const input of ["Title\nwith/slash", "Title\n" + "a".repeat(513)]) {
        title.editElement.textContent = "Previous valid title";
        title.rename(title.protyle);
        title.editElement.textContent = input;
        assert.equal(title.rename(title.protyle), false);
        title.flushPendingInput();
        assert.equal(timers.size, 0);
        assert.equal(requests.length, 0);
    }
});
