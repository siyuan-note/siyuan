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
        const selection = new Function("exports", "require", modules.selection + ";return exports;")({},
            () => ({Constants: {ZWSP: "\u200b"}}));
        const deps = {
            ...selection,
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
            thinkingLatestElement: element, thinkingTextElement: element, body: element,
            statusElement: element, stopButton: element, actionsElement: element});
        return JSON.stringify(payload);
    }, browserSources({editor: "src/ai/editor.ts", selection: "src/ai/selectionMarkdown.ts"}), "");
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

test("AI editor applies panel selections to the current task on desktop and mobile", async () => {
    const result = await runBrowserCase(async modules => {
        const config = {ai: {editing: {modelId: "default-id", reasoningEffort: "high"}}, readonly: true};
        window.siyuan = {config, languages: {}, zIndex: 1} as typeof window.siyuan;
        const {getReasoningEffortOptions} = new Function("exports", modules.effort + ";return exports;")({});
        return JSON.stringify([false, true].map(mobile => {
            document.body.innerHTML = "<main><div></div></main>";
            const element = document.querySelector("main");
            const protyle = {element, wysiwyg: {element: element.firstElementChild}};
            const ids: string[] = [];
            const parts: never[] = [];
            const source = {kind: "selection", ids, parts, input: "sample", action: "Polish {{input}}"};
            const requests: {modelId: string, reasoningEffort: string}[] = [];
            const signals: AbortSignal[] = [];
            let selectModel: (id: string) => void;
            let defaultEffort: () => void;
            const dependencies = {
                genUUID: () => "task-id",
                isMobile: () => mobile,
                escapeHtml: (value: string) => value,
                escapeAriaLabel: (value: string) => value,
                isEncryptedBox: () => false,
                bindThinkingCardToggle: () => {},
                bindEditorPanelPosition: () => ({update() {}, destroy() {}}),
                getReasoningEffortOptions,
                mountGroupedModelPicker: (root: HTMLElement, group: string, options: {onSelect: typeof selectModel}) => {
                    if (group === "editing" && root.querySelector('[data-group="editing"]')) {
                        selectModel = options.onSelect;
                    }
                },
                toggleMenu: ({build}: {build: (menu: unknown, session: unknown) => void}) => build(null, {show() {}}),
                Menu: class {
                    addItem({label, click}: {label: string, click: () => void}) {
                        if (label === "Default") {
                            defaultEffort = click;
                        }
                    }
                },
                fetchAIEditorSSE: (request: typeof requests[number], _onEvent: unknown, signal: AbortSignal) => {
                    requests.push(request);
                    signals.push(signal);
                    return Promise.resolve();
                },
            };
            const {createTask, startTaskStream, cleanupTask} = new Function("exports", "require", modules.editor +
                ";return {createTask,startTaskStream,cleanupTask};")({}, () => dependencies);
            const task = createTask(protyle, source);
            startTaskStream(task);
            selectModel("other-id");
            task.panel.querySelector('[data-type="reasoningEffort"]').click();
            defaultEffort();
            cleanupTask(task);
            const next = createTask(protyle, source);
            startTaskStream(next);
            const states = signals.map(signal => signal.aborted);
            cleanupTask(next);
            return {options: requests.map(({modelId, reasoningEffort}) => [modelId, reasoningEffort]), states};
        }));
    }, browserSources({editor: "src/ai/editor.ts", effort: "src/ai/reasoningEffort.ts"}), "");
    const expected = {
        options: [["default-id", "high"], ["other-id", "high"], ["other-id", ""], ["default-id", "high"]],
        states: [true, true, true, false],
    };
    assert.deepEqual(JSON.parse(result), [expected, expected]);
});

test("AI insertion identifies generated blocks and leaves the continuation prompt unmarked", async () => {
    const result = await runBrowserCase(async modules => {
        const attr = "custom-sy-ai-source";
        const dependencies = {
            Constants: {CUSTOM_SY_AI_SOURCE: attr},
            hasClosestByAttribute: () => false,
            hasClosestByTag: () => false,
        };
        const {getInsertHTML} = new Function("exports", "require", modules.editor +
            ";return {getInsertHTML};")({}, () => dependencies);
        const task = {
            protyle: {lute: {Md2BlockDOM: (text: string) =>
                `<div data-node-id="${text}" data-type="NodeParagraph">${text}</div>`}},
            source: {kind: "writing", input: "original"},
        };
        const template = document.createElement("template");
        const sources = (source: "editor" | "agent") => {
            template.innerHTML = getInsertHTML(task, document.createRange(), "generated", source).html;
            return Array.from(template.content.children, block => [block.textContent, block.getAttribute(attr)]);
        };
        return JSON.stringify([sources("editor"), sources("agent")]);
    }, browserSources({editor: "src/ai/editor.ts"}));
    assert.deepEqual(JSON.parse(result), [[["original", null], ["generated", "editor"]], [["generated", "agent"]]]);
});
