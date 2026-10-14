const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const file = path.join(__dirname, "inlineMathSelection.test.js");
const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
const extract = name => {
    let implementation;
    const visit = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) {
            implementation = node.initializer.getText(source);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(implementation, name);
    return implementation;
};

const rect = (x, y, width, height = 17) => ({x, y, width, height,
    left: x, right: x + width, top: y, bottom: y + height,
    toJSON() { return {x, y, width, height, left: x, right: x + width, top: y, bottom: y + height}; }});

// 只模拟字体度量和换行条件，驱动真实夹具；原生选区仍由 Electron 测试验证。
const fixture = ({viewportWidth, characterWidth = 1044.875 / 141, mathWidth = 17.671875}) => {
    const left = 36;
    const lineTop = 42;
    const lineHeight = 26;
    const suffix = {textContent: "哒哒哒哒哒哒"};
    const prefix = {textContent: ""};
    const prefixText = {get textContent() { return prefix.textContent; }};
    prefix.firstChild = prefixText;
    const prefixWidth = () => prefix.textContent.length * characterWidth;
    const style = {removeProperty(name) { if (name === "white-space") delete this.whiteSpace; }};
    const containerWidth = () => style.width === "max-content" ? prefixWidth() + mathWidth + 96 : parseFloat(style.width);
    const mathRect = () => {
        const wrapped = style.whiteSpace !== "nowrap" && prefixWidth() + mathWidth > containerWidth();
        return rect(wrapped ? left : left + prefixWidth(), lineTop + (wrapped ? lineHeight : 0), mathWidth);
    };
    const suffixRect = offset => {
        const formula = mathRect();
        const firstLineCapacity = Math.floor((containerWidth() - (formula.right - left)) / 16);
        if (offset < firstLineCapacity) return rect(formula.right + offset * 16, formula.top, 16);
        const lineCapacity = Math.max(1, Math.floor(containerWidth() / 16));
        const remainingOffset = offset - firstLineCapacity;
        return rect(left + remainingOffset % lineCapacity * 16,
            formula.top + (1 + Math.floor(remainingOffset / lineCapacity)) * lineHeight, 16);
    };
    const math = {dataset: {}, nextSibling: suffix, getBoundingClientRect: mathRect};
    const prefixRect = () => rect(left, lineTop, prefixWidth());
    prefix.getClientRects = () => [prefixRect()];
    prefix.getBoundingClientRect = prefixRect;
    const editable = {firstChild: prefix, style,
        get clientWidth() { return Math.round(containerWidth()); },
        getBoundingClientRect: () => rect(left, 38, containerWidth(), 52),
        querySelector: () => math,
        contains: node => [editable, prefix, prefixText, math, suffix].includes(node)};
    let selected;
    let offset = 0;
    const range = {
        selectNodeContents(node) { selected = node; },
        setStart(node, value) { selected = node; offset = value; },
        setEnd() {},
        getClientRects: () => [prefixRect()],
        getBoundingClientRect: () => selected === suffix ? suffixRect(offset) :
            rect(left + offset * characterWidth, lineTop, characterWidth),
    };
    const document = {body: {}, fonts: {ready: Promise.resolve(), status: "loaded"},
        querySelector: () => editable, createRange: () => range, addEventListener() {}};
    const window = {mathSelectionAPI: {mathRender: async () => {}}, devicePixelRatio: 1};
    const setupEdge = new Function("document", "window", "innerWidth", "innerHeight",
        `return (${extract("setupEdge")});`)(document, window, viewportWidth, 600);
    return {setupEdge, editable, prefix, math, prefixText, suffix, document, window};
};

for (const viewportWidth of [640, 1024, 1600]) {
    for (const characterWidth of [5, 1044.875 / 141, 11]) {
        for (const mode of ["left", "right"]) {
            test(`inline math edge geometry fits ${viewportWidth}px at glyph width ${characterWidth} (${mode})`, async () => {
                const item = fixture({viewportWidth, characterWidth});
                const points = await item.setupEdge(mode, "cross-line");
                assert.ok(points.geometry.editable.right <= viewportWidth - 32, JSON.stringify(points.geometry));
                assert.equal(item.prefix.textContent, "1".repeat(Math.min(141,
                    Math.floor((viewportWidth - 36 - 32 - 17.671875 - 2) / characterWidth))));
                assert.equal(points.geometry.prefixLines.length, 1);
                assert.ok(points.after.y > points.before.y, "cross-line endpoints must occupy different lines");
                if (mode === "left") {
                    assert.equal(points.mathLeft, points.prefixLeft);
                    assert.ok(points.geometry.math.top > points.geometry.prefixLines[0].bottom);
                } else {
                    assert.equal(points.geometry.math.top, points.geometry.prefixLines[0].top);
                    assert.ok(points.mathLeft > points.prefixLeft + points.width - 30);
                }
                for (const point of [points.before, points.after, points.left, points.right, points.mathEnd]) {
                    assert.ok(point.x >= 0 && point.x < viewportWidth, JSON.stringify(point));
                    assert.ok(point.y >= 0 && point.y < 600, JSON.stringify(point));
                }
            });
        }
    }
}

test("inline math edge geometry rejects a viewport too narrow for the fixture", async () => {
    await assert.rejects(fixture({viewportWidth: 80}).setupEdge("left", "cross-line"), /viewport|Prefix/i);
});

test("inline math edge geometry preserves both suffix hit characters at its narrow boundary", async () => {
    const item = fixture({viewportWidth: 133});
    const points = await item.setupEdge("left", "cross-line");
    assert.equal(item.prefix.textContent.length, 6);
    assert.ok(points.after.y >= points.geometry.math.top && points.after.y < points.geometry.math.bottom);
    await assert.rejects(fixture({viewportWidth: 132}).setupEdge("left", "cross-line"), /Invalid inline math edge layout/);
});

test("inline math edge geometry rejects a prefix that wraps after measurement", async () => {
    const item = fixture({viewportWidth: 1024});
    item.prefix.getClientRects = () => [rect(36, 42, 900), rect(36, 68, 30)];
    await assert.rejects(item.setupEdge("left", "cross-line"), /Invalid inline math edge layout/);
});

test("inline math edge geometry waits for fonts before measuring", async () => {
    const item = fixture({viewportWidth: 1024});
    let finishFonts;
    item.document.fonts.ready = new Promise(resolve => { finishFonts = resolve; });
    const pending = item.setupEdge("left", "cross-line");
    await Promise.resolve();
    assert.equal(item.editable.style.width, undefined);
    finishFonts();
    await pending;
    assert.ok(item.editable.style.width.endsWith("px"));
});

const pointFixture = () => {
    const item = fixture({viewportWidth: 1024});
    item.document.elementFromPoint = () => item.prefix;
    item.document.caretRangeFromPoint = () => ({startContainer: item.prefixText, startOffset: 1});
    const validateDragPoints = new Function("document", "innerWidth", "innerHeight",
        `return (${extract("validateDragPoints")});`)(item.document, 1024, 600);
    return {...item, validateDragPoints};
};

test("inline math drag preflight accepts hit and caret within the intended editor", () => {
    const item = pointFixture();
    assert.equal(item.validateDragPoints({x: 36, y: 50}, {x: 70, y: 76}), true);
});

for (const point of [{x: 1066, y: 50}, {x: 1024, y: 50}, {x: -1, y: 50},
    {x: 36, y: 600}, {x: 36, y: -1}, {x: NaN, y: 50}, {x: 36, y: Infinity}]) {
    for (const endpoint of ["from", "to"]) {
        test(`inline math drag preflight rejects ${endpoint} outside the viewport: ${JSON.stringify(point)}`, () => {
            const item = pointFixture();
            const points = {from: {x: 36, y: 50}, to: {x: 70, y: 76}, [endpoint]: point};
            assert.throws(() => item.validateDragPoints(points.from, points.to), new RegExp("Invalid native selection drag " + endpoint));
        });
    }
}

for (const failure of ["missing-hit", "foreign-hit", "missing-caret", "foreign-caret"]) {
    test(`inline math drag preflight rejects ${failure}`, () => {
        const item = pointFixture();
        if (failure.endsWith("hit")) {
            item.document.elementFromPoint = () => failure === "missing-hit" ? null : item.document.body;
        } else {
            item.document.caretRangeFromPoint = () => failure === "missing-caret" ? null :
                {startContainer: item.document.body, startOffset: 0};
        }
        assert.throws(() => item.validateDragPoints({x: 36, y: 50}, {x: 70, y: 76}), /Invalid native selection drag from/);
    });
}

const dragFixture = () => {
    const item = pointFixture();
    const sent = [];
    const win = {webContents: {executeJavaScript: async script => {
        if (script.includes("Invalid native selection drag")) {
            return new Function("document", "innerWidth", "innerHeight", `return ${script};`)(item.document, 1024, 600);
        }
        if (script === "getSelection().toString()") return "IE";
        if (script.includes("cloneContents")) return String.raw`$I_{\mathrm{E}}$`;
    }}};
    const drag = new Function("win", "send", "assert", "validateDragPoints", `return (${extract("drag")});`)(
        win, async event => sent.push(event), assert, item.validateDragPoints);
    return {...item, drag, sent};
};

test("inline math drag validates the same integer endpoints that it dispatches", async () => {
    const item = dragFixture();
    const hits = [];
    item.document.elementFromPoint = (x, y) => { hits.push({x, y}); return item.prefix; };
    await item.drag({x: 36.7, y: 50.5}, {x: 70.671875, y: 76.5}, true);
    assert.deepEqual(hits, [{x: 36, y: 50}, {x: 70, y: 76}]);
    for (const [type, point] of [["mousePressed", hits[0]], ["mouseReleased", hits[1]]]) {
        const event = item.sent.find(value => value.type === type);
        assert.equal(event.x, point.x);
        assert.equal(event.y, point.y);
    }
});

test("inline math drag fails before dispatch when integer rounding misses the editor", async () => {
    const item = dragFixture();
    item.document.elementFromPoint = x => x >= 36.2 ? item.prefix : item.document.body;
    await assert.rejects(item.drag({x: 36.7, y: 50.5}, {x: 70.671875, y: 76.5}, true), /Invalid native selection drag from/);
    assert.deepEqual(item.sent, []);
});
