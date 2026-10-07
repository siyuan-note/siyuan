import * as assert from "node:assert/strict";
import {it} from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {escapeAttr, escapeHtml, escapeHtmlTextAndAttr} from "../../../util/escape";

const source = createSourceFile("relation.ts", readFileSync(join(__dirname, "relation.ts"), "utf8"), ScriptTarget.ES2021, true);
const load = (names: string[], dependencies: Record<string, unknown>) => {
    const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
    assert.equal(declarations.length, names.length);
    const code = declarations.map(statement => statement.getText(source).replace(/^export /, "")).join("\n");
    return new Function(...Object.keys(dependencies), transpileModule(code, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText + `\nreturn {${names.join(",")}};`)(...Object.values(dependencies));
};

const languages = {
    newRowInRelation: "Create in ${x} <b>${y}</b>", untitled: "Untitled",
    newItemTemplateUnavailableNotebookTip: "Notebook unavailable",
};

it("always offers creation, previews the template name, and escapes database names and titles", () => {
    const previews = new WeakMap();
    const menu = {querySelector: (selector: string) => selector === ".av__relation" ? {dataset: {}} :
        {getAttribute: () => "database-id", textContent: "<Database>"}};
    const {genRelationFooterHTML} = load(["genRelationFooterHTML"], {
        relationItemPreviews: previews, escapeAttr, escapeHtml, escapeHtmlTextAndAttr, window: {siyuan: {languages}},
    });
    assert.match(genRelationFooterHTML(menu, ""), /data-relation-type="create"/);
    assert.match(genRelationFooterHTML(menu, ""), /disabled/);
    previews.set(menu, {keyword: "Task A", preview: {primaryKey: "<Template name>"}});
    const html = genRelationFooterHTML(menu, "Task A");
    assert.match(html, /&lt;Database>/);
    assert.match(html, /&lt;Template name&gt;/);
    assert.doesNotMatch(html, /Task A|disabled/);
    previews.set(menu, {keyword: "Task A", preview: {primaryKey: ""}});
    assert.match(genRelationFooterHTML(menu, "Task A"), /Untitled/);
    assert.doesNotMatch(genRelationFooterHTML(menu, "Task A"), /Task A/);
    previews.set(menu, {keyword: "", preview: {primaryKey: "", error: "Invalid template"}});
    assert.match(genRelationFooterHTML(menu, ""), /disabled.*title="Invalid template"/);
});

const creationFixture = (mobile: boolean, response: Promise<unknown>) => {
    const attributes = new Set<string>();
    const target = {
        dataset: {relationType: "create"}, classList: {contains: () => true}, getAttribute: (): string | null => null,
        hasAttribute: (name: string) => attributes.has(name),
        setAttribute: (name: string) => attributes.add(name), removeAttribute: (name: string) => attributes.delete(name),
    };
    const relation = {dataset: {keyId: "relation-key"}};
    const html: string[] = [];
    const events: string[] = [];
    const messages: unknown[] = [];
    const requests: unknown[] = [];
    const preview = {templateID: "default-template", primaryKey: "Template name", createdAt: 123};
    const menu = {
        firstElementChild: mobile ? {className: "mobile-header"} : relation,
        isConnected: true,
        querySelector: (selector: string) => {
            if (selector === ".av__relation") { return relation; }
            if (selector === "input") { return {value: "Task A"}; }
            if (selector.includes("selectedRows")) { return {insertAdjacentHTML: (_: string, value: string) => html.push(value)}; }
            return undefined;
        },
        dispatchEvent: (event: {type: string}) => events.push(event.type),
    };
    const node = {dataset: {avId: "source", nodeId: "source-carrier"}, contains: () => true};
    const protyle = {app: {appId: "app"}, id: "editor"};
    const previews = new WeakMap([[menu, {keyword: "Task A", preview}]]);
    const {setRelationCell} = load(["genCreatedRelationRowHTML", "setRelationCell"], {
        relationItemPreviews: previews,
        hasClosestByClassName: () => menu,
        getRelationValue: () => ({blockIDs: ["existing"], contents: [{type: "block", block: {content: "Existing"}}]}),
        updateCellsValue: async (_protyle: unknown, _node: unknown, value: {blockIDs: string[]}, ...args: unknown[]) => {
            assert.deepEqual(value.blockIDs, ["existing", "pending"]);
            assert.equal(args[3], true);
            assert.equal(args[7], false);
            assert.equal(html.length, 0);
            return {doOperations: [
                {action: "updateAttrViewCell", rowID: "source-row-1", data: {relation: {blockIDs: ["existing", "pending"]}}},
                {action: "updateAttrViewCell", rowID: "source-row-2", data: {relation: {blockIDs: ["hidden-existing", "pending"]}}},
            ]};
        },
        fetchSyncPost: (url: string, data: unknown) => {
            assert.equal(url, "/api/av/createAttributeViewRelationItem");
            requests.push(data);
            return response;
        },
        Lute: {NewNodeID: () => "pending"},
        getAVBlockIconHTML: ({isDetached}: {isDetached: boolean}) => isDetached ? "detached-icon" : "document-icon",
        escapeAttr, escapeHtml, escapeHtmlTextAndAttr,
        showMessage: (...values: unknown[]) => messages.push(values),
        updateCopyRelatedItems: () => {},
        CustomEvent: class { constructor(public type: string) {} },
        window: {siyuan: {languages}},
    });
    return {run: () => setRelationCell(protyle, node, target, [{}]), html, events, messages, requests, attributes};
};

for (const mobile of [false, true]) {
    it(`creates a document relation once and preserves batch relations on ${mobile ? "mobile" : "desktop"}`, async () => {
        let finish: (value: unknown) => void;
        const fixture = creationFixture(mobile, new Promise(resolve => { finish = resolve; }));
        const pending = fixture.run();
        await Promise.resolve();
        await fixture.run();
        assert.equal(fixture.requests.length, 1);
        assert.equal(fixture.html.length, 0);
        const request = fixture.requests[0] as {cells: unknown[], preview: {primaryKey: string}, keyword: string};
        assert.deepEqual(request.cells, [
            {itemID: "source-row-1", relatedItemIDs: ["existing"]},
            {itemID: "source-row-2", relatedItemIDs: ["hidden-existing"]},
        ]);
        assert.equal(request.keyword, "Task A");
        assert.equal(request.preview.primaryKey, "Template name");
        finish({code: 0, data: {itemID: "created", blockID: "document", content: "Template name", isDetached: false}});
        await pending;
        assert.equal(fixture.html.length, 1);
        assert.match(fixture.html[0], /popover__block.*data-id="document"/);
        assert.match(fixture.html[0], /document-icon/);
        assert.equal(fixture.attributes.size, 0);
        assert.ok(fixture.events.includes("relationrefresh"));
    });
}

it("keeps failed creations out of the panel and permits retry", async () => {
    for (const result of [
        {code: -1, data: null}, {code: 1, data: {unavailableNotebook: true}},
    ]) {
        const fixture = creationFixture(false, Promise.resolve(result));
        await fixture.run();
        assert.equal(fixture.html.length, 0);
        assert.equal(fixture.attributes.size, 0);
        assert.ok(fixture.events.includes("relationrefresh"));
        if (result.code === 1) { assert.equal(fixture.messages.length, 1); }
    }
    const networkFailure = creationFixture(false, Promise.reject(new Error("Network unavailable")));
    await networkFailure.run();
    assert.equal(networkFailure.html.length, 0);
    assert.equal(networkFailure.messages.length, 1);
    assert.equal(networkFailure.attributes.size, 0);
});
