import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {ScriptTarget, transpileModule} from "typescript";

it("keeps snapshot ID lookup separate from file search and normal pagination", async () => {
    const source = readFileSync(join(__dirname, "history.ts"), "utf8");
    const code = source.slice(source.indexOf("const renderRepo ="), source.indexOf("const renderRmNotebook ="));
    for (const test of [
        {mode: "id", keyword: " abc ", path: "getRepoSnapshots", body: {id: "abc", page: 1}, files: false},
        {mode: "file", keyword: "abc", path: "searchRepoFile", body: {keyword: "abc", page: 3}, files: true},
        {mode: "id", keyword: "  ", path: "getRepoSnapshots", body: {page: 3}, files: false},
    ]) {
        const noop = () => {};
        const node = () => ({classList: {contains: () => false, toggle: noop, add: noop, remove: noop},
            setAttribute: noop, removeAttribute: noop, textContent: "", innerHTML: "", disabled: false});
        const searchButton = node();
        const searchInput = {...node(), value: test.keyword, parentElement: node(), nextElementSibling: searchButton};
        const next = {...node(), nextElementSibling: {nextElementSibling: node()}};
        const nodes: Record<string, unknown> = {
            ".b3-text-field": searchInput,
            '[data-type="repoSearchMode"]': {...node(), value: test.mode},
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
            setRepoSearchLayout: (_element: Element, files: boolean) => { fileLayout = files; },
            updateRepoSelection: noop,
            fetchSyncPost: async (path: string, body: unknown) => {
                requests.push({path, body});
                return {code: 0, data: {pageCount: 1, totalCount: 0}};
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
        assert.deepEqual(requests, [{path: "/api/repo/" + test.path, body: test.body}]);
        assert.deepEqual(rendered, [test.files ? "files" : "snapshots"]);
        assert.equal(fileLayout, test.files);
        assert.equal(searchButton.disabled, false);
    }
});
