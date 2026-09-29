import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {ScriptTarget, transpileModule} from "typescript";
import {escapeHtml, escapeAttr} from "../util/escape";

test("snapshot lists display all escaped tags and preserve tag-specific actions on desktop and mobile", () => {
    const source = readFileSync(join(__dirname, "history.ts"), "utf8");
    const code = source.slice(source.indexOf("const renderRepoItem ="), source.indexOf("const clearRepoPreview ="));
    for (const mobile of [false, true]) {
        let include = true;
        const selected = code.split("\n").filter(line => {
            if (line.includes("/// #if MOBILE")) {
                include = mobile;
            } else if (line.includes("/// #else")) {
                include = !mobile;
            } else if (line.includes("/// #endif")) {
                include = true;
            } else {
                return include;
            }
            return false;
        }).join("\n");
        const list = {innerHTML: ""};
        const pane = {querySelector: (selector: string) => selector.includes("repoList") ? list : {getAttribute: () => "[]"}};
        const dependencies = {
            window: {siyuan: {config: {}, languages: {tagSnapshot: "Tag snapshot"}}},
            isMobile: () => mobile, snapshotMemos: new WeakMap(), updateRepoSelection: () => {}, escapeHtml, escapeAttr,
        };
        const render = new Function(...Object.keys(dependencies), transpileModule(selected, {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText + "\nreturn renderRepoItem;")(...Object.values(dependencies));
        const snapshot = {id: "a".repeat(40), memo: "memo", tag: "", tags: ["first", "<alias>"], hCreated: "now"};
        render({data: {snapshots: [snapshot]}}, pane, "getRepoSnapshots");
        assert.match(list.innerHTML, />first<\/span>/);
        assert.match(list.innerHTML, />&lt;alias><\/span>/);
        assert.match(list.innerHTML, /data-type="genTag"/);
        assert.match(list.innerHTML, /data-tag=""/);
        render({data: {snapshots: [{...snapshot, tag: "first"}]}}, pane, "getRepoTagSnapshots");
        assert.match(list.innerHTML, /data-tag="first"/);
        assert.doesNotMatch(list.innerHTML, /alias/);
        render({data: {snapshots: [{...snapshot, tags: []}]}}, pane, "getRepoSnapshots");
        assert.doesNotMatch(list.innerHTML, /b3-chip/);
    }
});
