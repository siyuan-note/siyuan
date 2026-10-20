import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";

type ProviderControl = {desc: string; afterMount: (root: unknown) => void};

test("web provider descriptions follow the selected services on opening and switching independently", () => {
    const code = transpileModule(readFileSync("src/config/tabs/ai/aiWeb.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    for (const initial of ["default", "deepseek"]) {
        const controls = new Map<string, ProviderControl>();
        const languages = new Proxy({}, {get: (_, key) => String(key)});
        const exports = {} as {registerAiWebGroup: (tab: unknown) => void};
        runInNewContext(code, {exports, window: {siyuan: {languages, config: {ai: {web: initial === "default" ? undefined : {
            searchProvider: "deepseek", fetchProvider: "deepseek",
        }}}}}});
        exports.registerAiWebGroup({group: () => ({
            select: (id: string, spec: ProviderControl) => controls.set(id, spec),
            textBlock: () => {},
            number: () => {},
        })});
        const descriptions = {search: {textContent: ""}, fetch: {textContent: ""}};
        const listeners = new Map<string, () => void>();
        const select = (kind: "search" | "fetch", value: string) => ({
            value,
            closest: () => ({querySelector: () => descriptions[kind]}),
            addEventListener: (name: string, callback: () => void) => {
                assert.equal(name, "change");
                listeners.set(kind, callback);
            },
        });
        const search = select("search", initial === "default" ? "exa" : "deepseek");
        const fetch = select("fetch", initial === "default" ? "direct" : "deepseek");
        const root = {querySelector: (selector: string) => selector.includes("searchProvider") ? search :
            selector.includes("fetchProvider") ? fetch : null};
        const searchSpec = controls.get("ai.web.searchProvider");
        const fetchSpec = controls.get("ai.web.fetchProvider");
        searchSpec.afterMount(root);
        fetchSpec.afterMount(root);
        assert.equal(descriptions.search.textContent, searchSpec.desc);
        assert.equal(descriptions.fetch.textContent, fetchSpec.desc);
        for (const [provider, expected] of [["exa", "aiWebSearchExaTip"], ["deepseek", "aiWebSearchProviderTip"], ["exa", "aiWebSearchExaTip"]]) {
            const previousFetch = descriptions.fetch.textContent;
            search.value = provider;
            listeners.get("search")();
            assert.equal(descriptions.search.textContent, expected);
            assert.equal(descriptions.fetch.textContent, previousFetch);
        }
        for (const [provider, expected] of [["direct", "aiWebFetchDirectTip"], ["deepseek", "aiWebFetchProviderTip"], ["direct", "aiWebFetchDirectTip"]]) {
            const previousSearch = descriptions.search.textContent;
            fetch.value = provider;
            listeners.get("fetch")();
            assert.equal(descriptions.fetch.textContent, expected);
            assert.equal(descriptions.search.textContent, previousSearch);
        }
    }
});

test("the shared DeepSeek key appears for either provider and retains saved and draft values when hidden", () => {
    const code = transpileModule(readFileSync("src/config/tabs/ai/aiWeb.ts", "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS},
    }).outputText;
    for (const searchProvider of ["exa", "deepseek"]) {
        for (const fetchProvider of ["direct", "deepseek"]) {
            const controls = new Map<string, ProviderControl>();
            const web = {searchProvider, fetchProvider, apiKey: "saved-key"};
            const exports = {} as {registerAiWebGroup: (tab: unknown) => void};
            runInNewContext(code, {exports, window: {siyuan: {config: {ai: {web}},
                languages: new Proxy({}, {get: (_, key) => String(key)})}}});
            const register = (id: string, spec: ProviderControl) => controls.set(id, spec);
            exports.registerAiWebGroup({group: () => ({select: register, textBlock: register, number: () => {}})});
            const listeners = new Map<string, () => void>();
            const select = (kind: string, value: string) => ({value,
                closest: () => ({querySelector: () => ({textContent: ""})}),
                addEventListener: (_name: string, listener: () => void) => listeners.set(kind, listener),
            });
            const search = select("search", searchProvider);
            const fetch = select("fetch", fetchProvider);
            let hidden = false;
            const key = {value: "draft-key", closest: () => ({classList: {toggle: (name: string, value: boolean) => {
                assert.equal(name, "fn__none");
                hidden = value;
            }}})};
            const root = {querySelector: (selector: string) => selector.includes("searchProvider") ? search :
                selector.includes("fetchProvider") ? fetch : selector.includes("apiKey") ? key : null};
            controls.get("ai.web.searchProvider").afterMount(root);
            controls.get("ai.web.fetchProvider").afterMount(root);
            controls.get("ai.web.apiKey").afterMount(root);
            assert.equal(hidden, searchProvider !== "deepseek" && fetchProvider !== "deepseek");
            for (const [searchValue, fetchValue, expectedHidden] of [
                ["deepseek", "direct", false], ["deepseek", "deepseek", false],
                ["exa", "deepseek", false], ["exa", "direct", true], ["deepseek", "direct", false],
            ] as const) {
                search.value = searchValue;
                listeners.get("search")();
                fetch.value = fetchValue;
                listeners.get("fetch")();
                assert.equal(hidden, expectedHidden);
                assert.equal(key.value, "draft-key");
                assert.equal(web.apiKey, "saved-key");
            }
        }
    }
});
