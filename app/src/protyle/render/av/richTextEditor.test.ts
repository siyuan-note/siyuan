import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../../testSupport/loadModule";

const continuous = loadModule<typeof import("./continuousInput")>("src/protyle/render/av/continuousInput.ts", {require: () => ({})});

const createEditorFixture = (settings: {primary?: boolean; mobile?: boolean; changed?: boolean; flush?: () => Promise<void>; save?: () => Promise<void>;
    tableInput?: boolean; hint?: boolean} = {}) => {
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
        inert: false,
        classList: {add: () => {}},
        removeAttribute: () => {},
        querySelector: (selector: string) => selector === ".av__richtext-host" ? {dataset: {}} : null,
        handlers: new Map<string, (event: unknown) => void>(),
        addEventListener(name: string, handler: (event: unknown) => void) {
            this.handlers.set(name, handler);
        },
    });
    const protyle = {
        options: {},
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
        hintElement: {classList: {contains: () => !settings.hint}},
        getBlockHTML: () => content,
        focus: () => {},
        destroy: () => lifecycle.push("destroy"),
    };
    const options = {
        protyle,
        nodeElement: node,
        anchorElement: anchor,
        value: settings.primary ? {type: "block", isDetached: true, block: {content: "initial"}} :
            {type: "text", text: {content: "initial"}},
        stableCells: [] as import("./selectionState").IAVSelectedCell[],
        onSave: () => { lifecycle.push("save"); return settings.save?.(); },
        onDestroy: () => lifecycle.push("callback"),
        prepareNextInput: () => settings.tableInput ? () => lifecycle.push("next") : undefined,
    };
    let currentValue = options.value;
    if (settings.primary) {
        options.stableCells.push({rowID: "row", colID: "primary"} as import("./selectionState").IAVSelectedCell);
    }
    const modules: Record<string, unknown> = {
        "./continuousInput": continuous,
        "./host": {getAVHostIdentity: (element: typeof node) => element.dataset.nodeId,
            getAVHostBlockID: (element: typeof node) => element.dataset.nodeId},
        "./cellEditor": {AV_CELL_EDITOR_CLOSE_EVENT: "siyuan-av-cell-editor-close"},
        "../../../dialog/message": {showMessage: () => lifecycle.push("save-error")},
        "../../../dialog/mobileDialog": {MobileDialog: class {
            element: unknown;
            private closed = false;
            private pending = false;
            constructor(private settings: {mobileSheet: {beforeClose: () => Promise<boolean>}; destroyCallback: () => void}) {
                const panel = createPanel();
                const mask = {firstElementChild: panel, handlers: new Map<string, (event: unknown) => void>(),
                    dataset: {}, style: {}, remove: () => lifecycle.push("remove"),
                    querySelector: () => panel,
                    addEventListener(name: string, handler: (event: unknown) => void) { this.handlers.set(name, handler); }};
                masks.push(mask);
                this.element = mask;
            }
            async requestClose() {
                if (this.closed || this.pending) return false;
                this.pending = true;
                try {
                    if (await this.settings.mobileSheet.beforeClose()) this.invalidate();
                } catch {
                    lifecycle.push("save-error");
                } finally {
                    this.pending = false;
                }
                return this.closed;
            }
            invalidate() {
                if (this.closed) return;
                this.closed = true;
                this.settings.destroyCallback();
            }
            focusWhenReady() {}
        }},
        "../../../util/functions": {isMobile: () => settings.mobile || false},
        "../../../util/escape": {escapeHtml: String},
        "../../../mobile/util/mobileAppUtil": {callMobileAppShowKeyboard: () => {}},
        "../../hint/builtinSlash": {registerBuiltinSlashHint: (handler: unknown) => handler},
        "../../lite/fragmentEditor": {mountProtyleLiteFragment: () => fragment},
        "../../toolbar/defaults": {getDefaultToolbar: (): unknown[] => []},
        "./richTextEditorPosition": {positionAVRichTextEditor: () => {}},
        "./richTextEditorLute": {createAVRichTextEditorLute: () => ({}), configureAVRichTextEditorLute: () => {}},
        "../../header/documentTitleDOM": {getDocumentTitleLute: (lute: unknown) => lute,
            getDocumentTitleDOMFingerprint: (html: string) => html},
        "./primaryRich": {getAVPrimaryInitialDOM: () => "initial",
            createAVPrimaryEditValue: (html: string) => ({type: "block", isDetached: true, block: {content: html}})},
        "./virtualScroll": {getAVData: () => settings.primary ? {} : undefined},
        "./selectionState": {resolveAVSelectedCell: () => ({cell: {value: currentValue}, column: {type: currentValue.type}})},
        "./editorSession": {beginAVEditorSession: () => () => lifecycle.push("end-session")},
        "../../util/outlineBlock": {updateOutlineCurrentBlock: () => {}},
        "../../util/selection": {focusBlock: (element: unknown) => {
            assert.equal(element, node);
            lifecycle.push("focus");
        }},
        "./richText": {
            getAVTextSource: () => ({kind: "plain", content: "initial"}),
            serializeAVRichTextBlockDOM: (markdown: string) => ({markdown, plainText: markdown}),
            createAVRichTextValue: (markdown: string) => ({type: "text", text: {content: markdown}}),
        },
    };
    const methods = loadModule<typeof import("./richTextEditor")>("src/protyle/render/av/richTextEditor.ts", {
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
            siyuan: {zIndex: 0, languages: {}, config: {}},
            addEventListener: () => {},
            removeEventListener: () => {},
        },
        MutationObserver: class {
            observe() {}
            disconnect() {}
        },
    }, ScriptTarget.ES2020);
    const open = () => methods.openAVRichTextEditor(options as unknown as Parameters<typeof methods.openAVRichTextEditor>[0]);
    open();
    if (settings.changed) {
        content = "updated";
    }
    return {
        methods, lifecycle, owner, node, open,
        rebind: () => { currentValue = {type: "block", isDetached: false, block: {content: "other"}}; },
        cancel: () => masks.at(-1).handlers.get("siyuan-av-cell-editor-close")({}),
        get inert() { return masks.at(-1).firstElementChild.inert; },
        enter: (options: Partial<KeyboardEvent> = {}) => masks.at(-1).firstElementChild.handlers.get("keydown")({
            key: "Enter", preventDefault: () => lifecycle.push("prevent"), stopPropagation: () => lifecycle.push("stop"), ...options,
        }),
        softKeyboardEnter: (options: Partial<InputEvent> = {}) => masks.at(-1).firstElementChild.handlers.get("beforeinput")({
            inputType: "insertParagraph", cancelable: true,
            preventDefault: () => lifecycle.push("prevent"), stopPropagation: () => lifecycle.push("stop"), ...options,
        }),
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

[false, true].forEach(primary => describe(`database ${primary ? "primary" : "text"} rich editor lifecycle and continuous input`, () => {
    const createEditor = (settings: Parameters<typeof createEditorFixture>[0] = {}) => createEditorFixture({...settings, primary});
    for (const mobile of [false, true]) {
        it(`waits for a successful save before continuing input (${mobile ? "mobile" : "desktop"})`, async () => {
            let complete: () => void;
            const saving = new Promise<void>(resolve => complete = resolve);
            const editor = createEditor({mobile, changed: true, tableInput: true, save: () => saving});
            editor.enter();
            editor.enter();
            await editor.settle();
            assert.equal(editor.lifecycle.filter(item => item === "save").length, 1);
            assert.equal(editor.lifecycle.includes("next"), false);
            complete();
            await editor.settle();
            assert.equal(editor.lifecycle.filter(item => item === "next").length, 1);
            assert.ok(editor.lifecycle.indexOf("next") > editor.lifecycle.indexOf("destroy"));
        });
        it(`retains failed drafts and does not navigate after invalidation (${mobile ? "mobile" : "desktop"})`, async () => {
            let fail = true;
            const editor = createEditor({mobile, changed: true, tableInput: true, save: async () => {
                if (fail) throw new Error("failed");
            }});
            editor.enter();
            await editor.settle();
            assert.equal(editor.lifecycle.includes("next"), false);
            assert.equal(editor.lifecycle.includes("destroy"), false);
            assert.equal(editor.inert, false);
            fail = false;
            editor.cancel();
            editor.enter();
            await editor.settle();
            assert.equal(editor.lifecycle.includes("next"), false);
        });
    }
    it("preserves rich text Enter outside table inputs, soft breaks, IME confirmation and reference hints", async () => {
        for (const settings of [{}, {tableInput: true, hint: true}]) {
            const editor = createEditor(settings);
            editor.enter();
            await editor.settle();
            assert.deepEqual(editor.lifecycle, []);
        }
        for (const key of ["shiftKey", "ctrlKey", "metaKey", "altKey", "isComposing"]) {
            const editor = createEditor({tableInput: true});
            editor.enter({[key]: true});
            await editor.settle();
            assert.deepEqual(editor.lifecycle, [], key);
        }
    });
    it("consumes held Enter without saving another cell and supports mobile beforeinput confirmation", async () => {
        const held = createEditor({tableInput: true});
        held.enter({repeat: true});
        await held.settle();
        assert.deepEqual(held.lifecycle, ["prevent", "stop"]);
        const mobile = createEditor({mobile: true, tableInput: true, changed: true});
        mobile.softKeyboardEnter({isComposing: true});
        mobile.softKeyboardEnter({inputType: "insertLineBreak"});
        assert.deepEqual(mobile.lifecycle, []);
        mobile.softKeyboardEnter();
        await mobile.settle();
        assert.equal(mobile.lifecycle.includes("next"), true);
    });
    for (const mobile of [false, true]) {
        it(`cancels owned ${mobile ? "mobile" : "desktop"} rich text immediately without saving its draft`, async () => {
            const editor = createEditor({mobile, changed: true});
            editor.cancel();
            await editor.settle();
            assert.equal(editor.lifecycle.includes("save"), false);
            assert.equal(editor.lifecycle.filter(item => item === "destroy").length, 1);
            assert.equal(editor.lifecycle.filter(item => item === "end-session").length, 1);
        });
    }
    it("keeps the mobile draft after a failed save and allows an explicit retry", async () => {
        let fail = true;
        const editor = createEditor({mobile: true, changed: true, save: async () => {
            if (fail) throw new Error("save failed");
        }});
        editor.escape();
        await editor.settle();
        assert.equal(editor.lifecycle.includes("save-error"), true);
        assert.equal(editor.lifecycle.includes("destroy"), false);
        assert.equal(editor.inert, false);
        fail = false;
        editor.escape();
        await editor.settle();
        assert.equal(editor.lifecycle.filter(item => item === "save").length, 2);
        assert.equal(editor.lifecycle.filter(item => item === "destroy").length, 1);
    });

    it("locks mobile editing throughout an asynchronous save and its close", async () => {
        let resolveSave: () => void;
        const editor = createEditor({mobile: true, changed: true,
            save: () => new Promise<void>(resolve => resolveSave = resolve)});
        editor.escape();
        assert.equal(editor.inert, true);
        await editor.settle();
        assert.equal(editor.inert, true);
        resolveSave();
        await editor.settle();
        assert.equal(editor.inert, true);
        assert.equal(editor.lifecycle.filter(item => item === "destroy").length, 1);
    });

    it("deduplicates mobile save requests and invalidates immediately during a pending flush", async () => {
        let flush: () => void;
        const editor = createEditor({mobile: true, changed: true,
            flush: () => new Promise<void>(resolve => flush = resolve)});
        editor.escape();
        editor.escape();
        editor.methods.destroyAVRichTextEditor(false);
        assert.equal(editor.lifecycle.filter(item => item === "destroy").length, 1);
        flush();
        await editor.settle();
        assert.equal(editor.lifecycle.includes("save"), false);
        assert.equal(editor.lifecycle.filter(item => item === "callback").length, 1);
    });

    it("keeps the desktop draft after a failed save and retries without destroying the editor", async () => {
        let fail = true;
        const editor = createEditor({changed: true, save: async () => {
            if (fail) throw new Error("save failed");
        }});
        editor.clickOutside();
        await editor.settle();
        assert.equal(editor.lifecycle.includes("save-error"), true);
        assert.equal(editor.lifecycle.includes("destroy"), false);
        fail = false;
        editor.clickOutside();
        await editor.settle();
        assert.equal(editor.lifecycle.filter(item => item === "save").length, 2);
        assert.equal(editor.lifecycle.filter(item => item === "destroy").length, 1);
    });

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
    if (primary) {
        for (const mobile of [false, true]) {
            it(`drops a late primary save after rebinding (${mobile ? "mobile" : "desktop"})`, async () => {
                let flush: () => void;
                const editor = createEditor({mobile, changed: true, flush: () => new Promise<void>(resolve => flush = resolve)});
                editor.escape();
                editor.rebind();
                flush();
                await editor.settle();
                assert.equal(editor.lifecycle.includes("save"), false);
                assert.equal(editor.lifecycle.includes("destroy"), true);
                assert.equal(editor.lifecycle.includes("focus"), false);
            });
        }
    }
}));
