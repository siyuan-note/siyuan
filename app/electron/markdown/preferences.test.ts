import {test} from "node:test";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {createMarkdownPreferences, defaults} = require("./preferences");

const fixture = async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-markdown-preferences-"));
    t.after(async () => {
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
        await fs.rm(directory, {recursive: true, force: true});
    });
    return {directory, preferences: createMarkdownPreferences(directory)};
};

test("independent preferences serialize updates and survive reopening", async t => {
    const {directory, preferences} = await fixture(t);
    assert.deepEqual(await preferences.read(), defaults);
    await Promise.all([preferences.update({mode: "sv"}), preferences.update({sources: {theme: "a".repeat(64)}}), preferences.update({sources: {fontSize: "b".repeat(64)}})]);
    assert.deepEqual(await createMarkdownPreferences(directory).read(), {mode: "sv", sources: {theme: "a".repeat(64), fontSize: "b".repeat(64)}});
    assert.deepEqual(await fs.readdir(directory), ["preferences.json"]);
    await assert.rejects(preferences.update({sources: {fonts: "invalid"}}));
    assert.equal((await preferences.read()).sources.fontSize, "b".repeat(64));
});

test("unknown or corrupt preferences are preserved instead of overwritten", async t => {
    const {directory, preferences} = await fixture(t);
    const file = path.join(directory, "preferences.json");
    for (const original of ["{broken", JSON.stringify({version: 2, ...defaults}), " ".repeat(131073)]) {
        await fs.writeFile(file, original);
        await assert.rejects(preferences.read());
        await assert.rejects(preferences.update({sources: {theme: "a".repeat(64)}}));
        assert.equal(await fs.readFile(file, "utf8"), original);
    }
});

test("legacy appearance settings are not migrated while independent edit mode is retained", async t => {
    const {directory, preferences} = await fixture(t);
    await fs.writeFile(path.join(directory, "preferences.json"), JSON.stringify({version: 1, mode: "sv", theme: "dark", fontSize: 28}));
    assert.deepEqual(await preferences.read(), {mode: "sv"});
    await preferences.update({sources: {fonts: "c".repeat(64)}});
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, "preferences.json"), "utf8")), {version: 1, mode: "sv", sources: {fonts: "c".repeat(64)}});
});

test("independent settings persist and merge without changing source selections", async t => {
    const {directory, preferences} = await fixture(t);
    await preferences.update({sources: {theme: "independent"}, independent: {theme: "dark"}});
    await preferences.update({independent: {fontSize: 22}});
    const font = {family: "字体".repeat(100), weight: 400};
    const fonts = {global: Array.from({length: 32}, () => font), editor: Array.from({length: 32}, () => font), code: Array.from({length: 32}, () => font)};
    await preferences.update({independent: {fonts}});
    const result = await createMarkdownPreferences(directory).read();
    assert.deepEqual(result.sources, {theme: "independent"});
    assert.equal(result.independent.theme, "dark");
    assert.equal(result.independent.fontSize, 22);
    assert.deepEqual(result.independent.fonts, fonts);
});

 test("invalid surrogate font names cannot write unreadable preferences", async t => {
    const {preferences} = await fixture(t);
    assert.throws(() => preferences.update({independent: {fonts: {global: [{family: "\ud800".repeat(256), weight: 400}], editor: [], code: []}}}));
    assert.deepEqual(await preferences.read(), defaults);
});
