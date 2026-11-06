import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = createSourceFile("util.ts", readFileSync("src/layout/util.ts", "utf8"), ScriptTarget.Latest);
const selected = new Set(["exportLayout", "JSONToLayout"]);
const code = transpileModule(source.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(declaration => selected.has(declaration.name.getText(source))))
    .map(statement => statement.getText(source)).join("\n"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const fixture = (options: {detached?: boolean; readonly?: boolean; fail?: boolean; storageFail?: boolean} = {}) => {
    const events: string[] = [];
    const saved: any[] = [];
    const snapshots: any[] = [];
    const local: any[] = [];
    const defaults = {layout: {id: "other window"}};
    const window = {siyuan: {config: {readonly: options.readonly, uiLayout: defaults},
        layout: {layout: {}, bottomDock: {}, leftDock: {}, rightDock: {}}}, dispatchEvent: () => {}};
    const api = {} as Pick<typeof import("./util"), "exportLayout" | "JSONToLayout">;
    const stop = new Error("layout consumed");
    runInNewContext(code, {
        exports: api, window, Event: class {}, console,
        document: {querySelector: () => ({getAttribute: () => "#iconDock", setAttribute: () => {}})},
        getDockBarToggleTip: () => "Dock",
        syncMarkdownKeymap: () => {},
        getSettingsWindowHost: (): undefined => undefined, getAllEditor: () => [{protyle: {}}],
        saveScroll: async () => { events.push("shared scroll"); },
        withFetchTimeout: (callback: () => Promise<void>) => callback(),
        layoutSavingSuspended: false, isWindow: () => options.detached,
        sessionStorage: {setItem: (_key: string, value: string) => local.push(JSON.parse(value))},
        layoutToJSON: (_value: unknown, target: any, _break: unknown, scroll = false) => {
            target.id = "own window";
            target.children = [{scrollAttr: {scrollTop: 9}}];
            if (scroll) target.scrollAttr = {scrollTop: 42};
        },
        dockToJSON: () => ({data: [] as unknown[]}),
        removeLayoutScroll: (value: any) => {
            const visit = (node: any) => {
                if (!node || typeof node !== "object") return;
                delete node.scrollAttr;
                Object.values(node).forEach(visit);
            };
            visit(value);
        },
        saveUILayout: async (value: any, _errorExit: boolean, callback: (response: {code: number}) => void) => {
            saved.push(value); events.push("shared layout"); callback({code: options.fail ? -1 : 0});
        },
        saveReloadSnapshot: (value: unknown) => {
            if (options.storageFail) return false;
            snapshots.push(value); events.push("snapshot"); return true;
        },
        consumeReloadSnapshot: () => snapshots.shift(),
        JSONToCenter: (_app: unknown, value: any) => { events.push(value.id); },
        JSONToDock: () => { throw stop; },
    });
    return {api, events, saved, snapshots, local, window, stop};
};

test("reload exports shared layout without scroll and consumes local scroll at the actual restore point", async () => {
    const f = fixture();
    await f.api.exportLayout({reload: true, errorExit: false, cb: () => f.events.push("reload")});
    assert.deepEqual(f.events, ["shared layout", "snapshot", "reload"]);
    assert.equal(f.saved[0].layout.children[0].scrollAttr, undefined);
    assert.equal(f.snapshots[0].layout.scrollAttr.scrollTop, 42);
    // 模拟启动期间重新获取配置，恢复点仍选择当前实例的快照。
    f.window.siyuan.config.uiLayout = {layout: {id: "new shared default"}};
    assert.throws(() => f.api.JSONToLayout({} as any, false), error => error === f.stop);
    assert.equal(f.events.at(-1), "own window");
    assert.equal(f.snapshots.length, 0);
});

test("resetScroll strips active and inactive scroll from both persisted layouts", async () => {
    const f = fixture();
    await f.api.exportLayout({reload: true, resetScroll: true, errorExit: false, cb: () => {}});
    assert.equal(JSON.stringify(f.saved).includes("scrollAttr"), false);
    assert.equal(JSON.stringify(f.snapshots).includes("scrollAttr"), false);
});

test("failed or readonly exports do not leave a reload snapshot", async () => {
    for (const options of [{fail: true}, {readonly: true}]) {
        const f = fixture(options);
        await f.api.exportLayout({reload: true, errorExit: false, cb: () => {}});
        assert.equal(f.snapshots.length, 0);
    }
});

test("session storage failure falls back to waiting for shared reading position saves", async () => {
    const f = fixture({storageFail: true});
    await f.api.exportLayout({reload: true, errorExit: false, cb: () => f.events.push("reload")});
    assert.deepEqual(f.events, ["shared layout", "shared scroll", "reload"]);
    assert.equal(f.snapshots.length, 0);
});

test("detached windows retain their existing storage while exit saves keep normal shared scroll", async () => {
    const detached = fixture({detached: true});
    await detached.api.exportLayout({reload: true, errorExit: false, cb: () => {}});
    assert.equal(detached.local.length, 1);
    assert.equal(detached.saved.length, 0);
    assert.equal(detached.snapshots.length, 0);
    const exit = fixture();
    await exit.api.exportLayout({errorExit: true, cb: () => {}});
    assert.deepEqual(exit.events, ["shared scroll", "shared layout"]);
    assert.equal(exit.snapshots.length, 0);
});

test("ordinary main-window serialization does not leak a restored inactive tab's scroll into shared layouts", () => {
    const serializer = source.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration => declaration.name.getText(source) === "layoutToJSON"))
        .map(statement => statement.getText(source)).join("\n");
    const compiled = transpileModule(serializer, {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    for (const detached of [false, true]) {
        const api = {} as Pick<typeof import("./util"), "layoutToJSON">;
        class Tab {
            headElement = {classList: {contains: () => false}, getAttribute: (name: string) => name === "data-initdata" ?
                JSON.stringify({instance: "Editor", rootId: "doc", scrollAttr: {scrollTop: 99}}) : null};
        }
        class Other {}
        runInNewContext(compiled, {
            exports: api, Tab, Layout: Other, Wnd: Other, Files: Other, Backlink: Other, Bookmark: Other,
            Graph: Other, Outline: Other, Tag: Other, isWindow: () => detached,
            removeLayoutScroll: (value: any) => { delete value.scrollAttr; },
        });
        for (const includeScroll of [false, true]) {
            const json: any = {};
            api.layoutToJSON(new Tab() as any, json, undefined, includeScroll);
            assert.equal(json.children.scrollAttr?.scrollTop, detached || includeScroll ? 99 : undefined);
        }
    }
});
