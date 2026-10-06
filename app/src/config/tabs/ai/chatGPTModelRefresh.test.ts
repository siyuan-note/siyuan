import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isCallExpression, isIdentifier, ModuleKind, ScriptTarget, transpileModule, type Node as TSNode} from "typescript";

const fixture = (models: Array<{name: string}> = []) => {
    const source = createSourceFile("aiProviderUi.ts", readFileSync("src/config/tabs/ai/aiProviderUi.ts", "utf8"), ScriptTarget.ES2021, true);
    let callback: string;
    const visit = (node: TSNode) => {
        if (isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === "mountChatGPTAccount") {
            callback = node.arguments[2].getText(source);
        }
        forEachChild(node, visit);
    };
    visit(source);
    assert.ok(callback);
    const calls: string[] = [];
    const exports = {} as {update: (ready: boolean, refreshModels: boolean) => void};
    const context = {
        exports, draft: {models}, modelsContainer: {}, fetchingModels: false, chatGPTAccountReady: false,
        availableModels: ["previous-account-model"], availableModelDisplayNames: {previous: "Previous"},
        availableModelContextLengths: {previous: 100}, hasFetchedModels: true,
        updateModelActionButtons: () => {}, renderDraftModels: () => {}, fetchModels: () => calls.push("fetch"),
    };
    runInNewContext(transpileModule("exports.update = " + callback + ";", {compilerOptions: {module: ModuleKind.CommonJS}}).outputText, context);
    return {update: exports.update, context, calls};
};

test("opening account settings does not fetch models, even when the draft is empty", () => {
    for (const models of [[], [{name: "saved-model"}]]) {
        const f = fixture(models);
        f.update(true, false);
        f.update(true, false);
        assert.equal(f.calls.length, 0);
        assert.equal(f.context.draft.models, models);
    }
});

test("a newly authorized account fetches models and clears the previous catalog", () => {
    const f = fixture();
    f.update(true, true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.context.availableModels.length, 0);
    assert.equal(Object.keys(f.context.availableModelDisplayNames).length, 0);
    assert.equal(Object.keys(f.context.availableModelContextLengths).length, 0);
    assert.equal(f.context.hasFetchedModels, false);
});

test("switching to an unauthorized account clears suggestions without fetching", () => {
    const f = fixture();
    f.update(false, true);
    assert.equal(f.calls.length, 0);
    assert.equal(f.context.availableModels.length, 0);
    assert.equal(f.context.chatGPTAccountReady, false);
});

test("account updates do not start a second model request while one is in progress", () => {
    const f = fixture();
    f.context.fetchingModels = true;
    f.update(true, true);
    assert.equal(f.calls.length, 0);
});
