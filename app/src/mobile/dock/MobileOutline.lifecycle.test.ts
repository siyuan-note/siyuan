import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";
import {escapeHtml} from "../../util/escape";

const compiled = transpileModule(readFileSync("src/mobile/dock/MobileOutline.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;

const setup = () => {
    const attributes = new Map<string, string>();
    const hidden = new Set<string>();
    const label = {dataset: {}, classList: {add: () => {}}};
    const title = {
        innerHTML: "",
        insertAdjacentHTML(_position: string, html: string) { this.innerHTML += html; },
        classList: {add: (name: string) => hidden.add(name), remove: (name: string) => hidden.delete(name)},
        querySelector: (selector: string) => selector === ".b3-list-item__text" ? label : null,
        setAttribute: (key: string, value: string) => attributes.set(key, value),
        removeAttribute: (key: string) => attributes.delete(key),
    };
    const input = {value: ""};
    const tree = {data: null as unknown, element: {scrollTop: 0}, updateData(data: unknown) { this.data = data; }};
    const state = {
        empty: false,
        editor: {protyle: {
            block: {rootID: "secret-doc"}, notebookId: "secret-box",
            background: {ial: {title: "Secret/title.sy"}},
            preview: {element: {classList: {contains: () => true}}},
        }},
    };
    const pending: {data: {id: string, notebook?: string}, respond: (response: unknown) => void}[] = [];
    const exports = {} as {MobileOutline: {prototype: Record<string, unknown>}};
    runInNewContext(compiled, {
        exports,
        window: {siyuan: {mobile: {get editor() { return state.editor; }}}},
        document: {getElementById: () => ({classList: {contains: () => state.empty}})},
        require: (id: string) => {
            switch (id) {
                case "../../layout/Model": return {Model: class {}};
                case "../../protyle/header/documentTitlePreview": return {renderDocumentTitlePreview: () => {}};
                case "../../util/pathName": return {getDocDisplayName: (value: string) => value, isEncryptedBox: (box: string) => box === "secret-box"};
                case "../../util/escape": return {escapeHtml};
                case "../../emoji/fileTreeIcon": return {getFileTreeIconHTML: () => ""};
                case "../../constants": return {Constants: {ZWSP: "\u200b", CUSTOM_SY_TITLE_EMPTY: "custom-sy-title-empty"}};
                case "../../util/fetch": return {fetchPost: (_url: string, data: {id: string, notebook?: string}, respond: (response: unknown) => void) => pending.push({data, respond})};
                default: return {};
            }
        },
    });
    const outline = Object.assign(Object.create(exports.MobileOutline.prototype), {
        currentRequestID: 0, reloadId: 0, blockId: "", notebookId: "", isPreview: false, preFilterExpandIds: null,
        tree,
        element: {
            querySelector: (selector: string) => selector === '[data-type="doc-title"]' ? title :
                selector === "input.b3-text-field.search__label" ? input : null,
            removeAttribute: () => {},
        },
    });
    outline.reload();
    const headings = [{id: "secret-heading", content: "Secret heading"}];
    pending.shift().respond({data: headings});
    return {outline, state, tree, title, attributes, hidden, pending, headings};
};

for (const cmd of ["closeBox", "removeBox", "removeDoc"]) {
    test(`mobile outline clears cached content on ${cmd} even after the editor switches notebooks`, () => {
        const h = setup();
        h.state.editor.protyle.block.rootID = "public-doc";
        h.state.editor.protyle.notebookId = "public-box";
        h.outline.handleMsgCallback({cmd, data: {box: "secret-box", ids: ["secret-doc"]}});
        assert.equal(h.tree.data, null);
        assert.equal(h.title.innerHTML, "");
        assert.equal(h.attributes.has("title"), false);
        assert.equal(h.hidden.has("fn__none"), true);
        assert.equal(h.outline.blockId, "");
    });

    test(`mobile outline preserves another document on unrelated ${cmd}`, () => {
        const h = setup();
        h.outline.handleMsgCallback({cmd, data: {box: "other-box", ids: ["other-doc"]}});
        assert.equal(h.tree.data, h.headings);
        assert.equal(h.attributes.get("title"), "Secret/title.sy");
        assert.equal(h.outline.blockId, "secret-doc");
    });
}

test("late mobile outline responses cannot restore locked content, and reopening loads fresh content", () => {
    const h = setup();
    h.outline.reload();
    const old = h.pending.shift();
    assert.equal(old.data.notebook, "secret-box");
    h.outline.handleMsgCallback({cmd: "closeBox", data: {box: "secret-box"}});
    old.respond({data: h.headings});
    assert.equal(h.tree.data, null);
    assert.equal(h.title.innerHTML, "");
    assert.equal(h.attributes.has("title"), false);
    h.state.editor.protyle.background.ial.title = "Reopened/title.sy";
    h.outline.reload();
    old.respond({data: h.headings});
    assert.equal(h.tree.data, null, "a response from before locking cannot repaint the reopened document");
    assert.equal(h.attributes.has("title"), false);
    h.pending.shift().respond({data: []});
    assert.equal(h.attributes.get("title"), "Reopened/title.sy");
    assert.equal(h.hidden.has("fn__none"), false);
});

test("empty mobile editor removes cached outline titles and invalidates pending reloads", () => {
    const h = setup();
    h.outline.reload();
    const old = h.pending.shift();
    h.state.empty = true;
    h.outline.reload();
    old.respond({data: h.headings});
    assert.equal(h.tree.data, null);
    assert.equal(h.title.innerHTML, "");
    assert.equal(h.attributes.has("title"), false);
    assert.equal(h.outline.blockId, "");
});
