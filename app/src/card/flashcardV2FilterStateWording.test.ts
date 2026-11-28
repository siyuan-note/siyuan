import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ScriptTarget, transpileModule} from "typescript";

const source = readFileSync("src/card/flashcardV2.ts", "utf8");
const queryCode = source.slice(source.indexOf("const flashcardManagementQuery ="),
    source.indexOf("const flashcardManagementFilterCount ="));
const query = (filters: Record<string, string>, list = false) => runInNewContext(transpileModule(queryCode +
    "\nflashcardManagementQuery(filters, list);", {compilerOptions: {target: ScriptTarget.ES2021}}).outputText, {filters, list});

test("state filters preserve boolean values and use complete labels in all languages", () => {
    for (const filename of readdirSync("appearance/langs").filter(name => name.endsWith(".json"))) {
        const languages = JSON.parse(readFileSync(`appearance/langs/${filename}`, "utf8"));
        const fields = [
            ["suspended", "flashcardSuspensionStatus", "flashcardSuspendedCards", "flashcardUnsuspendedCards"],
            ["buried", "flashcardBurialStatus", "flashcardBuriedCards", "flashcardUnburiedCards"],
        ];
        for (const [field, label, yes, no] of fields) {
            const line = source.split("\n").find(value => value.includes(`data-filter="${field}"`));
            const html = runInNewContext(`\`${line}\``, {window: {siyuan: {languages}}}) as string;
            assert.ok(html.includes(`>${languages[label]}</div>`));
            const options = [...html.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)];
            assert.deepEqual(options.map(option => option[1]), ["", "true", "false"]);
            assert.deepEqual(options.map(option => option[2]), [languages.all, languages[yes], languages[no]]);
            assert.doesNotMatch(html, /undefined/);
        }
        for (const [field, key] of [["dueFrom", "flashcardDueOnOrAfter"], ["dueTo", "flashcardDueOnOrBefore"]]) {
            const line = source.split("\n").find(value => value.includes(`data-filter="${field}"`));
            const html = runInNewContext(`\`${line}\``, {window: {siyuan: {languages}}, filters: {}, escapeAttr: (v: string) => v}) as string;
            assert.ok(html.includes(`>${languages[key]}</div>`));
            assert.match(html, /type="datetime-local"/);
            assert.doesNotMatch(html, /undefined/);
        }
    }
});

test("renamed filter UI keeps true false all and inclusive due query semantics", () => {
    for (const field of ["suspended", "buried"]) {
        assert.equal(query({[field]: ""}), undefined);
        for (const value of ["true", "false"]) {
            const result = query({[field]: value});
            assert.equal(result.root.field, field);
            assert.equal(result.root.comparator, "equal");
            assert.equal(result.root.value, value === "true");
        }
    }
    for (const [field, comparator] of [["dueFrom", "greaterOrEqual"], ["dueTo", "lessOrEqual"]]) {
        const result = query({[field]: "2026-11-17T10:00:00Z"});
        assert.equal(result.root.field, "due");
        assert.equal(result.root.comparator, comparator);
        assert.equal(result.root.value, Date.parse("2026-11-17T10:00:00Z"));
    }
});

test("management hides deleted cards by default while statistics retain their original scope", () => {
    const defaultQuery = query({}, true);
    assert.equal(defaultQuery.root.field, "generationStatus");
    assert.equal(defaultQuery.root.comparator, "notEqual");
    assert.equal(defaultQuery.root.value, "deleted");
    assert.equal(query({}), undefined);
    assert.equal(query({generationStatus: "all"}, true), undefined);
    for (const generationStatus of ["deleted", "orphaned", "disabledByTemplate", "active"]) {
        const {root} = query({generationStatus}, true);
        assert.equal(root.field, "generationStatus");
        assert.equal(root.comparator, "equal");
        assert.equal(root.value, generationStatus);
    }
});
