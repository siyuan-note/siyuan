import * as assert from "node:assert/strict";
import {test} from "node:test";
import {browserSources, runBrowserCase} from "../datePicker/test/browser";

test("AI editor sends a bounded context snapshot with the location of the selected occurrence", async () => {
    const result = await runBrowserCase(async modules => {
        document.body.innerHTML = '<main><div data-type="NodeParagraph" data-node-id="20261122191258-k4cjj1j">' +
            '<div contenteditable="true"></div></div></main>';
        const block = document.querySelector<HTMLElement>("[data-node-id]");
        const editable = block.firstElementChild;
        editable.textContent = "x".repeat(500) + " users {{input}} and users today.";
        const range = document.createRange();
        const start = editable.textContent.lastIndexOf("users");
        range.setStart(editable.firstChild, start);
        range.setEnd(editable.firstChild, start + 5);
        const protyle = {wysiwyg: {element: block.parentElement}, lute: {BlockDOM2StdMd: (s: string) => s}};
        let payload: {input: string, action: string};
        const deps = {
            Constants: {ZWSP: "\u200b", ATTRIBUTE_EDITING: "data-editing"},
            BLOCK_SELECTION_MODE_CLASS: "selected",
            getBlockRanges: () => [{blockElement: block, editableElement: editable, range, start, end: start + 5}],
            fetchAIEditorSSE: (request: typeof payload) => { payload = request; return Promise.resolve(); },
        };
        window.siyuan = {config: {ai: {}}, languages: {}} as typeof window.siyuan;
        const api = new Function("exports", "require", modules.editor + ";return {buildSelectionSource,startTaskStream};")({}, () => deps);
        const source = api.buildSelectionSource(protyle, range, "Polish {{input}}");
        editable.textContent = "subsequent document edit";
        const element = document.createElement("div");
        api.startTaskStream({source, id: "edit", thinkingElement: element, thinkingBody: element, thinkingReasoningElement: element,
            thinkingLatestElement: element, thinkingTextElement: element, body: element, modelElement: element,
            statusElement: element, stopButton: element, actionsElement: element});
        return JSON.stringify(payload);
    }, browserSources({editor: "src/ai/editor.ts"}), "");
    const request = JSON.parse(result);
    assert.equal(request.input, "users");
    const context = JSON.parse(request.action.split("\n")[1]);
    assert.deepEqual(context.locations, [{blockID: "20261122191258-k4cjj1j", startOffset: 521, endOffset: 526}]);
    assert.equal(context.before.length, 400);
    assert.ok(context.before.endsWith(" users {{input}} and "));
    assert.equal(context.after, " today.");
    assert.equal(request.action.match(/\{\{input\}\}/g)?.length, 1);
    assert.ok(request.action.endsWith("Polish {{input}}"));
});
