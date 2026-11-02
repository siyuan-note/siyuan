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
    await Promise.all([preferences.update({mode: "sv"}), preferences.update({theme: "dark"}), preferences.update({fontSize: 24})]);
    assert.deepEqual(await createMarkdownPreferences(directory).read(), {mode: "sv", theme: "dark", fontSize: 24});
    assert.deepEqual(await fs.readdir(directory), ["preferences.json"]);
    await assert.rejects(preferences.update({fontSize: 100}));
    assert.equal((await preferences.read()).fontSize, 24);
});

test("unknown or corrupt preferences are preserved instead of overwritten", async t => {
    const {directory, preferences} = await fixture(t);
    const file = path.join(directory, "preferences.json");
    for (const original of ["{broken", JSON.stringify({version: 2, ...defaults}), " ".repeat(4097)]) {
        await fs.writeFile(file, original);
        await assert.rejects(preferences.read());
        await assert.rejects(preferences.update({theme: "dark"}));
        assert.equal(await fs.readFile(file, "utf8"), original);
    }
});
