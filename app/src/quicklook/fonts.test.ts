import * as assert from "node:assert/strict";
import {test} from "node:test";
import {createQuickLookFonts} from "./fonts";

const setup = () => {
    const styles = new Map<string, string>();
    const faces = new Set<FontFace>();
    const pending: Array<{resolve(): void; reject(): void; source: string}> = [];
    const root = {ownerDocument: {fonts: {add: (face: FontFace) => faces.add(face), delete: (face: FontFace) => faces.delete(face)}},
        style: {setProperty: (key: string, value: string) => styles.set(key, value), removeProperty: (key: string) => styles.delete(key)}} as unknown as HTMLElement;
    const controller = createQuickLookFonts(root, (_family, source) => {
        const face = {load: () => new Promise<FontFace>((resolve, reject) => {
            pending.push({resolve: () => resolve(face), reject: () => reject(new Error("corrupt")), source});
        })} as FontFace;
        return face;
    });
    return {controller, styles, faces, pending};
};
const choice = {family: "Preview", weight: 600};
const payload = (url = "siyuan-preview://bundle/font/aa/bb") => ({fonts: {global: [choice]}, customFonts: [{...choice, url}]});

test("Quick Look awaits explicit font loading and preserves group fallbacks", async () => {
    const state = setup();
    let done = false;
    const ready = state.controller.apply("aa", payload()).then(() => {done = true;});
    await Promise.resolve();
    assert.equal(done, false);
    assert.equal(state.styles.get("--markdown-editor-font-family"), "var(--markdown-global-font-family)");
    assert.equal(state.styles.get("--markdown-editor-font-weight"), "600");
    assert.equal(state.styles.get("--markdown-code-font-weight"), "400");
    state.pending[0].resolve(); await ready;
    assert.equal(state.faces.size, 1);
    await state.controller.apply("cc", {});
    assert.equal(state.faces.size, 0);
    assert.equal(state.styles.get("--markdown-editor-font-family"), "var(--b3-font-family-protyle)");
});

test("Quick Look rejects external, cross-preview and malformed font URLs and payloads", async () => {
    const state = setup();
    for (const url of ["https://example.com/font.ttf", "file:///font.ttf", "siyuan-preview://bundle/font.ttf",
        "siyuan-preview://font/aa/bb", "siyuan-preview://bundle/font/cc/bb", "siyuan-preview://bundle/font/aa/../bb",
        "siyuan-preview://bundle/font/aa/bb?x", "siyuan-preview://bundle/font/aa/%62b"]) {
        await state.controller.apply("aa", payload(url));
    }
    const invalid: unknown[] = [null, [], {fonts: {global: "bad"}}, {fonts: {global: [{family: "x\n", weight: 400}]}}];
    for (const value of invalid) {
        await state.controller.apply("aa", value);
    }
    assert.equal(state.pending.length, 0);
    await state.controller.apply("aa", {fonts: {editor: [{family: 'a"; color:red; \\b', weight: 700}]}});
    assert.equal(state.styles.get("--markdown-editor-font-family"), 'var(--b3-font-family-emoji-reset), "a\\"; color:red; \\\\b", var(--b3-font-family-protyle)');
});

test("Quick Look ignores corrupt and stale font loads and cancellation clears styles", async () => {
    const state = setup();
    const corrupt = state.controller.apply("aa", payload());
    state.pending[0].reject(); await corrupt;
    assert.equal(state.faces.size, 0);
    const old = state.controller.apply("aa", payload());
    const next = state.controller.apply("cc", payload("siyuan-preview://bundle/font/cc/dd"));
    await old;
    state.pending[1].resolve();
    state.controller.clear(); await next;
    state.pending[2].resolve(); await Promise.resolve();
    assert.equal(state.faces.size, 0);
    assert.equal(state.styles.size, 0);
});

test("Quick Look bounds stalled font loading and ignores completion after timeout", async () => {
    const state = setup();
    await state.controller.apply("aa", payload());
    state.pending[0].resolve(); await Promise.resolve();
    assert.equal(state.faces.size, 0);
    assert.equal(state.styles.get("--markdown-global-font-weight"), "600");
    state.controller.clear();
    assert.equal(state.styles.size, 0);
});
