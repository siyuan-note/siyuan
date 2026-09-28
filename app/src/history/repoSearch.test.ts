import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {ScriptTarget, transpileModule} from "typescript";

it("detects snapshot IDs and falls back to file search without a mode switch", async () => {
    const source = readFileSync(join(__dirname, "history.ts"), "utf8");
    const code = source.slice(source.indexOf("const renderRepo ="), source.indexOf("const renderRmNotebook ="));
    for (const test of [
        {keyword: " ABC1234 ", snapshotCount: 1, paths: ["getRepoSnapshots"], bodies: [{id: "ABC1234", page: 1}], files: false},
        {keyword: "a".repeat(40), snapshotCount: 2, paths: ["getRepoSnapshots"], bodies: [{id: "a".repeat(40), page: 1}], files: false},
        {keyword: "abc1234", snapshotCount: 0, paths: ["getRepoSnapshots", "searchRepoFile"], bodies: [{id: "abc1234", page: 1}, {keyword: "abc1234", page: 3}], files: true},
        {keyword: "abc", snapshotCount: 0, paths: ["searchRepoFile"], bodies: [{keyword: "abc", page: 3}], files: true},
        {keyword: "abcdef0.sy", snapshotCount: 0, paths: ["searchRepoFile"], bodies: [{keyword: "abcdef0.sy", page: 3}], files: true},
        {keyword: "  ", snapshotCount: 0, paths: ["getRepoSnapshots"], bodies: [{page: 3}], files: false},
        {keyword: "old file search", snapshotCount: 1, paths: ["getRepoSnapshots"],
            range: {startTime: 1000, endTime: 2000}, bodies: [{page: 3, startTime: 1000, endTime: 2000}], files: false},
    ]) {
        const noop = () => {};
        const node = () => ({classList: {contains: () => false, toggle: noop, add: noop, remove: noop},
            setAttribute: noop, removeAttribute: noop, textContent: "", innerHTML: "", disabled: false});
        const searchButton = node();
        const searchInput = {...node(), value: test.keyword, parentElement: node(), nextElementSibling: searchButton};
        const next = {...node(), nextElementSibling: {nextElementSibling: node()}};
        const nodes: Record<string, unknown> = {
            ".b3-text-field": searchInput,
            '[data-type="repoList"]': node(),
            'button[data-type="jumpRepoPage"]': node(),
            '[data-type="previous"]': node(),
            '[data-type="next"]': next,
        };
        const pane = {...node(), isConnected: true, querySelector: (selector: string) => nodes[selector]};
        const requests: unknown[] = [];
        const rendered: string[] = [];
        let fileLayout: boolean;
        const dependencies = {
            repoRequests: new WeakMap(),
            getRepoSnapshotType: () => "getRepoSnapshots",
            getRepoSnapshotRange: () => "range" in test ? test.range : {},
            setRepoSearchLayout: (_element: Element, files: boolean) => { fileLayout = files; },
            updateRepoSelection: noop,
            fetchSyncPost: async (path: string, body: unknown) => {
                requests.push({path, body});
                return {code: 0, data: {pageCount: 1, totalCount: test.snapshotCount}};
            },
            renderRepoSearchResult: () => rendered.push("files"),
            renderRepoItem: () => rendered.push("snapshots"),
            escapeHtml: String,
            window: {siyuan: {languages: {pageCountAndSnapshotCount: "${x} ${y}"}}},
        };
        const renderRepo = new Function(...Object.keys(dependencies), transpileModule(code, {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText + "\nreturn renderRepo;")(...Object.values(dependencies));
        await renderRepo(pane, 3);
        assert.deepEqual(requests, test.paths.map((path, index) => ({path: "/api/repo/" + path, body: test.bodies[index]})));
        assert.deepEqual(rendered, [test.files ? "files" : "snapshots"]);
        assert.equal(fileLayout, test.files);
        assert.equal(searchButton.disabled, false);
    }
});
