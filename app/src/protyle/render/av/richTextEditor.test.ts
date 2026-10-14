import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {describe, it} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compiled = transpileModule(readFileSync("src/protyle/render/av/richTextEditor.ts", "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2020},
}).outputText;

const createEditor = (settings: {mobile?: boolean; changed?: boolean; flush?: () => Promise<void>} = {}) => {
    const methods = {} as typeof import("./richTextEditor");
    const lifecycle: string[] = [];
    const masks: Array<{
        firstElementChild: ReturnType<typeof createPanel>;
        handlers: Map<string, (event: unknown) => void>;
        dataset: Record<string, string>;
        style: Record<string, string>;
        remove: () => void;
    }> = [];
    const hidden = {classList: {contains: () => true}};
    const owner = {isConnected: true};
    const node = {isConnected: true, dataset: {nodeId: "database-block"}, closest: (): null => null};
    const anchor = {isConnected: true};
    let content = "initial";
    const createPanel = () => ({
        classList: {add: () => {}},
        removeAttribute: () => {},
        querySelector: (selector: string) => selector === ".av__richtext-host" ? {dataset: {}} : null,
        handlers: new Map<string, (event: unknown) => void>(),
        addEventListener(name: string, handler: (event: unknown) => void) {
            this.handlers.set(name, handler);
        },
    });
    const protyle = {
        element: owner,
        block: {rootID: "document"},
        wysiwyg: {element: {contains: (element: unknown) => element === node}},
    };
    const fragment = {
        protyle: {
            block: {},
            wysiwyg: {flushPendingInput: settings.flush || (async () => {})},
            toolbar: {element: hidden, subElement: hidden},
        },
        hintElement: hidden,
        getBlockHTML: () => content,
        focus: () => {},
        destroy: () => lifecycle.push("destroy"),
    };
    const options = {
        protyle,
        nodeElement: node,
        anchorElement: anchor,
        value: {type: "text", text: {content: "initial"}},
        stableCells: [] as import("./selectionState").IAVSelectedCell[],
        onSave: () => lifecycle.push("save"),
        onDestroy: () => lifecycle.push("callback"),
    };
    const modules: Record<string, unknown> = {
        "../../../util/functions": {isMobile: () => settings.mobile || false},
        "../../../util/escape": {escapeHtml: String},
        "../../../mobile/util/mobileAppUtil": {callMobileAppShowKeyboard: () => {}},
        "../../hint/builtinSlash": {registerBuiltinSlashHint: (handler: unknown) => handler},
        "../../lite/fragmentEditor": {mountProtyleLiteFragment: () => fragment},
        "../../toolbar/defaults": {getDefaultToolbar: (): unknown[] => []},
        "./richTextEditorPosition": {positionAVRichTextEditor: () => {}},
        "./editorSession": {beginAVEditorSession: () => () => lifecycle.push("end-session")},
        "../../util/outlineBlock": {updateOutlineCurrentBlock: () => {}},
        "../../util/selection": {focusBlock: (element: unknown) => {
            assert.equal(element, node);
            lifecycle.push("focus");
        }},
        "./richText": {
            getAVTextSource: () => ({kind: "plain", content: "initial"}),
            getAVRichTextLute: () => ({}),
            serializeAVRichTextBlockDOM: (markdown: string) => ({markdown, plainText: markdown}),
            createAVRichTextValue: (markdown: string) => ({type: "text", text: {content: markdown}}),
        },
    };
    runInNewContext(compiled, {
        exports: methods,
        require: (name: string) => modules[name] || {},
        document: {
            body: {appendChild: () => {}},
            createElement: () => {
                const mask = {
                    dataset: {},
                    style: {},
                    firstElementChild: createPanel(),
                    handlers: new Map<string, (event: unknown) => void>(),
                    addEventListener(name: string, handler: (event: unknown) => void) {
                        this.handlers.set(name, handler);
                    },
                    remove: () => lifecycle.push("remove"),
                };
                masks.push(mask);
                return mask;
            },
        },
        window: {
            siyuan: {zIndex: 0, languages: {}},
            addEventListener: () => {},
            removeEventListener: () => {},
        },
        MutationObserver: class {
            observe() {}
            disconnect() {}
        },
    });
    const open = () => methods.openAVRichTextEditor(options as unknown as Parameters<typeof methods.openAVRichTextEditor>[0]);
    open();
    if (settings.changed) {
        content = "updated";
    }
    return {
        methods, lifecycle, owner, node, open,
        escape: () => masks.at(-1).firstElementChild.handlers.get("keydown")({
            key: "Escape",
            preventDefault: () => lifecycle.push("prevent"),
            stopPropagation: () => lifecycle.push("stop"),
        }),
        clickOutside: () => {
            const mask = masks.at(-1);
            mask.handlers.get("mousedown")({target: mask});
        },
        settle: () => new Promise<void>(resolve => setImmediate(resolve)),
    };
};

describe("database rich text editor Escape focus", () => {
    for (const changed of [false, true]) {
        it(`restores database focus after closing ${changed ? "edited" : "unchanged"} text`, async () => {
            const editor = createEditor({changed});
            editor.escape();
            await editor.settle();
            assert.deepEqual(editor.lifecycle, ["prevent", "stop", ...(changed ? ["save"] : []),
                "destroy", "remove", "end-session", "callback", "focus"]);
        });
    }

    it("does not restore desktop focus when closing on mobile or outside the panel", async () => {
        const mobile = createEditor({mobile: true, changed: true});
        mobile.escape();
        await mobile.settle();
        assert.equal(mobile.lifecycle.includes("save"), true);
        assert.equal(mobile.lifecycle.includes("focus"), false);
        const outside = createEditor({changed: true});
        outside.clickOutside();
        await outside.settle();
        assert.equal(outside.lifecycle.includes("save"), true);
        assert.equal(outside.lifecycle.includes("focus"), false);
    });

    it("does not restore focus when the owning document is removed during input flush", async () => {
        let flush: () => void;
        const editor = createEditor({changed: true, flush: () => new Promise<void>(resolve => flush = resolve)});
        editor.escape();
        editor.owner.isConnected = false;
        flush();
        await editor.settle();
        assert.equal(editor.lifecycle.includes("save"), false);
        assert.equal(editor.lifecycle.includes("remove"), true);
        assert.equal(editor.lifecycle.includes("focus"), false);
    });

    it("keeps a newly opened editor focused when Escape is still flushing input", async () => {
        let flush: () => void;
        const editor = createEditor({changed: true, flush: () => new Promise<void>(resolve => flush = resolve)});
        editor.escape();
        editor.open();
        flush();
        await editor.settle();
        assert.equal(editor.lifecycle.includes("save"), false);
        assert.equal(editor.lifecycle.includes("focus"), false);
        editor.methods.destroyAVRichTextEditor();
    });
});
