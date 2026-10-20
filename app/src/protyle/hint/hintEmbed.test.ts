import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {setImmediate} from "node:timers/promises";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {getCreateTargetContext, isSameCreateTargetContext} from "./createTargetContext";

const extend = createSourceFile("extend.ts", readFileSync(join(__dirname, "extend.ts"), "utf8"), ScriptTarget.Latest);
const functions = ["genHintItemHTML", "hintEmbed"].map(name => extend.statements.find(statement =>
    isVariableStatement(statement) && statement.declarationList.declarations.some(item => item.name.getText(extend) === name))
    .getText(extend).replace("export ", ""));
const index = createSourceFile("index.ts", readFileSync(join(__dirname, "index.ts"), "utf8"), ScriptTarget.Latest);
const hintClass = index.statements.find(statement => isClassDeclaration(statement) && statement.name.text === "Hint");
assert.ok(hintClass && isClassDeclaration(hintClass));
const members = hintClass.members.filter(member =>
    ["loadingID", "genLoading", "genHTML", "cancelLoadingAnimation", "destroy"].includes(member.name?.getText(index)))
    .map(member => member.getText(index)).join("\n");
const searchSource = readFileSync(join(__dirname, "searchRef.ts"), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace("export ", "");
const code = transpileModule(`${searchSource}\n${functions.join("\n")}\nclass Hint { ${members} }\n({hintEmbed, Hint});`, {
    compilerOptions: {target: ScriptTarget.ES2020},
}).outputText;

const fixture = (encrypted = false, hasBlock = true) => {
    const requests: Array<{params: Record<string, unknown>, callback: (response: unknown) => void,
        resolve: () => void, reject: (error: Error) => void}> = [];
    const classes = new Set(["fn__none"]);
    let html = "";
    let loadingElement: object | undefined;
    const element = {
        isConnected: true,
        classList: {contains: (name: string) => classes.has(name),
            add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name)},
        get innerHTML() { return html; },
        set innerHTML(value: string) { html = value; loadingElement = value.includes("fn__loading") ? {} : undefined; },
        querySelector: (selector: string) => selector === ".fn__loading" ? loadingElement : {},
        contains: (node: object) => !!loadingElement && node === loadingElement,
        insertAdjacentHTML: (_position: string, value: string) => { html += value; loadingElement = {}; },
    };
    const block = {getAttribute: () => "block"};
    const rendered: IHintData[][] = [];
    const api = runInNewContext(code, {
        window: {siyuan: {languages: {emptyContent: "Empty", ref: "Reference"}}},
        getCreateTargetContext, isSameCreateTargetContext,
        getEditorRange: () => ({startContainer: block}), hasClosestBlock: () => hasBlock && block,
        isEncryptedBox: () => encrypted, getIconByType: () => "iconFile", unicode2Emoji: () => "icon",
        getSelectionPosition: () => ({left: 0, top: 0}), setPosition() {}, isAbnormalItem: () => false,
        fetchPost: (url: string, params: Record<string, unknown>, callback: (response: unknown) => void) => {
            assert.equal(url, "/api/search/searchRefBlock");
            return new Promise<void>((resolve, reject) => requests.push({params, callback, resolve, reject}));
        },
    });
    const hint = new api.Hint();
    Object.assign(hint, {
        element, destroyEmojiPanel() {}, bindUploadEvent() {}, setMobilePosition() {},
        getMobileSelectionBounds: () => ({top: 0, bottom: 0}),
        getHTMLByData(data: IHintData[]) { rendered.push(data); return "results"; },
    });
    const protyle = {notebookId: "box", path: "/root.sy", element: {clientWidth: 320},
        block: {rootID: "root", parentID: "parent"}, wysiwyg: {element: {}}, hint};
    return {requests, element, rendered, hint, protyle,
        start(key = "", toolbar = false) {
            const data = api.hintEmbed(key, protyle);
            if (!toolbar) {
                hint.genHTML(data, protyle, false, "hint");
            }
        },
        async respond(response: unknown, request = 0, callback = true) {
            if (response instanceof Error) {
                requests[request].reject(response);
            } else {
                if (callback) {
                    requests[request].callback(response);
                }
                requests[request].resolve();
            }
            await setImmediate();
        },
    };
};

const candidate = {id: "target", type: "NodeDocument", ial: {}, content: "Target", hPath: "/Target"};
const success = (blocks: unknown = [candidate]) => ({code: 0, data: {k: "", newDoc: false, blocks}});

test("embed loading ends on empty, invalid, failed and discarded responses from both entry points", async () => {
    for (const toolbar of [false, true]) {
        for (const response of ["", undefined, null, {code: -1, data: null}, {code: 0, data: {reqId: 1}},
            success("invalid"), {code: 0, data: {blocks: [candidate], newDoc: false}}, new Error("network")]) {
            const f = fixture();
            f.start("", toolbar);
            await f.respond(response, 0, response !== undefined);
            assert.equal(f.element.classList.contains("fn__none"), true);
        }
    }
});

test("embed search shows empty candidates and recovers on the next keyword query", async () => {
    const emptyCandidates: Array<null[] | null> = [[], null, [null]];
    for (const blocks of emptyCandidates) {
        const f = fixture();
        f.start();
        await f.respond(success(blocks));
        assert.equal(f.element.classList.contains("fn__none"), false);
        assert.equal(f.element.querySelector(".fn__loading"), undefined);
        assert.equal(f.rendered[0][0].html, "Empty");
    }
    const f = fixture();
    f.start();
    await f.respond("");
    f.start("Target");
    await f.respond(success(), 1);
    assert.equal(f.requests[1].params.k, "Target");
    assert.equal(f.element.classList.contains("fn__none"), false);
    assert.equal(f.rendered[0][0].value, "{{select * from blocks where id='target'}}");
});

test("embed search preserves block context and encrypted notebook routing", async () => {
    for (const encrypted of [false, true]) {
        for (const hasBlock of [false, true]) {
            const f = fixture(encrypted, hasBlock);
            f.start("Target", true);
            assert.equal(f.requests[0].params.id, hasBlock ? "block" : "parent");
            assert.equal(f.requests[0].params.rootID, "root");
            assert.equal(f.requests[0].params.isDatabase, false);
            assert.equal(f.requests[0].params.notebook, encrypted ? "box" : undefined);
            const response = success([null, candidate]);
            response.data.newDoc = true;
            await f.respond(response);
            assert.equal(f.rendered[0].length, 1);
            assert.equal(f.rendered[0][0].value, "{{select * from blocks where id='target'}}");
        }
    }
});

test("obsolete embed successes and failures leave newer loading and results intact", async () => {
    for (const response of [success(), "", new Error("network"), undefined]) {
        for (const pending of [false, true]) {
            const f = fixture();
            f.start();
            f.start("Target");
            if (!pending) {
                await f.respond(success(), 1);
            }
            const before = f.element.innerHTML;
            await f.respond(response, 0, response !== undefined);
            assert.equal(f.element.innerHTML, before);
            assert.equal(f.element.classList.contains("fn__none"), false);
            if (pending) {
                await f.respond(success(), 1);
            }
            assert.equal(f.rendered.length, 1);
        }
    }
});

test("embed responses do not reopen dismissed panels or update a changed document or panel", async () => {
    for (const change of [
        (f: ReturnType<typeof fixture>) => f.element.classList.add("fn__none"),
        (f: ReturnType<typeof fixture>) => { f.element.isConnected = false; },
        (f: ReturnType<typeof fixture>) => { f.protyle.notebookId = "other"; },
        (f: ReturnType<typeof fixture>) => { f.protyle.path = "/other.sy"; },
        (f: ReturnType<typeof fixture>) => { f.protyle.block.rootID = "other"; },
        (f: ReturnType<typeof fixture>) => f.hint.destroy(),
        (f: ReturnType<typeof fixture>) => f.hint.genHTML([{value: "other", html: "Other"}], f.protyle, true, "hint"),
        (f: ReturnType<typeof fixture>) => f.hint.genLoading(f.protyle, 0, "search"),
    ]) {
        for (const response of [success(), "", new Error("network")]) {
            const f = fixture();
            f.start();
            change(f);
            const before = f.element.innerHTML;
            const count = f.rendered.length;
            await f.respond(response);
            assert.equal(f.element.innerHTML, before);
            assert.equal(f.rendered.length, count);
        }
    }
});

test("embed loading ends when a candidate cannot be rendered", async () => {
    const f = fixture();
    f.start();
    await f.respond(success([{id: "target", type: "NodeDocument"}]));
    assert.equal(f.element.classList.contains("fn__none"), true);
});
