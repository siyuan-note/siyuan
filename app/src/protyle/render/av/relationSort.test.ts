import {it} from "node:test";
import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {transpileModule, ScriptTarget} from "typescript";

it("keeps the footer loader hidden while refreshing existing candidates", () => {
    const source = readFileSync(join(__dirname, "relation.ts"), "utf8");
    const start = source.indexOf("    const loadPage = (reset: boolean) => {");
    const end = source.indexOf('    listElement.addEventListener("mousedown"', start);
    assert.ok(start > 0 && end > start);
    for (const test of [{initial: true, reset: true, loader: true},
        {initial: false, reset: true, loader: false}, {initial: false, reset: false, loader: true}]) {
        const loading: boolean[] = [];
        const dependencies = {
            state: {loading: false, page: 1, total: 32, keyword: "", controller: undefined as AbortController | undefined},
            initialLoad: test.initial,
            hasMore: () => true,
            getSelectedItems: (): {id: string}[] => [],
            setLoading: (show: boolean) => loading.push(show),
            relationElement: {getAttribute: () => "database"},
            RELATION_PAGE_SIZE: 16,
            fetchPost: () => ({finally() {}}),
        };
        const loadPage = new Function(...Object.keys(dependencies), transpileModule(source.slice(start, end), {
            compilerOptions: {target: ScriptTarget.ES2021},
        }).outputText + "\nreturn loadPage;")(...Object.values(dependencies));
        loadPage(test.reset);
        assert.deepEqual(loading, [test.loader]);
    }
});

it("toggles one candidate sort, resets paging, and ignores width dragging", () => {
    const source = readFileSync(join(__dirname, "relation.ts"), "utf8");
    const start = source.indexOf('    listElement.addEventListener("click", event => {');
    const end = source.indexOf("    const search = () => {", start);
    assert.ok(start > 0 && end > start);
    const handlers = new Map<string, (event: unknown) => void>();
    const list = {scrollTop: 100, addEventListener: (name: string, fn: (event: unknown) => void) => handlers.set(name, fn)};
    const state = {sort: undefined as {column: string, order: string} | undefined};
    const requests: unknown[] = [];
    const loadPage = (reset: boolean) => requests.push({reset, sort: {...state.sort}});
    new Function("listElement", "state", "loadPage", transpileModule(source.slice(start, end), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText)(list, state, loadPage);
    const click = (column: string, width = false) => {
        handlers.get("click")({target: {closest: (selector: string) => selector === ".av__widthdrag" ?
            (width ? {} : null) : {dataset: {relationColumn: column}}}, stopPropagation() {}});
    };
    click("primary");
    click("primary");
    click("status");
    click("status", true);
    assert.deepEqual(requests, [
        {reset: true, sort: {column: "primary", order: "ASC"}},
        {reset: true, sort: {column: "primary", order: "DESC"}},
        {reset: true, sort: {column: "status", order: "ASC"}},
    ]);
    assert.equal(list.scrollTop, 0);
    let prevented = false;
    handlers.get("keydown")({key: "Enter", target: {closest: () => ({click: () => click("status")})},
        preventDefault() { prevented = true; }, stopPropagation() {}});
    assert.equal(prevented, true);
    assert.deepEqual(state.sort, {column: "status", order: "DESC"});
});
