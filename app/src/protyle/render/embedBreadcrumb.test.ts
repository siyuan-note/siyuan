import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, transpileModule} from "typescript";
import {getEmbedBreadcrumbPaths, resolveEmbedBreadcrumbPreference} from "./embedBreadcrumb";

const constants = {} as typeof import("../../constants");
runInNewContext(transpileModule(readFileSync("src/constants.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS},
}).outputText, {exports: constants, SIYUAN_VERSION: "test", NODE_ENV: "test"});
const attribute = constants.Constants.CUSTOM_SY_EMBED_BREADCRUMB_PARENT_PATH;
const paths: IBreadcrumb[] = [
    {id: "document", name: "Notebook/Parent/Title / Section &lt;A&gt;", documentTitle: "Title / Section &lt;A&gt;",
        type: "NodeDocument", subType: "", children: []},
    ...["heading", "block"].map((id): IBreadcrumb => ({id, name: "", type: "NodeHeading", subType: "", children: []})),
];

test("embedded preferences inherit global values only without an explicit block override", () => {
    for (const fallback of [false, true]) {
        for (const value of [null, "", "unknown"]) assert.equal(resolveEmbedBreadcrumbPreference(value, fallback), fallback);
        assert.equal(resolveEmbedBreadcrumbPreference("true", fallback), true);
        assert.equal(resolveEmbedBreadcrumbPreference("false", fallback), false);
    }
});

test("document-only breadcrumbs replace the combined path with the exact title without mutating responses", () => {
    assert.equal(getEmbedBreadcrumbPaths(paths, "document", true), paths);
    const result = getEmbedBreadcrumbPaths(paths, "document", false);
    assert.equal(result[0].name, "Title / Section &lt;A&gt;");
    assert.equal(result[0].id, "document");
    assert.equal(result[1], paths[1]);
    assert.equal(paths[0].name, "Notebook/Parent/Title / Section &lt;A&gt;");
    const expanded = [{...paths[0], id: "parent", name: "Parent"}, ...paths];
    assert.deepEqual(getEmbedBreadcrumbPaths(expanded, "document", false).map(item => item.id), ["document", "heading", "block"]);
    assert.equal(getEmbedBreadcrumbPaths(paths.slice(0, 1), "document", false)[0].name, paths[0].documentTitle);
    assert.equal(getEmbedBreadcrumbPaths(paths, "missing", false), paths);
    assert.equal(getEmbedBreadcrumbPaths(paths, "", false), paths);
    const legacy = [{...paths[0], documentTitle: undefined}, ...paths.slice(1)];
    assert.equal(getEmbedBreadcrumbPaths(legacy, "document", false)[0].name, legacy[0].name);
    assert.deepEqual(getEmbedBreadcrumbPaths([], "document", false), []);
});

test("SQL and JS embed rendering use global preferences and per-result document titles", async () => {
    const compiled = transpileModule(readFileSync("src/protyle/render/blockRender.ts", "utf8"),
        {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const breadcrumbs: string[][] = [];
    const requests: Array<{breadcrumb: boolean}> = [];
    const api = {} as {blockRender: (...args: unknown[]) => void};
    const noop = () => {};
    const dependencies = {
        ...constants, getEmbedBreadcrumbPaths, resolveEmbedBreadcrumbPreference,
        genBreadcrumb: (items: IBreadcrumb[]) => { breadcrumbs.push(items.map(item => item.name)); return "breadcrumbs"; },
        normalizeHTMLAssetIFrameBlockDOM: (html: string) => html,
        improveBreadcrumbAppearance: noop, processRender: noop, renderEmbedToolbarVisibility: noop, highlightRender: noop, avRender: noop,
        hasClosestByAttribute: () => false, isDirectHeadingEmbed: () => false, isFoldedRenderContent: () => false,
        isEncryptedBox: () => false, genEmbedRenderFrame: noop, getHostCapabilities: () => ({}),
        fetchPost: (_url: string, data: typeof requests[number], callback: (data: unknown) => void) => {
            requests.push(data);
            callback({data: {blocks: [{block: {rootID: "document", id: "block", content: "one"},
                blockPaths: data.breadcrumb ? paths : []},
            {block: {rootID: "other", id: "child", content: "two"}, blockPaths: data.breadcrumb ?
                [{...paths[0], id: "other", name: "Notebook/Other", documentTitle: "Other"}, paths[2]] : []}]}});
        },
    };
    const editor = {embedBlockBreadcrumb: true, embedBlockBreadcrumbParentPath: true};
    runInNewContext(compiled, {exports: api, require: () => dependencies,
        window: {siyuan: {languages: {}, config: {editor, system: {safeMode: false}}}}, Lute: {UnEscapeHTMLStr: (text: string) => text}});
    for (const global of [true, false]) {
        editor.embedBlockBreadcrumbParentPath = global;
        for (const [value, content] of [null, "false", "true"].flatMap(value =>
            ["select 1", "//!js\nreturn ['block'];"].map(content => [value, content] as const))) {
            const attributes = new Map<string, string>([["data-type", "NodeBlockQueryEmbed"], ["data-content", content]]);
            if (value) attributes.set(attribute, value);
            const item = {
                getAttribute: (name: string) => attributes.get(name) ?? null,
                setAttribute: (name: string, value: string) => attributes.set(name, value),
                closest: (): null => null, querySelector: (): null => null, querySelectorAll: (): Element[] => [],
                firstElementChild: {insertAdjacentHTML: noop}, style: {},
            };
            breadcrumbs.length = 0;
            api.blockRender({block: {rootID: "host"}}, item);
            await new Promise(setImmediate);
            assert.equal(requests.at(-1).breadcrumb, true);
            assert.equal(breadcrumbs[0][0], resolveEmbedBreadcrumbPreference(value, global) ? paths[0].name : paths[0].documentTitle);
            assert.equal(breadcrumbs[1][0], resolveEmbedBreadcrumbPreference(value, global) ? "Notebook/Other" : "Other");
            attributes.delete("data-render");
            attributes.set("breadcrumb", "false");
            api.blockRender({block: {rootID: "host"}}, item);
            await new Promise(setImmediate);
            assert.equal(requests.at(-1).breadcrumb, false);
        }
    }
});

test("the bundled engine preserves explicit preferences and removes default attributes on serialization", () => {
    if (typeof Lute === "undefined") require("../../../stage/protyle/js/lute/lute.min.js");
    const lute = Lute.New();
    lute.SetProtyleWYSIWYG(true);
    lute.SetKramdownIAL(true);
    for (const value of ["true", "false"]) {
        const html = '<div data-type="NodeBlockQueryEmbed" data-node-id="20261020000000-abcdefg" ' +
            `data-content="select * from blocks" breadcrumb="${value}" ${attribute}="${value}"><div class="protyle-attr"></div></div>`;
        const markdown = lute.BlockDOM2Md(html);
        assert.ok(lute.Md2BlockDOM(markdown).includes(`${attribute}="${value}"`));
        assert.ok(lute.Md2BlockDOM(markdown).includes(`breadcrumb="${value}"`));
        const defaults = lute.BlockDOM2Md(html.replace(` breadcrumb="${value}"`, "").replace(` ${attribute}="${value}"`, ""));
        assert.equal(defaults.includes(attribute), false);
        assert.equal(defaults.includes('breadcrumb="'), false);
    }
});
