import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (file: string) => transpileModule(readFileSync(`src/protyle/${file}.ts`, "utf8"), {
    compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
}).outputText;
const restoreSource = compile("gutter/restore");
const resizeSource = compile("util/resize");

class TestElement {
    public nodeType = 1;
    public isConnected = true;
    public visible = true;
    public selected: TestElement[] = [];
    public classes = new Set<string>();
    public classList = {contains: (name: string) => this.classes.has(name)};
    public top = 10;
    public bottom = 40;
    public ownerDocument: any;
    public embed?: TestElement;
    public embedContext = false;

    constructor(public parentElement?: TestElement, public block = false, public editor = false) {
    }

    public contains(element: TestElement): boolean {
        return !!element && (element === this || this.contains(element.parentElement));
    }

    public closest(): TestElement | null {
        return this.editor ? this : this.parentElement?.closest() || null;
    }

    public querySelectorAll(selector: string) {
        return selector === ".protyle-wysiwyg--select" ? this.selected : [];
    }

    public querySelector(): null {
        return null;
    }

    public getClientRects() {
        return this.visible ? [this.getBoundingClientRect()] : [];
    }

    public getBoundingClientRect() {
        return {top: this.top, bottom: this.bottom};
    }
}

const fixture = () => {
    const root = new TestElement(undefined, false, true);
    const blocks = [new TestElement(root, true), new TestElement(root, true), new TestElement(root, true)];
    const editable = blocks.map(block => new TestElement(block));
    const selection = {focusNode: editable[0]};
    const ownerDocument = {body: new TestElement(), activeElement: editable[0], getSelection: () => selection};
    root.ownerDocument = ownerDocument;
    let phablet = true;
    let mobile = false;
    let multiSelect = false;
    let rendered: TestElement | undefined;
    const calls: TestElement[] = [];
    const frames: FrameRequestCallback[] = [];
    const timers: Array<() => void> = [];
    const protyle: any = {
        wysiwyg: {element: root},
        gutter: {render: (_protyle: unknown, block: TestElement) => {
            rendered = block;
            calls.push(block);
        }},
        options: {render: {gutter: true}},
        toolbar: {isMultiSelectMode: () => multiSelect},
        contentElement: {getBoundingClientRect: () => ({top: 0, bottom: 100})},
    };
    const modules: Record<string, unknown> = {
        "../util/compatibility": {isPhablet: () => phablet},
        "../../util/functions": {isMobile: () => mobile},
        "../util/hasClosest": {
            hasClosestBlock: (element: TestElement) => {
                while (element && !element.block) {
                    element = element.parentElement;
                }
                return element;
            },
            isInEmbedBlock: (element: TestElement) => element.embed,
        },
        "../wysiwyg/blockSelection": {BLOCK_SELECTION_CLASS: "protyle-wysiwyg--select"},
        "../wysiwyg/getBlock": {getEmbedGutterOperationContext: (block: TestElement) => block.embedContext},
        "../ui/hideElements": {hideElements: (): void => { rendered = undefined; }},
        "../ui/initUI": {setPadding: () => ({width: 0})},
        "../../constants": {Constants: {TIMEOUT_TRANSITION: 300}},
    };
    const globals = {
        require: (name: string) => modules[name], Node: {ELEMENT_NODE: 1}, window: {},
        requestAnimationFrame: (callback: FrameRequestCallback) => frames.push(callback),
        setTimeout: (callback: () => void) => timers.push(callback),
    };
    const restoreExports: any = {};
    runInNewContext(restoreSource, {...globals, exports: restoreExports});
    modules["../gutter/restore"] = restoreExports;
    const resizeExports: any = {};
    runInNewContext(resizeSource, {...globals, exports: resizeExports});
    return {
        root, blocks, editable, selection, ownerDocument, protyle, calls,
        render: (selectedElement?: TestElement) => restoreExports.restoreGutterBySelection(protyle, selectedElement),
        restore: restoreExports.restoreGutterBySelection,
        resize: () => resizeExports.resize(protyle),
        clearGutter: (): void => { rendered = undefined; },
        rendered: () => rendered,
        flushTimers: () => timers.splice(0).forEach(callback => callback()),
        flushFrames: () => frames.splice(0).forEach(callback => callback(0)),
        setMultiSelect: () => multiSelect = true,
        setDesktop: () => phablet = false,
        setMobile: () => mobile = true,
    };
};

test("keyboard resize restores the latest caret after layout and scroll cleanup", () => {
    const f = fixture();
    f.render();
    f.resize();
    assert.equal(f.rendered(), undefined);
    f.selection.focusNode = f.editable[1];
    f.ownerDocument.activeElement = f.editable[1];
    f.flushTimers();
    f.clearGutter();
    f.flushFrames();
    assert.equal(f.rendered(), f.blocks[1]);
    f.resize();
    f.flushTimers();
    f.flushFrames();
    assert.equal(f.rendered(), f.blocks[1], "keyboard dismissal also restores the current block");
});

test("block selection restores a visible selected block even when the caret is outside the selection", () => {
    const f = fixture();
    f.root.selected = [f.blocks[0], f.blocks[1]];
    f.selection.focusNode = f.editable[1];
    f.render();
    assert.equal(f.rendered(), f.blocks[1]);
    f.selection.focusNode = f.editable[2];
    f.blocks[0].bottom = -1;
    f.render();
    assert.equal(f.rendered(), f.blocks[1]);
    f.blocks[1].visible = false;
    f.clearGutter();
    f.render();
    assert.equal(f.rendered(), undefined);
});

test("pending restoration leaves another editor, a nested editor, and dialog inputs alone", () => {
    const f = fixture();
    for (const active of [new TestElement(undefined, false, true), new TestElement(f.root, false, true),
        new TestElement()]) {
        f.resize();
        f.flushTimers();
        f.ownerDocument.activeElement = active;
        f.flushFrames();
        assert.equal(f.rendered(), undefined);
    }
});

test("padding selection ending below the document restores its gutter without a native range", () => {
    const f = fixture();
    f.root.selected = [f.blocks[0], f.blocks[1]];
    f.selection.focusNode = undefined;
    f.ownerDocument.activeElement = f.ownerDocument.body;
    f.render(f.blocks[0]);
    assert.equal(f.rendered(), f.blocks[0]);
    f.clearGutter();
    f.selection.focusNode = new TestElement();
    f.render(f.blocks[0]);
    assert.equal(f.rendered(), undefined, "another selection takes precedence over the completed drag");
    f.selection.focusNode = undefined;
    f.root.selected = [];
    f.render(f.blocks[0]);
    assert.equal(f.rendered(), undefined, "a cleared selection must not be resurrected");
});

test("keyboard dismissal can leave focus on body while retaining this editor's selection", () => {
    const f = fixture();
    f.ownerDocument.activeElement = f.ownerDocument.body;
    f.render();
    assert.equal(f.rendered(), f.blocks[0]);
    f.clearGutter();
    f.selection.focusNode = new TestElement();
    f.render();
    assert.equal(f.rendered(), undefined);
});

test("keyboard resize retains the completed block selection after the native caret is cleared", () => {
    const f = fixture();
    f.root.selected = [f.blocks[0], f.blocks[1]];
    f.selection.focusNode = undefined;
    f.ownerDocument.activeElement = f.ownerDocument.body;
    f.render(f.blocks[0]);
    f.resize();
    f.flushTimers();
    f.flushFrames();
    assert.equal(f.rendered(), f.blocks[0]);
    f.blocks[0].bottom = -1;
    f.resize();
    f.flushTimers();
    f.flushFrames();
    assert.equal(f.rendered(), f.blocks[1], "the visible selection supplies the gutter after another layout change");
});

test("native caret removal after a completed selection retains only the current editor's gutter", () => {
    const f = fixture();
    f.root.selected = [f.blocks[0], f.blocks[1]];
    f.render();
    f.selection.focusNode = undefined;
    f.ownerDocument.activeElement = f.ownerDocument.body;
    f.clearGutter();
    f.render();
    assert.equal(f.rendered(), f.blocks[0]);

    const peerRoot = new TestElement(undefined, false, true);
    peerRoot.ownerDocument = f.ownerDocument;
    const peerBlock = new TestElement(peerRoot, true);
    peerRoot.selected = [peerBlock];
    const peerProtyle = {...f.protyle, wysiwyg: {element: peerRoot}};
    f.restore(peerProtyle, peerBlock);
    assert.equal(f.rendered(), peerBlock);
    f.clearGutter();
    f.render();
    assert.equal(f.rendered(), undefined, "an inactive split editor cannot reclaim the gutter");
    f.restore(peerProtyle);
    assert.equal(f.rendered(), peerBlock);
});

test("clearing selection, hiding the editor, or moving focus invalidates retained ownership", () => {
    const changes = [
        (f: ReturnType<typeof fixture>): void => { f.root.selected = []; },
        (f: ReturnType<typeof fixture>) => f.root.visible = false,
        (f: ReturnType<typeof fixture>) => f.ownerDocument.activeElement = new TestElement(),
        (f: ReturnType<typeof fixture>) => f.selection.focusNode = new TestElement(),
    ];
    changes.forEach(change => {
        const f = fixture();
        f.root.selected = [f.blocks[0], f.blocks[1]];
        f.render();
        f.selection.focusNode = undefined;
        change(f);
        f.clearGutter();
        f.render();
        assert.equal(f.rendered(), undefined);
        f.root.visible = true;
        f.root.selected = [f.blocks[0], f.blocks[1]];
        f.ownerDocument.activeElement = f.ownerDocument.body;
        f.selection.focusNode = undefined;
        f.render();
        assert.equal(f.rendered(), undefined, "the previous selection owner must not be resurrected");
    });
});

test("restoration respects hidden editors, active drags, mobile multi-select, and disabled gutters", () => {
    const changes = [
        (f: ReturnType<typeof fixture>) => f.root.isConnected = false,
        (f: ReturnType<typeof fixture>) => f.root.visible = false,
        (f: ReturnType<typeof fixture>) => f.root.classes.add("fn__pointer-none"),
        (f: ReturnType<typeof fixture>) => f.root.classes.add("protyle-wysiwyg--hiderange"),
        (f: ReturnType<typeof fixture>) => f.setMultiSelect(),
        (f: ReturnType<typeof fixture>) => f.protyle.options.render.gutter = false,
        (f: ReturnType<typeof fixture>) => f.selection.focusNode = new TestElement(),
    ];
    changes.forEach(change => {
        const f = fixture();
        change(f);
        f.render();
        assert.equal(f.calls.length, 0);
    });
});

test("desktop hover behavior is preserved while the mobile interface supports keyboard restoration", () => {
    const f = fixture();
    f.setDesktop();
    f.render();
    assert.equal(f.calls.length, 0);
    f.setMobile();
    f.render();
    assert.equal(f.rendered(), f.blocks[0]);
});

test("embedded content restores its existing operation boundary", () => {
    const f = fixture();
    const embed = new TestElement(f.root, true);
    f.blocks[0].embed = embed;
    f.render();
    assert.equal(f.rendered(), embed);
    f.blocks[0].embedContext = true;
    f.render();
    assert.equal(f.rendered(), f.blocks[0]);
});
