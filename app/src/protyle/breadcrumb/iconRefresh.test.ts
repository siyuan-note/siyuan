import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const fixture = () => {
    const box = {id: "box", icon: "old"};
    const window = {siyuan: {notebooks: [box], config: {editor: {globalBreadcrumb: true}}}};
    let available = true;
    const renders: string[] = [];
    const protyle: any = {notebookId: "box", block: {rootID: "current"}, breadcrumb: {
        element: {querySelectorAll: () => [{getAttribute: () => "old-path"}]},
        render: (_protyle: unknown, force: boolean) => {assert.equal(force, true); renders.push(box.icon);},
    }};
    const editors = [{protyle}, {protyle: {notebookId: "other", breadcrumb: {render: () => assert.fail("wrong notebook")}}}];
    const exports: any = {};
    const source = transpileModule(readFileSync("src/protyle/breadcrumb/iconRefresh.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    runInNewContext(source, {exports, window, require: () => ({
        getAllEditor: () => editors,
        isBreadcrumbNotebookAvailable: () => available,
    })});
    return {exports, protyle, box, window, renders, editors, lock: () => available = false};
};

test("icon edits, removal and undo refresh once even for ancestors absent from the old DOM", () => {
    for (const [oldIcon, newIcon] of [["old", "new"], ["old", ""], ["", "old"]]) {
        const f = fixture();
        const operation = {action: "updateAttrs", id: "new-ancestor", data: {old: {icon: oldIcon}, new: {icon: newIcon}}};
        f.exports.refreshBreadcrumbForIconChanges(f.protyle, [operation, operation]);
        assert.equal(f.renders.length, 1);
    }
});

test("setAttrs icon changes refresh while unrelated and unchanged attributes do not", () => {
    const f = fixture();
    f.exports.refreshBreadcrumbForIconChanges(f.protyle, [
        {action: "updateAttrs", data: {old: {icon: "same"}, new: {icon: "same"}}},
        {action: "setAttrs", data: JSON.stringify({title: "new"})}, {action: "insert"},
    ]);
    assert.equal(f.renders.length, 0);
    f.exports.refreshBreadcrumbForIconChanges(f.protyle, [{action: "setAttrs", id: "ancestor", data: JSON.stringify({icon: ""})}]);
    assert.equal(f.renders.length, 1);
});

test("disabled, locked and missing breadcrumb editors do not refresh", () => {
    for (const mode of ["disabled", "locked", "missing"]) {
        const f = fixture();
        if (mode === "disabled") f.window.siyuan.config.editor.globalBreadcrumb = false;
        if (mode === "locked") f.lock();
        if (mode === "missing") delete f.protyle.breadcrumb;
        f.exports.refreshBreadcrumbForIconChanges(f.protyle, [{action: "setAttrs", data: '{"icon":"new"}'}]);
        assert.equal(f.renders.length, 0);
    }
});

test("notebook events update cache before rendering and ignore duplicate or unknown events", () => {
    const f = fixture();
    f.exports.updateNotebookBreadcrumbIcon("box", "new");
    assert.deepEqual(f.renders, ["new"]);
    f.exports.updateNotebookBreadcrumbIcon("box", "new");
    f.exports.updateNotebookBreadcrumbIcon("unknown", "new");
    assert.deepEqual(f.renders, ["new"]);
    f.exports.updateNotebookBreadcrumbIcon("box", "");
    assert.deepEqual(f.renders, ["new", ""]);
});

test("notebook events tolerate metadata that has not loaded during window startup", () => {
    const f = fixture();
    delete f.window.siyuan.notebooks;
    f.exports.updateNotebookBreadcrumbIcon("box", "new");
    assert.deepEqual(f.renders, []);
});

test("disabled or locked notebook events retain metadata without rendering", () => {
    for (const mode of ["disabled", "locked"]) {
        const f = fixture();
        if (mode === "disabled") f.window.siyuan.config.editor.globalBreadcrumb = false;
        else f.lock();
        f.exports.updateNotebookBreadcrumbIcon("box", "new");
        assert.equal(f.box.icon, "new");
        assert.equal(f.renders.length, 0);
    }
});

test("main websocket events retain icons while a detached window has no editors", () => {
    const f = fixture();
    f.editors.length = 0;
    const messages: any = {};
    const source = transpileModule(readFileSync("src/util/processMessage.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    runInNewContext(source, {exports: messages, require: (name: string) =>
        name === "../protyle/breadcrumb/iconRefresh" ? f.exports : {}});
    const event = {cmd: "notebookIconChanged", code: 0, data: {boxID: "box", icon: "new"}};
    assert.equal(messages.processMessage(event), event);
    assert.equal(f.box.icon, "new");
    assert.deepEqual(f.renders, []);
    f.editors.push({protyle: f.protyle});
    f.protyle.breadcrumb.render(f.protyle, true);
    assert.deepEqual(f.renders, ["new"]);
});

test("icon updates are wired through shared transactions, emoji updates and notebook websocket handlers", () => {
    assert.match(readFileSync("src/protyle/wysiwyg/transaction.ts", "utf8"), /refreshBreadcrumbForIconChanges\(protyle,/);
    for (const file of ["src/emoji/index.ts", "src/layout/dock/Files.ts", "src/mobile/dock/MobileFiles.ts", "src/protyle/index.ts"]) {
        assert.match(readFileSync(file, "utf8"), /updateNotebookBreadcrumbIcon\(/, file);
    }
});
