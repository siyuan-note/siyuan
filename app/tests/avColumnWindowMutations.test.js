const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const {test} = require("node:test");
const ts = require("typescript");

const load = (file, name, dependencies) => {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
    let declaration;
    const visit = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) declaration = node;
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(declaration);
    const code = ts.transpileModule(`const ${declaration.getText(source)};`, {
        compilerOptions: {target: ts.ScriptTarget.ES2022},
    }).outputText;
    return new Function(...Object.keys(dependencies), code + `\nreturn ${name};`)(...Object.values(dependencies));
};

test("cell updates restore cached columns in every mirror before updating their content", () => {
    for (const sourceMounted of [false, true]) {
        const cells = [{isConnected: sourceMounted, dataset: {}}, {isConnected: false, dataset: {}}];
        const blocks = cells.map(cell => ({cell, querySelectorAll: () => cell.isConnected ? [cell] : []}));
        const updated = [];
        const events = [];
        const update = load("src/protyle/render/av/cell.ts", "updateAttrViewCellInOtherElements", {
            getAVData: block => ({view: block}),
            updateAVCachedCellValue: block => events.push(block),
            updateAVSelectedCellValue() {},
            ensureAVColumnWindow: (block, columnID, rowID) => {
                assert.ok(events.includes(block), "model updates precede DOM restoration");
                assert.equal(columnID, "column");
                assert.equal(rowID, "row");
                block.cell.isConnected = true;
            },
            updateAttrViewCellAnimation: (cell, value) => updated.push([cell, value]),
            document: {querySelectorAll: () => []},
        });
        const value = {id: "value", type: "number", number: {content: 42, isNotEmpty: true}};
        update({wysiwyg: {element: {querySelectorAll: () => blocks}}}, "database", "row", "column", value, cells[0]);
        assert.deepEqual(updated.map(([cell]) => cells.indexOf(cell)), sourceMounted ? [1] : [0, 1]);
        assert.ok(updated.every(([, content]) => content === value));
        assert.equal(cells[1].dataset.id, "value");
    }
});

test("column removal restores all database mirrors before deleting mounted or cached cells", () => {
    const blocks = [0, 1].map(() => ({prepared: false, querySelectorAll: () => []}));
    const cells = [0, 1].map(() => ({removed: false, remove() { this.removed = true; }}));
    const remove = load("src/protyle/render/av/action.ts", "removeAttrViewColAnimation", {
        getAVData: () => undefined,
        prepareAVColumnWindow: block => { block.prepared = true; },
        document: {querySelectorAll: selector => {
            if (selector === '.av[data-av-id="database"]') return blocks;
            if (selector.includes(".custom-attr")) return [];
            assert.ok(blocks.every(block => block.prepared));
            return cells;
        }},
    });
    remove({getAttribute: () => "database"}, "column");
    assert.ok(cells.every(cell => cell.removed));
});

for (const safari of [false, true]) {
    for (const failed of [false, true]) {
        test(`image export keeps columns mounted until ${safari ? "WebKit" : "Chromium"} cloning ${failed ? "fails" : "finishes"}`, async () => {
            let complete;
            let started = false;
            let released = 0;
            const cloning = new Promise((resolve, reject) => { complete = failed ? reject : resolve; });
            const clone = () => { started = true; return cloning; };
            const render = load("src/protyle/export/util.ts", "renderImageBlob", {
                suspendAVColumnWindows: () => () => { released++; },
                previewElement: {querySelectorAll: () => []},
                exportDialog: {element: {querySelector: () => ({ownerDocument: {}})}},
                setTimeout: resolve => resolve(), Constants: {TIMEOUT_LOAD: 0, PROTYLE_CDN: "cdn"},
                document: {fonts: {ready: Promise.resolve()}},
                window: {devicePixelRatio: 1, htmlToImage: {toBlob: clone}, modernScreenshot: {domToBlob: clone}},
                updateExportImageLayout() {}, getExportImageSize: () => ({width: 500, height: 300}),
                isExportImageSizeSupported: () => true, isIPhone: () => false, isIPad: () => false,
                isSafari: () => safari, addScript: async () => {},
                getExportImageLocalFontCSS: () => "", getExportImageFontCSS: async () => "",
                IMAGE_PLACEHOLDER: "placeholder",
            });
            const pending = render();
            while (!started) await new Promise(resolve => setImmediate(resolve));
            assert.equal(released, 0, "pending asynchronous cloning must retain full columns");
            if (failed) {
                complete(new Error("clone failed"));
                await assert.rejects(pending, /clone failed/);
            } else {
                complete("image");
                assert.equal(await pending, "image");
            }
            assert.equal(released, 1);
        });
    }
}
