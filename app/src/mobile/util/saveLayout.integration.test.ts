import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isCallExpression, isVariableDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const {parse} = require("ifdef-loader/preprocessor");
const readSource = (file: string, mobile = true) => createSourceFile(file,
    parse(readFileSync(join(__dirname, "../../", file), "utf8"), {MOBILE: mobile, BROWSER: true}, false, true),
    ScriptTarget.ES2021, true);
const loadFunction = (file: string, name: string, dependencies: Record<string, unknown>, mobile = true) => {
    const source = readSource(file, mobile);
    const declaration = source.statements.filter(isVariableStatement).flatMap(item => Array.from(item.declarationList.declarations))
        .find(item => item.name.getText(source) === name);
    assert.ok(declaration, name);
    const code = transpileModule(`const target = ${declaration.initializer.getText(source)};`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    return runInNewContext(code + "\ntarget;", dependencies);
};
const deferred = () => {
    let resolve: (value: boolean) => void;
    const promise = new Promise<boolean>(done => { resolve = done; });
    return {promise, resolve};
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("mobile plugin saveLayout completes the callback only after a successful save", async () => {
    for (const succeeds of [true, false]) {
        const pending = deferred();
        let called = 0;
        let errors = 0;
        const save = loadFunction("plugin/API.ts", "saveLayout", {
            saveMobileLayout: () => pending.promise,
            window: {siyuan: {languages: {mobileLayoutSaveError: "Save failed"}}},
            showMessage: () => { errors++; },
        });
        save(() => { called++; });
        assert.equal(called, 0);
        pending.resolve(succeeds);
        await flush();
        assert.equal(called, succeeds ? 1 : 0);
        assert.equal(errors, succeeds ? 0 : 1);
    }
});

test("desktop plugin saveLayout retains exportLayout", () => {
    const calls: any[] = [];
    const callback = () => {};
    const save = loadFunction("plugin/API.ts", "saveLayout", {exportLayout: (options: unknown) => calls.push(options)}, false);
    save(callback);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cb, callback);
    assert.equal(calls[0].errorExit, false);
});

test("mobile normal exit waits for save and remains open on failure", async () => {
    for (const ownsKernel of [true, false]) {
        for (const succeeds of [true, false]) {
            const pending = deferred();
            const events: string[] = [];
            const exit = loadFunction("dialog/processSystem.ts", "exitSiYuan", {
                getSettingsWindowHost: (): undefined => undefined,
                hideAllElements: () => {},
                saveMobileLayout: () => pending.promise,
                getHostCapabilities: () => ({ownsKernel}),
                forceQuit: () => events.push("quit"),
                fetchPost: (url: string) => events.push(url),
                showMessage: () => events.push("error"),
                window: {siyuan: {languages: {mobileLayoutSaveError: "Save failed"}}},
            });
            const exiting = exit();
            assert.deepEqual(events, []);
            pending.resolve(succeeds);
            await exiting;
            assert.deepEqual(events, succeeds ? [ownsKernel ? "/api/system/exit" : "quit"] : ["error"]);
        }
    }
});

test("mobile lock screen logs out after save completion even when saving fails", async () => {
    for (const succeeds of [true, false]) {
        const pending = deferred();
        const events: string[] = [];
        const lock = loadFunction("dialog/processSystem.ts", "lockScreen", {
            window: {siyuan: {config: {readonly: false}}},
            emitToPlugins: () => events.push("lock"),
            saveMobileLayout: () => pending.promise,
            fetchPost: (url: string) => events.push(url),
        });
        const locking = lock();
        assert.deepEqual(events, ["lock"]);
        pending.resolve(succeeds);
        await locking;
        assert.deepEqual(events, ["lock", "/api/system/logoutAuth"]);
    }
});

test("hidden, pagehide and beforeunload use the unified mobile save entry", () => {
    const source = readSource("mobile/index.ts");
    const registrations: string[] = [];
    const findListeners = (node: import("typescript").Node) => {
        if (isCallExpression(node) && ["window.addEventListener", "document.addEventListener"].includes(node.expression.getText(source)) &&
            ["\"beforeunload\"", "\"pagehide\"", "\"visibilitychange\""].includes(node.arguments[0]?.getText(source))) {
            registrations.push(node.getText(source));
        }
        forEachChild(node, findListeners);
    };
    findListeners(source);
    assert.equal(registrations.length, 3);
    const handlers = new Map<string, () => void>();
    let saves = 0;
    const document = {visibilityState: "visible", addEventListener: (name: string, handler: () => void) => handlers.set(name, handler)};
    runInNewContext(transpileModule(registrations.join(";\n"), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText, {
        window: {addEventListener: document.addEventListener}, document,
        saveMobileLayout: () => { saves++; return Promise.resolve(true); },
    });
    handlers.get("visibilitychange")();
    assert.equal(saves, 0);
    document.visibilityState = "hidden";
    handlers.get("visibilitychange")();
    handlers.get("pagehide")();
    handlers.get("beforeunload")();
    assert.equal(saves, 3);
});

test("mobile loader distinguishes early failures from a partially changed editor", () => {
    const source = readSource("mobile/editor.ts");
    let failSource: string;
    const visit = (node: import("typescript").Node) => {
        if (isVariableDeclaration(node) && node.name.getText(source) === "fail") {
            failSource = node.initializer.getText(source);
        }
        forEachChild(node, visit);
    };
    visit(source);
    assert.ok(failSource);
    for (const titleHidden of [false, true]) {
        const failures: unknown[][] = [];
        let shown = 0;
        runInNewContext(transpileModule(`let completed = false; const fail = ${failSource}; fail(true); fail();`, {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText, {
            titleHidden,
            isValid: () => true,
            window: {siyuan: {mobile: {editor: {protyle: {wysiwyg: {element: {childElementCount: 1}}}}}}},
            setEditor: () => { shown++; },
            onFailure: (...args: unknown[]) => failures.push(args),
        });
        assert.deepEqual(failures, [[true, !titleHidden]]);
        assert.equal(shown, titleHidden ? 1 : 0);
    }
});
