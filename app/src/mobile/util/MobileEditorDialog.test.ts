import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync(join(__dirname, "MobileEditorDialog.ts"), "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
}).outputText;

const deferred = () => {
    let resolve: () => void;
    let reject: (error: Error) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    return {promise, resolve, reject};
};

const setup = () => {
    const messages: string[] = [];
    const errors: unknown[] = [];
    class Dialog {
        destroyed = 0;
        destroy() { this.destroyed++; }
    }
    const api = {} as typeof import("./MobileEditorDialog");
    const modules: Record<string, unknown> = {
        "../../dialog": {Dialog},
        "../../dialog/message": {showMessage: (message: string) => messages.push(message)},
        "../../util/escape": {escapeHtml: (value: string) => value.replace(/</g, "&lt;").replace(/>/g, "&gt;")},
    };
    runInNewContext(compiled, {exports: api, require: (name: string) => {
        assert.ok(modules[name], `Unexpected module: ${name}`);
        return modules[name];
    }, console: {error: (error: unknown) => errors.push(error)}});
    const dialog = () => new (api.getMobileEditorDialog())({content: "editor"}) as
        import("./MobileEditorDialog").MobileEditorDialog & {destroyed: number};
    return {...api, dialog, messages, errors};
};

test("editor sheet imports wait for the dialog base class to finish initializing", () => {
    const api = {} as typeof import("./MobileEditorDialog");
    const dialogModule: {Dialog?: unknown} = {};
    let dialogReads = 0;
    runInNewContext(compiled, {exports: api, require: (name: string) => {
        if (name === "../../dialog") {
            dialogReads++;
            return dialogModule;
        }
        return {};
    }});
    assert.equal(dialogReads, 0);
    assert.equal(api.closeMobileEditorSheets(), undefined);
    class Dialog {
        constructor(public options: unknown) {}
    }
    dialogModule.Dialog = Dialog;
    const DialogClass = api.getMobileEditorDialog();
    const options = {content: "editor"};
    const dialog = new DialogClass(options);
    assert.ok(dialog instanceof Dialog);
    assert.equal(dialog.options, options);
    assert.equal(api.getMobileEditorDialog(), DialogClass);
    assert.equal(dialogReads, 1);
});

test("registered editor sheets coalesce concurrent close requests and wait for every save", async () => {
    const fixture = setup();
    assert.equal(fixture.closeMobileEditorSheets(), undefined);
    const first = fixture.dialog();
    const second = fixture.dialog();
    const firstSave = deferred();
    const secondSave = deferred();
    let firstCalls = 0;
    let secondCalls = 0;
    first.beforeClose = () => { firstCalls++; return firstSave.promise; };
    second.beforeClose = () => { secondCalls++; return secondSave.promise; };
    first.register();
    first.register();
    second.register();
    const closing = first.close();
    assert.equal(first.close(), closing);
    let completed = false;
    const all = fixture.closeMobileEditorSheets().then(() => { completed = true; });
    await Promise.resolve();
    assert.equal(firstCalls, 1);
    assert.equal(secondCalls, 1);
    assert.equal(first.destroyed, 0);
    assert.equal(second.destroyed, 0);
    firstSave.resolve();
    await closing;
    assert.equal(first.destroyed, 1);
    assert.equal(second.destroyed, 0);
    assert.equal(completed, false);
    secondSave.resolve();
    await all;
    assert.equal(second.destroyed, 1);
    assert.equal(fixture.closeMobileEditorSheets(), undefined);
});

test("a failed close keeps the sheet registered and can be retried without destroying its content", async () => {
    const fixture = setup();
    const dialog = fixture.dialog();
    const failure = new Error("<save failed>");
    let attempts = 0;
    dialog.beforeClose = async () => {
        if (++attempts === 1) {
            throw failure;
        }
    };
    dialog.register();
    const closing = dialog.close();
    await assert.rejects(closing, failure);
    assert.equal(dialog.destroyed, 0);
    assert.deepEqual(fixture.messages, ["Error: &lt;save failed&gt;"]);
    await fixture.closeMobileEditorSheets();
    assert.equal(attempts, 2);
    assert.equal(dialog.destroyed, 1);
    assert.notEqual(dialog.close(), closing);
    assert.equal(fixture.closeMobileEditorSheets(), undefined);
});

test("ordinary destroy goes through the save guard and reports a rejected save", async () => {
    const fixture = setup();
    const dialog = fixture.dialog();
    const save = deferred();
    dialog.beforeClose = () => save.promise;
    dialog.register();
    dialog.destroy();
    assert.equal(dialog.destroyed, 0);
    const failure = new Error("offline");
    save.reject(failure);
    await assert.rejects(dialog.close(), failure);
    await Promise.resolve();
    assert.equal(dialog.destroyed, 0);
    assert.deepEqual(fixture.errors, [failure]);
});

test("security discard unregisters immediately without starting another save", async () => {
    const fixture = setup();
    const dialog = fixture.dialog();
    let saves = 0;
    dialog.beforeClose = async () => { saves++; };
    dialog.register();
    dialog.discard();
    assert.equal(saves, 0);
    assert.equal(dialog.destroyed, 1);
    assert.equal(fixture.closeMobileEditorSheets(), undefined);
});

test("security discard does not revive a sheet or report a stale save failure", async () => {
    const fixture = setup();
    const dialog = fixture.dialog();
    const save = deferred();
    dialog.beforeClose = () => save.promise;
    dialog.register();
    const closing = dialog.close();
    await Promise.resolve();
    dialog.discard();
    assert.equal(dialog.destroyed, 1);
    assert.equal(fixture.closeMobileEditorSheets(), undefined);
    save.reject(new Error("notebook is locked"));
    await closing;
    assert.deepEqual(fixture.messages, []);
    assert.equal(fixture.closeMobileEditorSheets(), undefined);
});
