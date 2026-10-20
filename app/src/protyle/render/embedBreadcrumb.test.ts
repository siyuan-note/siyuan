import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isObjectLiteralExpression, isPropertyAssignment, ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {EMBED_BREADCRUMB_PARENT_PATH, getEmbedBreadcrumbPaths} from "./embedBreadcrumb";

const paths: IBreadcrumb[] = ["notebook", "parent", "document", "heading", "block"].map((id, index): IBreadcrumb => ({
    id, name: id, type: index < 3 ? "NodeDocument" : index === 3 ? "NodeHeading" : "NodeParagraph",
    subType: "", children: [],
}));

test("document-only breadcrumbs preserve the document and all internal ancestors without mutating responses", () => {
    for (const value of [null, "", "true", "unknown"]) {
        assert.equal(getEmbedBreadcrumbPaths(paths, "document", value), paths);
    }
    assert.deepEqual(getEmbedBreadcrumbPaths(paths, "document", "false").map(item => item.id),
        ["document", "heading", "block"]);
    assert.equal(paths.length, 5);
    assert.deepEqual(getEmbedBreadcrumbPaths(paths.slice(0, 3), "document", "false").map(item => item.id), ["document"]);
    assert.equal(getEmbedBreadcrumbPaths(paths, "", "false"), paths);
    assert.equal(getEmbedBreadcrumbPaths(paths, "missing", "false"), paths);
    assert.deepEqual(getEmbedBreadcrumbPaths([], "document", "false"), []);
});

test("embed rendering uses each result's document boundary and preserves full paths by default", () => {
    const compiled = transpileModule(readFileSync("src/protyle/render/blockRender.ts", "utf8") +
        "\nexport {renderEmbed};", {compilerOptions: {module: ModuleKind.CommonJS}}).outputText;
    const breadcrumbs: string[][] = [];
    const api = {} as {renderEmbed: (...args: unknown[]) => void};
    const noop = () => {};
    const dependencies = {
        EMBED_BREADCRUMB_PARENT_PATH, getEmbedBreadcrumbPaths,
        genBreadcrumb: (items: IBreadcrumb[]) => { breadcrumbs.push(items.map(item => item.id)); return "breadcrumbs"; },
        normalizeHTMLAssetIFrameBlockDOM: (html: string) => html,
        improveBreadcrumbAppearance: noop, processRender: noop, highlightRender: noop, avRender: noop,
        hasClosestByAttribute: () => false, isDirectHeadingEmbed: () => false,
    };
    runInNewContext(compiled, {exports: api, require: () => dependencies,
        window: {siyuan: {languages: {}}}, Lute: {UnEscapeHTMLStr: (text: string) => text}});
    for (const value of [null, "false", "true"]) {
        breadcrumbs.length = 0;
        const item = {
            querySelector: (): null => null, querySelectorAll: (): Element[] => [],
            getAttribute: (name: string) => name === EMBED_BREADCRUMB_PARENT_PATH ? value : "",
            firstElementChild: {insertAdjacentHTML: noop}, style: {},
        };
        api.renderEmbed([
            {block: {rootID: "document", id: "block", content: "one"}, blockPaths: paths},
            {block: {rootID: "other", id: "child", content: "two"},
                blockPaths: [...paths.slice(0, 2), {...paths[2], id: "other"}, {...paths[4], id: "child"}]},
        ], {}, item);
        assert.deepEqual(breadcrumbs, value === "false" ?
            [["document", "heading", "block"], ["other", "child"]] :
            [["notebook", "parent", "document", "heading", "block"], ["notebook", "parent", "other", "child"]]);
    }
});

test("the shared desktop and mobile embed menu toggles only the selected embed and refreshes it", () => {
    const source = createSourceFile("gutter.ts", readFileSync("src/protyle/gutter/index.ts", "utf8"), ScriptTarget.Latest, true);
    let expression: string;
    const visit = (node: import("typescript").Node) => {
        if (isObjectLiteralExpression(node) && node.properties.some(property => isPropertyAssignment(property) &&
            property.name.getText(source) === "id" && property.initializer.getText(source) === '"embedBlockBreadcrumbParentPath"')) {
            expression = node.getText(source);
        }
        node.forEachChild(visit);
    };
    visit(source);
    assert.ok(expression);
    const attributes = new Map<string, string>();
    const requests: unknown[] = [];
    let renders = 0;
    const nodeElement = {
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
    };
    const context = {
        EMBED_BREADCRUMB_PARENT_PATH, nodeElement, id: "embed", protyle: {},
        window: {siyuan: {languages: {embedBlockBreadcrumbParentPath: "Parent path"}}},
        fetchPost: (url: string, data: unknown) => requests.push([url, JSON.parse(JSON.stringify(data))]),
        blockRender: (_protyle: object, item: object) => {
            assert.equal(item, nodeElement);
            assert.equal(attributes.has("data-render"), false);
            renders++;
        },
    };
    const open = () => runInNewContext(transpileModule(`(${expression})`,
        {compilerOptions: {target: ScriptTarget.ES2021}}).outputText, context);
    assert.equal(open().checked, true);
    for (const value of ["false", "true"]) {
        attributes.set("data-render", "true");
        open().click();
        assert.equal(attributes.get(EMBED_BREADCRUMB_PARENT_PATH), value);
        assert.equal(open().checked, value === "true");
    }
    assert.equal(renders, 2);
    assert.deepEqual(requests, ["false", "true"].map(value =>
        ["/api/attr/setBlockAttrs", {id: "embed", attrs: {[EMBED_BREADCRUMB_PARENT_PATH]: value}}]));
});

test("the bundled engine preserves the preference through native block serialization", () => {
    if (typeof Lute === "undefined") {
        require("../../../stage/protyle/js/lute/lute.min.js");
    }
    const lute = Lute.New();
    lute.SetProtyleWYSIWYG(true);
    lute.SetKramdownIAL(true);
    const html = "<div data-type=\"NodeBlockQueryEmbed\" data-node-id=\"20261020000000-abcdefg\" " +
        `data-content="select * from blocks" ${EMBED_BREADCRUMB_PARENT_PATH}="false"><div class="protyle-attr"></div></div>`;
    const markdown = lute.BlockDOM2Md(html);
    assert.ok(markdown.includes(`${EMBED_BREADCRUMB_PARENT_PATH}="false"`));
    assert.ok(lute.Md2BlockDOM(markdown).includes(`${EMBED_BREADCRUMB_PARENT_PATH}="false"`));
});
