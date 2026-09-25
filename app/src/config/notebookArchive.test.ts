import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/config/notebookArchive.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

class Control {
    checked = false;
    disabled = false;
    value = "20260925120001-archive";
    listeners = new Map<string, () => Promise<void> | void>();
    classList = {remove: () => {}};
    addEventListener(event: string, handler: () => Promise<void> | void) {
        this.listeners.set(event, handler);
    }
    async dispatch(event: string) {
        await this.listeners.get(event)?.();
    }
}

test("archive removal requires a saved copy and explicit confirmation after download", async () => {
    const boxes = [new Control()];
    const controls = new Map<string, Control>();
    for (const name of ["export", "commit", "saved", "cancel"]) {
        controls.set(`[data-type="${name}"]`, new Control());
    }
    const saved = new Control();
    controls.set('[data-type="saved"] input', saved);
    let destroyed = 0;
    const requests: Array<{url: string, data: {id?: string, saved?: boolean}}> = [];
    let saveStatus = "canceled";
    const exports = {} as {openNotebookArchiveDialog: (refresh: () => void) => Promise<void>};
    const dependencies = {
        Dialog: class {
            element = {
                isConnected: true,
                querySelector: (selector: string) => controls.get(selector),
                querySelectorAll: () => boxes,
            };
            destroy() {
                this.element.isConnected = false;
                destroyed++;
            }
        },
        fetchSyncPost: async (url: string, data: {id?: string, saved?: boolean}) => {
            requests.push({url, data});
            if (url.endsWith("getNotebookArchiveCandidates")) {
                return {code: 0, data: {notebooks: [{id: boxes[0].value, current: true}]}};
            }
            if (url.endsWith("prepareNotebookArchive")) {
                return {code: 0, data: {id: "archive-id", file: "/export/archive.zip"}};
            }
            return {code: 0};
        },
        saveExportFile: async () => ({status: saveStatus}),
        escapeHtml: (value: string) => value,
        isMobile: () => true,
        showMessage: () => {},
    };
    runInNewContext(compiled, {exports, require: () => dependencies, window: {siyuan: {languages: {}}}});
    let refreshed = 0;
    await exports.openNotebookArchiveDialog(() => refreshed++);
    boxes[0].checked = true;
    await boxes[0].dispatch("change");
    await controls.get('[data-type="export"]').dispatch("click");
    assert.equal(controls.get('[data-type="commit"]').disabled, true);
    assert.equal(requests.filter((r) => r.url.endsWith("commitNotebookArchive")).length, 0);
    saveStatus = "success";
    await controls.get('[data-type="export"]').dispatch("click");
    await controls.get('[data-type="commit"]').dispatch("click");
    assert.equal(requests.filter((r) => r.url.endsWith("commitNotebookArchive")).length, 0);
    saved.checked = true;
    await saved.dispatch("change");
    await controls.get('[data-type="commit"]').dispatch("click");
    const commits = requests.filter((r) => r.url.endsWith("commitNotebookArchive"));
    assert.equal(commits.length, 1);
    assert.equal(commits[0].data.id, "archive-id");
    assert.equal(commits[0].data.saved, true);
    assert.equal(refreshed, 1);
    assert.equal(destroyed, 1);
    assert.equal(requests.filter((r) => r.url.endsWith("prepareNotebookArchive")).length, 1);
});
