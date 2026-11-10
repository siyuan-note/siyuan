import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/layout/reloadSnapshot.ts", "utf8");
const code = transpileModule(source, {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}}).outputText;
const fixture = () => {
    const storage = new Map<string, string>();
    const config = {readonly: false, system: {workspaceDir: "/workspace/a"}};
    const api = {} as typeof import("./reloadSnapshot");
    let broken = false;
    runInNewContext(code, {
        exports: api, window: {siyuan: {config}},
        sessionStorage: {
            getItem: (key: string) => { if (broken) throw Error(); return storage.get(key); },
            setItem: (key: string, value: string) => { if (broken) throw Error(); storage.set(key, value); },
            removeItem: (key: string) => { if (broken) throw Error(); storage.delete(key); },
        },
        require: () => ({isSensitiveLayoutData: (data: any) => data?.notebookId === "encrypted"}),
    });
    return {api, storage, config, breakStorage: () => { broken = true; }};
};
const layout = (id: string) => {
    const dock = (type: string) => ({instance: "Layout", type,
        children: [{instance: "Wnd", children: []}, {instance: "Wnd", children: []}] as any[]});
    const center = dock("center");
    center.children = [{instance: "Wnd", children: [{instance: "Tab", children: {
        instance: "Editor", blockId: id, scrollAttr: {rootId: id, scrollTop: 42},
    }}]}];
    return {layout: {instance: "Layout", children: [
        {instance: "Layout", children: [dock("left"), center, dock("right")]}, dock("bottom")],
    }, left: {data: [] as any[]}, right: {data: [] as any[]}, bottom: {data: [] as any[]}};
};
const tabs = (saved: any) => saved.layout.children[0].children[1].children[0].children;


test("each browser context restores its own snapshot once despite another default layout", () => {
    const a = fixture();
    const b = fixture();
    a.api.saveReloadSnapshot(layout("a"));
    b.api.saveReloadSnapshot(layout("b"));
    assert.equal(tabs(a.api.consumeReloadSnapshot())[0].children.blockId, "a");
    assert.equal(tabs(b.api.consumeReloadSnapshot())[0].children.blockId, "b");
    assert.equal(a.api.consumeReloadSnapshot(), undefined);
    assert.equal(b.api.consumeReloadSnapshot(), undefined);
});

test("snapshots are scoped to workspace and never restored or saved in readonly mode", () => {
    const f = fixture();
    f.api.saveReloadSnapshot(layout("a"));
    f.config.system.workspaceDir = "/workspace/b";
    assert.equal(f.api.consumeReloadSnapshot(), undefined);
    f.api.saveReloadSnapshot(layout("b"));
    f.config.readonly = true;
    assert.equal(f.api.consumeReloadSnapshot(), undefined);
    f.api.saveReloadSnapshot(layout("b"));
    assert.equal(f.storage.size, 0);
});

test("bad JSON, incomplete shapes and unavailable session storage safely fall back", () => {
    const f = fixture();
    for (const raw of ["{", "null", "{}", JSON.stringify({workspace: "/workspace/a", layout: {left: {}}})]) {
        f.storage.set("siyuan-ui-reload-layout", raw);
        assert.equal(f.api.consumeReloadSnapshot(), undefined);
        assert.equal(f.storage.size, 0);
    }
    f.breakStorage();
    assert.doesNotThrow(() => f.api.saveReloadSnapshot(layout("a")));
    assert.equal(f.api.consumeReloadSnapshot(), undefined);
    assert.doesNotThrow(() => f.api.clearReloadSnapshot());
});

test("malformed layout trees and dock sections fall back without reaching destructive layout recovery", () => {
    const f = fixture();
    const invalid: any[] = [{layout: {}, left: {}, right: {}, bottom: {}}];
    for (const data of [{}, [null], [[null]], [[{type: "file"}]]]) {
        const saved = layout("a");
        saved.left.data = data as any;
        invalid.push(saved);
    }
    const missingCenter = layout("a");
    missingCenter.layout.children[0].children.splice(1, 1);
    invalid.push(missingCenter);
    const wrongParent = layout("a");
    wrongParent.layout.children[0].children[1].children = [{instance: "Tab", children: {}}] as any;
    invalid.push(wrongParent);
    for (const instance of ["Layout", "Wnd", "Tab"]) {
        const structuralModel = layout("a");
        tabs(structuralModel)[0].children = {instance, children: []};
        invalid.push(structuralModel);
    }
    const nestedStructuralModel = layout("a");
    tabs(nestedStructuralModel)[0].children = {instance: "Editor", blockId: "a", children: [{instance: "Layout", children: []}]};
    invalid.push(nestedStructuralModel);
    for (const saved of invalid) {
        f.api.saveReloadSnapshot(saved);
        assert.equal(f.api.consumeReloadSnapshot(), undefined);
        assert.equal(f.storage.size, 0);
    }
});

test("valid nested split layouts and empty windows remain restorable", () => {
    const f = fixture();
    const saved = layout("a");
    const center = saved.layout.children[0].children[1];
    center.children = [{instance: "Layout", type: "normal", children: center.children},
        {instance: "Wnd", children: []}];
    f.api.saveReloadSnapshot(saved);
    assert.ok(f.api.consumeReloadSnapshot());
    for (const children of [{}, []]) {
        const emptyTab = layout("empty");
        tabs(emptyTab)[0].children = children;
        f.api.saveReloadSnapshot(emptyTab);
        assert.ok(f.api.consumeReloadSnapshot());
    }
});

test("restoring filters newly sensitive tabs and scroll reset includes inactive nested tabs", () => {
    const f = fixture();
    const saved = layout("a");
    tabs(saved).push({instance: "Tab", children: {...tabs(saved)[0].children, notebookId: "encrypted"} as any});
    f.api.saveReloadSnapshot(saved);
    const restored = f.api.consumeReloadSnapshot();
    assert.equal(tabs(restored).length, 1);
    assert.equal(tabs(restored)[0].children.scrollAttr.scrollTop, 42);
    f.api.removeLayoutScroll(restored);
    assert.equal(tabs(restored)[0].children.scrollAttr, undefined);
    f.api.saveReloadSnapshot(saved);
    f.api.clearReloadSnapshot();
    assert.equal(f.api.consumeReloadSnapshot(), undefined);
});
