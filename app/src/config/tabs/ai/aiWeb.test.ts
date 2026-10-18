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
        const root = {querySelector: (selector: string) => selector.includes("searchProvider") ? search : fetch};
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
