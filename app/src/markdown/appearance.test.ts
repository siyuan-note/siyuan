import * as assert from "node:assert/strict";
import {test} from "node:test";
import {createMarkdownFontAppearance, markdownFontStyle, quoteMarkdownFont} from "./appearance";
import type {MarkdownAppearance} from "./bridge";

const snapshot = (): MarkdownAppearance => ({
    theme: "system", fontSize: 16, sources: {theme: "one", fontSize: "one", fonts: "one"},
    workspaces: [{id: "one", name: "Workspace"}],
    fonts: {global: [{family: "Global", weight: 500}], editor: [{family: "Custom", weight: 600}], code: []},
    customFonts: [{family: "Custom", weight: 600, url: "https://local/font/one"}],
});

test("Markdown font lists quote CSS text and preserve priority, weights and theme fallbacks", () => {
    assert.equal(quoteMarkdownFont('a"; color:red; \\b\nc'), '"a\\"; color:red; \\\\b c"');
    assert.deepEqual(markdownFontStyle([{family: "One", weight: 500}, {family: "Two", weight: 400}], "--fallback"), {
        family: 'var(--b3-font-family-emoji-reset), "One", "Two", var(--fallback)', weight: "500",
    });
    assert.deepEqual(markdownFontStyle([], "--fallback"), {family: "var(--fallback)", weight: "400"});
});

test("Markdown custom fonts reject stale loads, retain current fonts for size changes and clean up", async () => {
    const styles = new Map<string, string>();
    const root = {style: {setProperty: (key: string, value: string) => styles.set(key, value), removeProperty: (key: string) => styles.delete(key)}} as unknown as HTMLElement;
    const registered = new Set<FontFace>();
    const pending: Array<{face: FontFace; resolve(): void; reject(): void}> = [];
    const controller = createMarkdownFontAppearance(root, {
        fonts: {add: face => {registered.add(face); return undefined as FontFaceSet;}, delete: face => registered.delete(face)},
        create: () => {
            let resolve: () => void;
            let reject: () => void;
            const face = {load: () => new Promise<FontFace>((ok, fail) => {resolve = () => ok(face); reject = () => fail(new Error("invalid font"));})} as FontFace;
            pending.push({face, resolve: () => resolve(), reject: () => reject()});
            return face;
        },
    });
    const appearance = snapshot();
    controller.apply(appearance);
    assert.equal(styles.get("--markdown-editor-font-weight"), "600");
    controller.apply({...appearance, fontSize: 32, theme: "dark"});
    assert.equal(pending.length, 1);
    const next = {...appearance, customFonts: [{...appearance.customFonts[0], url: "https://local/font/two"}]};
    controller.apply(next);
    pending[0].resolve();
    await Promise.resolve();
    assert.equal(registered.size, 0);
    pending[1].resolve();
    await Promise.resolve();
    assert.equal(registered.size, 1);
    controller.apply({...next, customFonts: [{...appearance.customFonts[0], url: "https://local/font/three"}]});
    assert.equal(registered.size, 0);
    pending[2].reject();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(registered.size, 0);
    controller.apply(appearance);
    controller.destroy();
    pending[3].resolve();
    await Promise.resolve();
    assert.equal(registered.size, 0);
    assert.equal(styles.size, 0);
});
