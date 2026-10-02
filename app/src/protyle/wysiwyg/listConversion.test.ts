import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import * as path from "node:path";
import {test} from "node:test";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import type {Node} from "typescript";

const extract = (name: string) => {
    const source = readFileSync(path.join(__dirname, "transaction.ts"), "utf8");
    const parsed = createSourceFile("transaction.ts", source, ScriptTarget.Latest, true);
    let result: string;
    const visit = (node: Node) => {
        if (isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(parsed) === name)) {
            result = node.getText(parsed);
            return;
        }
        node.forEachChild(visit);
    };
    visit(parsed);
    assert.ok(result, name);
    return transpileModule(result, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
};

const element = (id: string, children: Element[] = []): Element => ({
    getAttribute: (name: string) => name === "data-node-id" ? id : "NodeList",
    contains: (child: Element) => children.includes(child),
} as unknown as Element);

const setup = (success: boolean) => {
    const calls: Array<{type: string, data?: unknown}> = [];
    const selected = element("list");
    const protyle = {id: "session", block: {rootID: "document"}} as IProtyle;
    let pending = Promise.resolve();
    const dependencies = {
        Constants: {SIYUAN_APPID: "app"},
        queueTransaction: (_protyle: IProtyle, task: () => Promise<void>) => {
            calls.push({type: "queue"});
            return pending = pending.then(task);
        },
        fetchSyncPost: async (url: string, data: unknown) => {
            calls.push({type: url, data});
            return success ? {code: 0, data: [{doOperations: [{action: "convertList", retData: {
                rootIDs: ["document"], removedIDs: ["list"], focusID: "paragraph",
            }}]}]} : {code: -1, msg: "ambiguous binding"};
        },
        getEditorTransaction: (data: unknown) => data,
        markMirror: (id: string, data: unknown) => calls.push({type: "mirror", data: {id, data}}),
        hideElements: () => calls.push({type: "hide"}),
        refreshListConversion: (_protyle: IProtyle, result: unknown, focus: boolean) => calls.push({type: "refresh", data: {result, focus}}),
        refreshUndoButtons: () => calls.push({type: "undo"}),
    };
    const convert = new Function(...Object.keys(dependencies), extract("turnListBlocksInto") + "\nreturn turnListBlocksInto;")(
        ...Object.values(dependencies)) as (options: {protyle: IProtyle, type?: string, level?: number, recursively?: boolean, unfocus?: boolean}, selected: Element[]) => Promise<void>;
    return {convert, calls, selected, protyle};
};

test("list conversion submits one authoritative transaction and refreshes only after success", async () => {
    const {convert, calls, selected, protyle} = setup(true);
    const promise = convert({protyle, type: "Blocks2Hs", level: 5}, [selected]);
    assert.deepEqual(calls.map(call => call.type), ["queue"]);
    await promise;
    const request = calls.find(call => call.type === "/api/transactions").data as {
        transactions: Array<{doOperations: IOperation[]}>, session: string,
    };
    assert.equal(request.session, "session");
    assert.equal(request.transactions.length, 1);
    assert.deepEqual(request.transactions[0].doOperations, [{
        action: "convertList", id: "document", blockIDs: ["list"],
        data: {type: "heading", level: 5, recursively: false},
    }]);
    assert.deepEqual(calls.map(call => call.type), ["queue", "/api/transactions", "mirror", "hide", "refresh", "undo"]);
});

test("rejected conversion preserves selection, fold state and undo mirror", async () => {
    const {convert, calls, selected, protyle} = setup(false);
    await convert({protyle, type: "Blocks2Hs", level: 5}, [selected]);
    assert.deepEqual(calls.map(call => call.type), ["queue", "/api/transactions"]);
    assert.equal(protyle.updated, undefined);
});

test("recursive and structure-only conversion deduplicate contained selections", async () => {
    for (const type of [undefined, "Blocks2Ps"]) {
        const {convert, calls, protyle} = setup(true);
        const child = element("child");
        const parent = element("parent", [child]);
        await convert({protyle, type, recursively: true, unfocus: true}, [parent, child]);
        const request = calls.find(call => call.type === "/api/transactions").data as {transactions: Array<{doOperations: IOperation[]}>};
        const operation = request.transactions[0].doOperations[0];
        assert.deepEqual(operation.blockIDs, ["parent"]);
        assert.deepEqual(operation.data, {type: type ? "paragraph" : "remove", level: 0, recursively: true});
        assert.equal((calls.find(call => call.type === "refresh").data as {focus: boolean}).focus, false);
    }
});

test("conversion refresh repairs deleted zoom targets and leaves other views unfocused", () => {
    const calls: string[] = [];
    const protyle = {block: {rootID: "document", id: "list", parentID: "list"}, wysiwyg: {element: {
        querySelector: () => "heading", querySelectorAll: (): Element[] => [],
    }}} as unknown as IProtyle;
    const refresh = new Function("reloadProtyle", "focusBlock", "blockRender", extract("refreshListConversion") + "\nreturn refreshListConversion;")(
        (_protyle: IProtyle, _focus: boolean, _readonly: boolean, callback: () => void) => {calls.push("reload"); callback();},
        () => calls.push("focus"), () => calls.push("embed"));
    refresh(protyle, {rootIDs: ["document"], removedIDs: ["list"], focusID: "paragraph"}, true);
    assert.equal(protyle.block.id, "paragraph");
    assert.equal(protyle.block.parentID, "document");
    assert.deepEqual(calls, ["reload", "focus"]);
    calls.length = 0;
    refresh(protyle, {rootIDs: ["document"], removedIDs: [], focusID: "paragraph"});
    assert.deepEqual(calls, ["reload"]);
});
