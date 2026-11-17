import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/card/flashcardV2.ts", "utf8");
const membership = source.slice(source.indexOf("const openFlashcardV2Membership ="),
    source.indexOf("const basicSourceDirection ="));

test("automatic membership uses complete translated copy without changing operation values", () => {
    assert.match(membership, /<option value="automatic">\$\{window\.siyuan\.languages\.flashcardMembershipAutomatic\}/);
    assert.match(membership, /data-type="automaticTip" class="b3-label__text ft__on-surface fn__none"/);
    assert.match(membership, /\$\{window\.siyuan\.languages\.flashcardMembershipAutomaticTip\}/);
    const keys = ["flashcardMembershipAutomatic", "flashcardMembershipAutomaticTip"];
    for (const filename of readdirSync("appearance/langs").filter(name => name.endsWith(".json"))) {
        const lang = JSON.parse(readFileSync(`appearance/langs/${filename}`, "utf8"));
        for (const key of keys) {
            assert.equal(typeof lang[key], "string", `${filename}: ${key}`);
            assert.ok(lang[key].length > 0);
            assert.doesNotMatch(lang[key], /[.。।]$/);
        }
        assert.notEqual(lang.flashcardMembershipAutomatic, lang.default);
    }
});

test("automatic membership explanation appears only for automatic mode and follows changes", () => {
    const start = membership.indexOf("        const modeSelect =");
    const end = membership.indexOf("        const submission =", start);
    const code = transpileModule(membership.slice(start, end), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    let change: () => void;
    let hidden = false;
    const mode = {value: "include", addEventListener: (event: string, listener: () => void) => {
        assert.equal(event, "change");
        change = listener;
    }};
    const tip = {classList: {toggle: (name: string, force: boolean) => {
        assert.equal(name, "fn__none");
        hidden = force;
    }}};
    runInNewContext(code, {dialog: {element: {querySelector: (selector: string) =>
        selector === '[data-type="mode"]' ? mode : tip}}});
    assert.equal(hidden, true);
    for (const value of ["automatic", "exclude", "automatic", "include"]) {
        mode.value = value;
        change();
        assert.equal(hidden, value !== "automatic");
    }
});
