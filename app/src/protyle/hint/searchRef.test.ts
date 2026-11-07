import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {setImmediate} from "node:timers/promises";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";

const extend = createSourceFile("extend.ts", readFileSync(join(__dirname, "extend.ts"), "utf8"), ScriptTarget.Latest);
const functions = ["genHintItemHTML", "hintRef"].map(name => extend.statements.find(statement =>
    isVariableStatement(statement) && statement.declarationList.declarations.some(item => item.name.getText(extend) === name))
    .getText(extend).replace("export ", ""));
const index = createSourceFile("index.ts", readFileSync(join(__dirname, "index.ts"), "utf8"), ScriptTarget.Latest);
const hintClass = index.statements.find(statement => isClassDeclaration(statement) && statement.name.text === "Hint");
assert.ok(hintClass && isClassDeclaration(hintClass));
const searchMethod = hintClass.members.find(member => member.name?.getText(index) === "genSearchHTML").getText(index);
const searchSource = readFileSync(join(__dirname, "searchRef.ts"), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace("export ", "");
const code = transpileModule(`${searchSource}\n${functions.join("\n")}\nclass Hint { ${searchMethod} }\n({hintRef, Hint});`, {
    compilerOptions: {target: ScriptTarget.ES2020},
}).outputText;

const fixture = (pendingCreate = false, hiddenEntries: string[] = [], hideConfiguredCreate = false) => {
    const requests: Array<{callback: (response: unknown) => void, resolve: () => void, reject: (error: Error) => void}> = [];
    const element = {lastElementChild: {innerHTML: ""}, style: {left: "0", right: "0"}};
    const block = {getAttribute: () => "block"};
    let generation = 0;
    let hidden = false;
    const rendered: IHintData[][] = [];
    const api = runInNewContext(code, {
        window: {siyuan: {config: {editor: {}}, languages: {emptyContent: "Empty", ref: "Reference"}}},
        Constants: {ZWSP: "\u200b"},
        getEditorRange: () => ({startContainer: block}), hasClosestBlock: () => block,
        isEncryptedBox: () => false, getDailyNoteHints: async (): Promise<IHintData[]> => [],
        getConfiguredEntryVisibility: (path: string) => !hiddenEntries.includes(path),
        Lute: {Caret: "caret", UnEscapeHTMLStr: (text: string) => text},
        getIconByType: () => "iconFile", unicode2Emoji: () => "icon",
        stripSearchMark: (value: string) => value, escapeSearchHighlight: (value: string) => value,
        escapeHtml: (value: string) => value,
        setPosition() {},
        fetchPost: (_url: string, _params: unknown, callback: (response: unknown) => void) =>
            new Promise<void>((resolve, reject) => requests.push({callback, resolve, reject})),
    });
    const hint = new api.Hint();
    Object.assign(hint, {
        element, splitChar: "((",
        prepareCreateTarget: () => {
            const current = ++generation;
            return {promise: pendingCreate ? new Promise(() => {}) : Promise.resolve(hideConfiguredCreate),
                isCurrent: () => current === generation && !hidden};
        },
        genLoading() { hidden = false; element.lastElementChild.innerHTML = "loading"; },
        genHTML(data: IHintData[]) {
            rendered.push(data);
            hidden = data.length === 0;
            element.lastElementChild.innerHTML = hidden ? "hidden" : "results";
        },
    });
    const protyle = {notebookId: "box", element: {clientWidth: 320}, block: {rootID: "root"},
        toolbar: {range: {startContainer: block}}, wysiwyg: {element: {}}, hint};
    return {requests, element, rendered,
        start(source = "hint", searchInput = false) {
            if (searchInput) {
                hint.genSearchHTML(protyle, {value: ""}, block, "Original anchor", source);
            } else {
                api.hintRef("", protyle, source);
            }
        },
        async respond(response: unknown, request = 0, callback = true) {
            if (callback) {
                requests[request].callback(response);
            }
            requests[request].resolve();
            await setImmediate();
        },
    };
};

for (const source of ["hint", "search", "av"]) {
    test(`${source} reference loading ends on empty, invalid, rejected and discarded responses`, async () => {
        for (const searchInput of source === "hint" ? [false] : [false, true]) {
            for (const response of ["", undefined, {code: -1, data: null}, {code: 0, data: {reqId: 1}},
                {code: 0, data: {blocks: "invalid"}}, new Error("network")]) {
                const f = fixture(true);
                f.start(source, searchInput);
                if (response instanceof Error) {
                    f.requests[0].reject(response);
                    await setImmediate();
                } else {
                    await f.respond(response, 0, response !== undefined);
                }
                assert.equal(f.element.lastElementChild.innerHTML, "hidden");
            }
        }
    });

    test(`${source} reference search accepts empty candidates and ignores obsolete failures`, async () => {
        for (const searchInput of source === "hint" ? [false] : [false, true]) {
            const emptyCandidates: Array<null[] | null> = [[], null, [null]];
            for (const blocks of emptyCandidates) {
                const f = fixture();
                f.start(source, searchInput);
                await f.respond({code: 0, data: {k: "", newDoc: false, blocks}});
                assert.equal(f.element.lastElementChild.innerHTML.includes("loading"), false);
                assert.notEqual(f.element.lastElementChild.innerHTML, "hidden");
            }
            const f = fixture();
            f.start(source, searchInput);
            f.start(source, searchInput);
            await f.respond({code: 0, data: {k: "", newDoc: false, blocks: []}}, 1);
            const current = f.element.lastElementChild.innerHTML;
            await f.respond("", 0);
            assert.equal(f.element.lastElementChild.innerHTML, current);
        }
    });
}

test("a failing reference request can be followed by a successful query without resetting the editor", async () => {
    const f = fixture();
    f.start();
    await f.respond("");
    f.start();
    await f.respond({code: 0, data: {k: "", newDoc: false, blocks: [{id: "target", type: "NodeDocument",
        refText: "Target", name: "", ial: {}, content: "Target", hPath: "/"}]}}, 1);
    assert.equal(f.element.lastElementChild.innerHTML, "results");
    assert.match(f.rendered.at(-1)[0].value, /data-id="target" data-subtype="d"/);
});

for (const source of ["hint", "search", "av"]) {
    test(`${source} reference creation respects independent visibility and retains existing result focus`, async () => {
        for (const searchInput of source === "hint" ? [false] : [false, true]) {
            for (const hideConfigured of [false, true]) {
                for (const showSubDoc of [false, true]) {
                    for (const showAtPath of [false, true]) {
                        for (const hasResult of [false, true]) {
                            const hiddenEntries = [!showSubDoc && "editor.ref.newSubDoc", !showAtPath && "editor.ref.newFileAtPath"]
                                .filter((path): path is string => Boolean(path));
                            const f = fixture(false, hiddenEntries, hideConfigured);
                            f.start(source, searchInput);
                            await f.respond({code: 0, data: {k: "Title", newDoc: true, blocks: hasResult ? [
                                {id: "target", type: "NodeDocument", refText: "Target", name: "", ial: {}, content: "Target", hPath: "/"},
                            ] : []}});
                            const expected = [!hideConfigured && "newFile", showSubDoc && "newSubDoc", showAtPath && "newFileAtPath"]
                                .filter(Boolean).map(command => "((" + command + " ");
                            if (searchInput) {
                                const buttons = Array.from(f.element.lastElementChild.innerHTML.matchAll(/class="([^"]*)" data-value="([^"]*)"/g),
                                    match => ({focused: match[1].includes("b3-list-item--focus"), value: decodeURIComponent(match[2])}));
                                assert.deepEqual(buttons.filter(item => item.value.startsWith("((")).map(item => item.value.split('"')[0]), expected);
                                const focused = buttons.filter(item => item.focused);
                                assert.equal(focused.length, hasResult || expected.length ? 1 : 0);
                                if (hasResult) {
                                    assert.match(focused[0].value, /data-id="target"/);
                                } else if (expected.length) {
                                    assert.ok(focused[0].value.startsWith(expected[0]));
                                } else {
                                    assert.match(f.element.lastElementChild.innerHTML, /Empty/);
                                }
                            } else {
                                const data = f.rendered.at(-1);
                                assert.ok(data);
                                assert.deepEqual(Array.from(data.filter(item => item.value.startsWith("((")), item => item.value.split('"')[0]), expected);
                                if (hasResult) {
                                    const result = data.find(item => item.value.includes('data-id="target"'));
                                    assert.ok(result);
                                    assert.equal(result.focus === true, expected.length > 0);
                                } else if (expected.length === 0) {
                                    assert.equal(data.length, 1);
                                    assert.equal(data[0].value, "");
                                }
                            }
                        }
                    }
                }
            }
        }
    });
}
