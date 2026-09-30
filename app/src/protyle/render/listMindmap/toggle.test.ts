import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {isProtyleListItemFragment, registerProtyleRuntimeCapabilities} from "../../runtimeCapabilities";

const source = createSourceFile("index.ts", readFileSync("src/protyle/render/listMindmap/index.ts", "utf8"),
    ScriptTarget.ES2021, true);
const declarations = source.statements.filter(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => ["canToggleView", "canEdit", "toggleListMindmap"].includes(item.name.getText(source))));
const compiled = transpileModule(declarations.map(item => item.getText(source).replace(/^export /, "")).join("\n") +
    "\nglobalThis.api = {canEdit, toggleListMindmap};", {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;

const setup = (embedded = true) => {
    const root = {};
    const embed = {};
    const owner = {disabled: false, lite: false, options: {action: [] as string[]}, wysiwyg: {element: root}};
    const attribute = "custom-sy-list-mindmap";
    const attrs = new Map([[attribute, "1"]]);
    const list = {
        isConnected: true,
        dataset: {type: "NodeList", nodeId: "source-list"},
        outerHTML: '<div data-type="NodeList"></div>',
        closest: (selector: string) => selector === ".protyle-wysiwyg" ? root : embedded ? embed : null,
        get attributes() { return Array.from(attrs, ([name, value]) => ({name, value})); },
        getAttribute: (name: string) => attrs.get(name),
        setAttribute: (name: string, value: string) => {
            if (name === "data-type") { list.dataset.type = value; }
            attrs.set(name, value);
        },
        removeAttribute: (name: string) => attrs.delete(name),
        replaceChildren: (...children: unknown[]) => { replaced.push(children); },
        ownerDocument: {createElement: () => ({innerHTML: "", content: {firstElementChild: {
            attributes: [{name: "data-type", value: "NodeList"}, {name: "data-node-id", value: "source-list"}],
            childNodes: ["new parent"],
        }}})},
    };
    const replaced: unknown[][] = [];
    const operations: {doOperations: any[], undoOperations: any[]}[] = [];
    const updates: string[] = [];
    const context: any = {
        Constants: {CB_GET_HISTORY: "history", CUSTOM_SY_LIST_MINDMAP: attribute},
        isProtyleListItemFragment,
        roots: new WeakMap(), hideElements: () => {}, readListMindmap: () => {},
        hasListMindmapRootTitle: () => false,
        cleanListMindmapHTML: (html: string) => html,
        retagMindmapBranch: (_element: Element, toMindmap: boolean) => {
            list.dataset.type = toMindmap ? "NodeMindmap" : "NodeList";
        },
        updateTransaction: (_owner: unknown, _element: Element, previous: string) => updates.push(previous),
        transaction: (actualOwner: unknown, doOperations: any[], undoOperations: any[]) => {
            assert.equal(actualOwner, owner);
            operations.push({doOperations, undoOperations});
        },
    };
    runInNewContext(compiled, context);
    return {owner, list, attrs, attribute, operations, updates, replaced, context, api: context.api};
};

test("a regular list becomes a dedicated mind map block", () => {
    const {owner, list, attrs, attribute, operations, updates, api} = setup();
    attrs.delete(attribute);
    api.toggleListMindmap(owner, list);
    assert.equal(list.dataset.type, "NodeMindmap");
    assert.deepEqual(updates, ['<div data-type="NodeList"></div>']);
    assert.equal(operations.length, 0);
});

test("a dedicated mind map becomes a list block", () => {
    const {owner, list, attrs, attribute, operations, updates, api} = setup();
    attrs.delete(attribute);
    list.dataset.type = "NodeMindmap";
    list.outerHTML = '<div data-type="NodeMindmap"></div>';
    api.toggleListMindmap(owner, list);
    assert.equal(list.dataset.type, "NodeList");
    assert.deepEqual(updates, ['<div data-type="NodeMindmap"></div>']);
    assert.equal(operations.length, 0);
});

test("embedded mind maps persist view changes against the source list with undo", () => {
    const {owner, list, attrs, attribute, operations, api} = setup();
    assert.equal(api.canEdit(owner, list), false, "embedded node content remains read-only");
    for (const next of ["", "1"]) {
        const previous = attrs.get(attribute);
        api.toggleListMindmap(owner, list);
        const operation = operations[operations.length - 1];
        assert.equal(operation.doOperations[0].action, "setAttrs");
        assert.equal(operation.doOperations[0].id, "source-list");
        assert.deepEqual(JSON.parse(operation.doOperations[0].data), {[attribute]: next});
        assert.deepEqual(JSON.parse(operation.undoOperations[0].data), {[attribute]: previous});
        assert.equal(attrs.get(attribute), next);
    }
    assert.equal(operations.length, 2);
});

test("read-only, history and lightweight editors cannot persist embedded view changes", () => {
    for (const mode of ["disabled", "lite", "history"]) {
        const {owner, list, operations, api} = setup();
        if (mode === "history") {
            owner.options.action.push("history");
        } else {
            owner[mode as "disabled" | "lite"] = true;
        }
        api.toggleListMindmap(owner, list);
        assert.equal(operations.length, 0);
    }
});

test("list item fragments can persist embedded view changes unless disabled or showing history", () => {
    for (const mode of ["editable", "disabled", "history"]) {
        const {owner, list, operations, api} = setup();
        owner.lite = true;
        registerProtyleRuntimeCapabilities(owner as unknown as IProtyle, {listItemFragment: true});
        owner.disabled = mode === "disabled";
        if (mode === "history") {
            owner.options.action.push("history");
        }
        api.toggleListMindmap(owner, list);
        assert.equal(operations.length, mode === "editable" ? 1 : 0);
    }
});

test("removed lists and blocks without IDs cannot submit view changes", () => {
    for (const removed of [false, true]) {
        const {list, owner, api, operations} = setup();
        if (removed) {
            list.isConnected = false;
        } else {
            list.dataset.nodeId = "";
        }
        api.toggleListMindmap(owner, list);
        assert.equal(operations.length, 0);
    }
});

test("leaving either mindmap format materializes a title using its current list type and full undo source", async () => {
    for (const legacy of [false, true]) {
        for (const [subtype, conversion] of [["u", "OL2UL"], ["o", "UL2OL"], ["t", "UL2TL"]]) {
            const state = setup(false);
            if (!legacy) { state.list.dataset.type = "NodeMindmap"; }
            state.context.hasListMindmapRootTitle = () => true;
            const full = {outerHTML: "complete source", getAttribute: () => subtype};
            state.context.prepareListMindmapConversion = async () => full;
            state.context.convertListMindmapToList = (source: unknown, type: string) => {
                assert.equal(source, full);
                assert.equal(type, conversion);
                return "converted";
            };
            await state.api.toggleListMindmap(state.owner, state.list);
            assert.equal(state.list.dataset.type, "NodeList");
            assert.deepEqual(state.updates, ["complete source"]);
            assert.deepEqual(state.replaced, [["new parent"]]);
            assert.equal(state.operations.length, 0);
        }
    }
});

test("a failed preparation or revoked editing permission cannot change the exiting mindmap", async () => {
    for (const disabled of [false, true]) {
        const state = setup(false);
        state.list.dataset.type = "NodeMindmap";
        state.context.hasListMindmapRootTitle = () => true;
        state.context.prepareListMindmapConversion = async () => {
            state.owner.disabled = disabled;
            return disabled ? {} : undefined;
        };
        await state.api.toggleListMindmap(state.owner, state.list);
        assert.equal(state.list.dataset.type, "NodeMindmap");
        assert.deepEqual(state.updates, []);
        assert.deepEqual(state.replaced, []);
    }
});

test("embedded read-only content exits without materializing its virtual root", async () => {
    const state = setup();
    state.context.hasListMindmapRootTitle = () => { throw new Error("no content conversion in embeds"); };
    await state.api.toggleListMindmap(state.owner, state.list);
    assert.equal(state.operations.length, 1);
    assert.deepEqual(state.updates, []);
    assert.deepEqual(state.replaced, []);
});
