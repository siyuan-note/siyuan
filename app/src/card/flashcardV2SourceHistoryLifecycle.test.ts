import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {transpileModule, ModuleKind, ScriptTarget} from "typescript";
const source = readFileSync("src/card/flashcardV2SourceHistory.ts", "utf8");
const code = transpileModule(source.slice(source.indexOf("export const openFlashcardV2SourceHistory ="))
    .replace("export const", "const") + '\nopenFlashcardV2SourceHistory("source", changed);', {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const version = (id: string) => ({revision: {revisionID: id, updatedAt: 1, payload: {generationConfig: {}}},
    references: [] as Array<{entityID: string, entityType: string, role: string}>, documents: {}, modes: [] as string[]});
const flush = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); } };
const setup = async () => {
    const pending: Array<{data: Record<string, unknown>, resolve: (data: unknown) => void}> = [];
    const nodes = new Map<string, ReturnType<typeof control>>();
    const control = () => {
        let html = "";
        const classes = new Set(["fn__none"]);
        const listeners: Record<string, () => void> = {};
        return {disabled: false, value: "", listeners,
            classList: {add: (s: string) => classes.add(s), remove: (s: string) => classes.delete(s), contains: (s: string) => classes.has(s)},
            addEventListener: (name: string, cb: () => void) => { listeners[name] = cb; },
            replaceChildren: () => { html = ""; },
            get innerHTML() { return html; },
            set innerHTML(text: string) { html = text; this.value = text.match(/value="([^"]+)"/)?.[1] || ""; }};
    };
    const node = (key: string) => {
        if (!nodes.has(key)) { nodes.set(key, control()); }
        return nodes.get(key);
    };
    let handler: (event: unknown) => void;
    let confirm: () => Promise<void>;
    let changes = 0;
    let closes = 0;
    let content = "";
    let confirmTitle = "";
    const element = {isConnected: true, dataset: {} as Record<string, string>, querySelector: node,
        addEventListener: (_name: string, cb: typeof handler) => { handler = cb; }};
    runInNewContext(code, {
        requestData: (url: string, data: Record<string, unknown>) => {
            if (url.endsWith("getEntity")) { return Promise.resolve({found: true, revision: {revisionID: "current"}}); }
            if (!pending.length && data.revisionID === "current") { return Promise.resolve(version("current")); }
            return new Promise(resolve => pending.push({data, resolve}));
        },
        window: {siyuan: {languages: new Proxy({}, {get: (_, key) => String(key)})}},
        Dialog: class {
            element = element;
            constructor(options: {content: string}) { content = options.content; }
            destroy() { closes++; element.dataset.dialogClosing = "true"; }
        },
        isMobile: () => false, escapeHtml: (s: string) => s, escapeAttr: (s: string) => s,
        renderSourceHistoryConfiguration: () => "", genUUID: () => "operation",
        confirmDialog: (options: {title: string, confirm: typeof confirm}) => {
            confirmTitle = options.title;
            confirm = options.confirm;
        },
        changed: () => { changes++; },
    });
    await flush();
    return {pending, node, element, action: (action: string) => handler({target: {closest: () => ({dataset: {action}})}}),
        confirm: () => confirm(), changes: () => changes, closes: () => closes,
        content: () => content, confirmTitle: () => confirmTitle};
};
const ready = async () => {
    const h = await setup();
    h.pending[0].resolve({versions: [version("old").revision]});
    await flush();
    h.pending[1].resolve(version("old"));
    await flush();
    return h;
};

test("source version restoration uses its own label instead of window restoration", async () => {
    const h = await ready();
    assert.match(h.content(), /data-action="restore"[^>]*>flashcardSourceRestore<\/button>/);
    h.action("restore");
    assert.equal(h.confirmTitle(), "flashcardSourceRestore");
    assert.doesNotMatch(source, /lang\.restore\b/);
});

test("failed list and preview have same-request retry", async () => {
    const h = await setup();
    h.pending[0].resolve(undefined);
    await flush();
    assert.equal(h.node('[data-action="retry"]').classList.contains("fn__none"), false);
    h.action("retry");
    assert.equal(h.pending[1].data.offset, 0);
    h.pending[1].resolve({versions: [version("old").revision]});
    await flush();
    h.pending[2].resolve(undefined);
    await flush();
    assert.equal(h.node('[data-action="retry"]').classList.contains("fn__none"), false);
    h.action("retry");
    assert.equal(h.pending[3].data.revisionID, "old");
    h.pending[3].resolve(version("old"));
    await flush();
    assert.equal(h.node('[data-action="restore"]').disabled, false);
});

test("restore freezes navigation and reuses operation after failure", async () => {
    const h = await ready();
    h.action("restore");
    const saving = h.confirm();
    for (const name of ["version", "previous", "next", "restore"]) {
        assert.equal(h.node(`[data-action="${name}"]`).disabled, true);
    }
    h.node('[data-action="version"]').listeners.change();
    h.node('[data-action="next"]').listeners.click();
    assert.equal(h.pending.length, 3);
    const first = h.pending[2];
    first.resolve(undefined);
    await saving;
    assert.equal(h.node('[data-action="restore"]').disabled, false);
    h.action("restore");
    const retry = h.confirm();
    assert.strictEqual(h.pending[3].data, first.data);
    h.pending[3].resolve({});
    await retry;
    assert.equal(h.changes(), 1);
});

test("late completion does not mutate closed UI but successful restore refreshes data", async () => {
    const loading = await setup();
    loading.element.dataset.dialogClosing = "true";
    loading.pending[0].resolve({versions: [version("old").revision]});
    await flush();
    assert.equal(loading.pending.length, 1);
    assert.equal(loading.node('[data-action="version"]').innerHTML, "");
    for (const success of [false, true]) {
        const h = await ready();
        h.action("restore");
        const saving = h.confirm();
        h.element.isConnected = false;
        h.pending[2].resolve(success ? {} : undefined);
        await saving;
        assert.equal(h.closes(), 0);
        assert.equal(h.node('[data-action="restore"]').disabled, true);
        assert.equal(h.changes(), success ? 1 : 0);
    }
});

test("a preview response cannot render during closing and stale confirmation cannot restore another version", async () => {
    const h = await ready();
    h.action("restore");
    h.node('[data-action="version"]').value = "other";
    h.node('[data-action="version"]').listeners.change();
    await h.confirm();
    assert.equal(h.pending.length, 3);
    h.element.dataset.dialogClosing = "true";
    h.pending[2].resolve(version("other"));
    await flush();
    assert.equal(h.node("[data-preview]").innerHTML, "");
    assert.equal(h.node('[data-action="restore"]').disabled, true);
});

test("preview eligibility keeps current and plugin versions read-only", async () => {
    for (const current of [false, true]) {
        const h = await setup();
        const item = version(current ? "current" : "plugin");
        if (!current) {
            Object.assign(item.revision.payload, {pluginNamespace: "plugin"});
        }
        h.pending[0].resolve({versions: [item.revision]});
        await flush();
        h.pending[1].resolve(item);
        await flush();
        assert.equal(h.node('[data-action="restore"]').disabled, true);
    }
});
