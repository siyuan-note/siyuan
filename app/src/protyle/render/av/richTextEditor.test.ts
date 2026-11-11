import * as assert from "node:assert/strict";
import {describe, it} from "node:test";
import {ScriptTarget} from "typescript";
import {loadModule} from "../../../testSupport/loadModule";

const continuous = loadModule<typeof import("./continuousInput")>("src/protyle/render/av/continuousInput.ts", {require: () => ({})});

const createEditorFixture = (settings: {primary?: boolean; mobile?: boolean; changed?: boolean; flush?: () => Promise<void>; save?: () => Promise<void>;
    tableInput?: boolean; rangeInput?: boolean; hint?: boolean} = {}) => {
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
    const bodyTarget = {};
    const toolbarTarget = {};
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
        wysiwyg: {contains: (target: unknown) => target === bodyTarget},
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
        prepareNextInput: (_anchor: unknown, rangeOnly = false) =>
            (rangeOnly ? settings.rangeInput : settings.tableInput) ? () => lifecycle.push("next") : undefined,
    };
    let currentValue = options.value;
    let fragmentOptions: Parameters<typeof import("../../lite/fragmentEditor").mountProtyleLiteFragment>[1];
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
        "../../lite/fragmentEditor": {mountProtyleLiteFragment: (_host: unknown, options: typeof fragmentOptions) => {
            fragmentOptions = options;
            return fragment;
        }},
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
            execCommand: (command: string) => {
                assert.equal(command, "insertLineBreak");
                lifecycle.push("line-break");
            },
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
        methods, lifecycle, owner, node, open, fragmentOptions, toolbarTarget,
        rebind: () => { currentValue = {type: "block", isDetached: false, block: {content: "other"}}; },
        cancel: () => masks.at(-1).handlers.get("siyuan-av-cell-editor-close")({}),
        get inert() { return masks.at(-1).firstElementChild.inert; },
        confirm: () => masks.at(-1).firstElementChild.handlers.get("click")?.({}),
        enter: (options: Partial<KeyboardEvent> = {}) => masks.at(-1).firstElementChild.handlers.get("keydown")({
            key: "Enter", target: bodyTarget,
            preventDefault: () => lifecycle.push("prevent"), stopPropagation: () => lifecycle.push("stop"), ...options,
        }),
        softKeyboardEnter: (options: Partial<InputEvent> = {}) => masks.at(-1).firstElementChild.handlers.get("beforeinput")({
            inputType: "insertParagraph", cancelable: true, target: bodyTarget,
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

[false, true].forEach(primary => describe(`database ${primary ? "primary" : "text"} rich editor lifecycle and keyboard input`, () => {
    const createEditor = (settings: Parameters<typeof createEditorFixture>[0] = {}) => createEditorFixture({...settings, primary});
    for (const mobile of [false, true]) {
        it(`only primary fields prevent blank-click paragraph insertion (${mobile ? "mobile" : "desktop"})`, () => {
            const editor = createEditor({mobile});
            assert.equal(editor.fragmentOptions.protyleOptions.click.preventInsetEmptyBlock, primary);
        });
    }
    for (const mobile of [false, true]) {
        it(`waits for a successful ${primary ? "continuous" : "explicit"} save (${mobile ? "mobile" : "desktop"})`, async () => {
            let complete: () => void;
            const saving = new Promise<void>(resolve => complete = resolve);
            const editor = createEditor({mobile, changed: true, tableInput: true, save: () => saving});
            editor.enter();
            editor.enter();
            await editor.settle();
            if (!primary) {
                assert.deepEqual(editor.lifecycle, []);
                editor.escape();
                await editor.settle();
            }
            assert.equal(editor.lifecycle.filter(item => item === "save").length, 1);
            assert.equal(editor.lifecycle.includes("next"), false);
            complete();
            await editor.settle();
            assert.equal(editor.lifecycle.filter(item => item === "next").length, primary ? 1 : 0);
            if (primary) assert.ok(editor.lifecycle.indexOf("next") > editor.lifecycle.indexOf("destroy"));
        });
        it(`retains failed drafts and does not navigate after invalidation (${mobile ? "mobile" : "desktop"})`, async () => {
            let fail = true;
            const editor = createEditor({mobile, changed: true, tableInput: true, save: async () => {
                if (fail) throw new Error("failed");
            }});
            editor.enter();
            if (!primary) editor.escape();
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
    it("keeps primary Enter inline while preserving text blocks, IME confirmation and reference hints", async () => {
        for (const settings of [{}, {tableInput: true, hint: true}]) {
            const editor = createEditor(settings);
            editor.enter();
            await editor.settle();
            if (primary && !settings.hint) {
                assert.ok(editor.lifecycle.includes("destroy"));
                assert.ok(editor.lifecycle.includes("focus"));
            } else {
                assert.deepEqual(editor.lifecycle, []);
            }
        }
        for (const key of ["shiftKey", "ctrlKey", "metaKey", "altKey", "isComposing"]) {
            const editor = createEditor({tableInput: true});
            editor.enter({[key]: true});
            await editor.settle();
            assert.deepEqual(editor.lifecycle, !primary || key === "isComposing" ? [] :
                key === "shiftKey" ? ["prevent", "stop", "line-break"] : ["prevent", "stop"], key);
        }
    });
    if (!primary) {
        for (const mobile of [false, true]) {
            it(`advances a text range only after an explicit successful confirmation (${mobile ? "mobile" : "desktop"})`, async () => {
                let complete: () => void;
                const editor = createEditor({mobile, changed: true, rangeInput: true,
                    save: () => new Promise<void>(resolve => complete = resolve)});
                editor.enter();
                editor.softKeyboardEnter();
                assert.deepEqual(editor.lifecycle, []);
                if (mobile) editor.confirm();
                else editor.enter({ctrlKey: true});
                await editor.settle();
                assert.equal(editor.lifecycle.filter(item => item === "save").length, 1);
                assert.equal(editor.lifecycle.includes("next"), false);
                complete();
                await editor.settle();
                assert.equal(editor.lifecycle.filter(item => item === "next").length, 1);
                assert.ok(editor.lifecycle.indexOf("next") > editor.lifecycle.indexOf("destroy"));
            });
        }
        it("keeps failed range drafts open and ignores IME and unrelated toolbar confirmations", async () => {
            const editor = createEditor({changed: true, rangeInput: true, save: async () => {throw new Error("failed");}});
            editor.enter({ctrlKey: true, isComposing: true});
            editor.enter({ctrlKey: true, keyCode: 229});
            editor.enter({metaKey: true, target: editor.toolbarTarget as EventTarget});
            assert.deepEqual(editor.lifecycle, []);
            editor.enter({metaKey: true});
            await editor.settle();
            assert.equal(editor.lifecycle.includes("next"), false);
            assert.equal(editor.lifecycle.includes("destroy"), false);
            assert.equal(editor.inert, false);
        });
        for (const mobile of [false, true]) {
            it(`leaves paragraph and list Enter events to the text editor (${mobile ? "mobile" : "desktop"})`, async () => {
                const editor = createEditor({mobile, tableInput: true, changed: true});
                editor.enter();
                editor.enter({repeat: true});
                editor.enter({shiftKey: true});
                editor.enter({isComposing: true});
                editor.softKeyboardEnter();
                editor.softKeyboardEnter({isComposing: true});
                editor.softKeyboardEnter({inputType: "insertLineBreak"});
                await editor.settle();
                assert.deepEqual(editor.lifecycle, []);
                assert.equal(editor.inert, false);
                editor.escape();
                await editor.settle();
                assert.equal(editor.lifecycle.filter(item => item === "save").length, 1);
                assert.equal(editor.lifecycle.includes("next"), false);
            });
        }
    }
    if (primary) {
        it("leaves toolbar and inline element input Enter events to their own handlers", async () => {
            for (const mobile of [false, true]) {
                const editor = createEditor({mobile, changed: true});
                const target = editor.toolbarTarget as EventTarget;
                editor.enter({target});
                editor.enter({target, shiftKey: true});
                editor.softKeyboardEnter({target});
                await editor.settle();
                assert.deepEqual(editor.lifecycle, []);
            }
        });
        for (const mobile of [false, true]) {
            it(`saves a primary paragraph without a next-row callback (${mobile ? "mobile" : "desktop"})`, async () => {
                const editor = createEditor({mobile, changed: true});
                editor.softKeyboardEnter();
                await editor.settle();
                assert.equal(editor.lifecycle.filter(item => item === "save").length, 1);
                assert.ok(editor.lifecycle.includes("destroy"));
                assert.equal(editor.lifecycle.includes("next"), false);
            });
        }
    }
    it(`handles held Enter and mobile beforeinput as ${primary ? "confirmation" : "text editing"}`, async () => {
        const held = createEditor({tableInput: true});
        held.enter({repeat: true});
        await held.settle();
        assert.deepEqual(held.lifecycle, primary ? ["prevent", "stop"] : []);
        const mobile = createEditor({mobile: true, tableInput: true, changed: true});
        mobile.softKeyboardEnter({isComposing: true});
        mobile.softKeyboardEnter({inputType: "insertLineBreak"});
        assert.deepEqual(mobile.lifecycle, []);
        mobile.softKeyboardEnter();
        await mobile.settle();
        assert.equal(mobile.lifecycle.includes("next"), primary);
        if (!primary) assert.deepEqual(mobile.lifecycle, []);
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
