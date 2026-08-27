import * as assert from "node:assert/strict";
import test from "node:test";

Object.assign(globalThis, {
    NODE_ENV: "test",
    SIYUAN_VERSION: "test",
});

const loadEditorFontSizeCore = async () => {
    const [{Constants}, core] = await Promise.all([
        import("../constants"),
        import("./editorFontSizeCore"),
    ]);
    return {Constants, ...core};
};

test("normalizes editor font sizes to integer boundaries", async () => {
    const {Constants, normalizeEditorFontSize} = await loadEditorFontSizeCore();
    assert.equal(normalizeEditorFontSize(8), Constants.EDITOR_FONT_SIZE_MIN);
    assert.equal(normalizeEditorFontSize(72.8), Constants.EDITOR_FONT_SIZE_MAX);
    assert.equal(normalizeEditorFontSize(16.4), 16);
    assert.equal(normalizeEditorFontSize(16.5), 17);
});

test("adjusts and resets editor font sizes", async () => {
    const {Constants, resolveEditorFontSize} = await loadEditorFontSizeCore();
    assert.equal(resolveEditorFontSize(16, "increase"), 17);
    assert.equal(resolveEditorFontSize(16, "decrease"), 15);
    assert.equal(resolveEditorFontSize(Constants.EDITOR_FONT_SIZE_MAX, "increase"),
        Constants.EDITOR_FONT_SIZE_MAX);
    assert.equal(resolveEditorFontSize(Constants.EDITOR_FONT_SIZE_MIN, "decrease"),
        Constants.EDITOR_FONT_SIZE_MIN);
    assert.equal(resolveEditorFontSize(42, "reset"), Constants.EDITOR_FONT_SIZE_DEFAULT);
});
