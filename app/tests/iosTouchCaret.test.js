const assert = require("node:assert/strict");
const {readFileSync, mkdtempSync, rmSync} = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const rendererSource = () => {
    const ts = require("typescript");
    const read = name => readFileSync(path.join(__dirname, "../src/protyle", `${name}.ts`), "utf8");
    const selection = ts.createSourceFile("selectionOffsets.ts", read("util/selectionOffsets"), ts.ScriptTarget.Latest, true);
    const focus = selection.statements.find(statement => ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration => declaration.name.getText(selection) === "focusByRange"));
    assert.ok(focus);
    const source = "const Constants = {SIZE_DRAG_THRESHOLD: 5, TIMEOUT_LONGPRESS: 460};\n" +
        "const revealTabsForTarget = () => {};\n" + focus.getText(selection) + "\n" +
        ["wysiwyg/compositionInput", "wysiwyg/touchNavigation", "wysiwyg/touchCaret", "wysiwyg/nativeTextMenu"].map(name => {
            const parsed = ts.createSourceFile(name + ".ts", read(name), ts.ScriptTarget.Latest, true);
            return parsed.statements.filter(statement => !ts.isImportDeclaration(statement))
                .map(statement => statement.getText(parsed)).join("\n");
        }).join("\n");
    const wysiwyg = ts.createSourceFile("index.ts", read("wysiwyg/index"), ts.ScriptTarget.Latest, true);
    let doubleClick;
    let tableTap;
    const visit = node => {
        if (ts.isCallExpression(node) && node.expression.getText(wysiwyg) === "this.element.addEventListener" &&
            node.arguments[0]?.getText(wysiwyg) === '"dblclick"') {
            doubleClick = node.getText(wysiwyg);
        }
        if (ts.isCallExpression(node) && node.expression.getText(wysiwyg) === "bindIOSTouchCaret") {
            tableTap = node.arguments[2]?.getText(wysiwyg);
        }
        ts.forEachChild(node, visit);
    };
    visit(wysiwyg);
    assert.ok(doubleClick);
    assert.ok(tableTap);
    const menus = ts.createSourceFile("protyle.ts", readFileSync(path.join(__dirname, "../src/menus/protyle.ts"), "utf8"),
        ts.ScriptTarget.Latest, true);
    const contentMenu = menus.statements.find(statement => ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration => declaration.name.getText(menus) === "contentMenu"));
    assert.ok(contentMenu);
    const integration = `exports.bindNativeDoubleClick = function(element, toolbar) {
        const protyle = {toolbar};
        const isIOSDevice = () => true;
        const getAVTemplateInteractiveElement = () => undefined;
        (function() { ${doubleClick}; }).call({element});
    };
    exports.createNativeTableTap = function(element) {
        return (function() { return ${tableTap}; }).call({element});
    };
    exports.callNativeContentMenu = function(protyle, nodeElement) {
        const getEditorRange = () => document.getSelection().getRangeAt(0);
        const isIOSDevice = () => true;
        const isInEmbedBlock = () => false;
        ${contentMenu.getText(menus).replace(/^export /u, "")}
        contentMenu(protyle, nodeElement);
    };`;
    return ts.transpileModule(source + integration, {compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021,
    }}).outputText;
};

const runCases = async () => {
    const check = require("node:assert/strict");
    const {bindIOSTouchCaret} = window.touchCaret;
    const selection = document.getSelection();
    let time = 1000;
    const originalNow = Date.now;
    Date.now = () => time;
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const errors = [];
    const onError = event => errors.push(event.message);
    window.addEventListener("error", onError);
    let cases = 0;
    const fixture = (focused = true, tableTap = false) => {
        document.body.innerHTML = `<div class="protyle-wysiwyg" contenteditable="false" style="font: 20px monospace">
            <div data-node-id="one"><div contenteditable="true">97997974949464649</div></div>
            <div data-node-id="two"><div contenteditable="true">点击定位文字</div></div>
        </div><input id="outside">`;
        const root = document.querySelector(".protyle-wysiwyg");
        const editable = root.querySelector('[contenteditable="true"]');
        const text = editable.firstChild;
        let enabled = true;
        const dispose = bindIOSTouchCaret(root, () => enabled,
            tableTap ? window.touchCaret.createNativeTableTap(root) : undefined);
        const place = (offset, node = text, end = offset) => {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, end);
            selection.removeAllRanges();
            selection.addRange(range);
        };
        const pointAt = (offset, node = text) => {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            const rect = range.getBoundingClientRect();
            return {clientX: rect.left + 0.1, clientY: (rect.top + rect.bottom) / 2};
        };
        const send = (type, point, target = editable, options = {}) => {
            const touch = new Touch({identifier: 1, target, ...point});
            const event = new TouchEvent(type, {bubbles: true, cancelable: true,
                touches: type === "touchend" || type === "touchcancel" ? [] : [touch], changedTouches: [touch], ...options});
            Object.defineProperty(event, "timeStamp", {value: options.timeStamp ?? time});
            target.dispatchEvent(event);
            return event;
        };
        const tap = (offset, target = editable, node = text) => {
            const point = pointAt(offset, node);
            send("touchstart", point, target);
            return send("touchend", point, target);
        };
        const caret = (offset, node = text) => {
            check.equal(selection.isCollapsed, true);
            check.equal(selection.anchorNode, node);
            check.equal(selection.anchorOffset, offset);
        };
        if (focused) {
            editable.focus();
            place(text.length);
        } else {
            selection.removeAllRanges();
        }
        return {root, editable, text, place, pointAt, send, tap, caret, dispose,
            disable: () => { enabled = false; }};
    };
    const run = async (callback, focused = true) => {
        time += 1000;
        const f = fixture(focused);
        try {
            await callback(f);
            cases++;
        } finally {
            f.dispose();
        }
    };
    try {
        await run(async f => {
            const subElement = document.createElement("div");
            f.place(1, f.text, 6);
            window.touchCaret.callNativeContentMenu({wysiwyg: {element: f.root}, toolbar: {subElement}}, f.editable.parentElement);
            check.equal(subElement.classList.contains("fn__none"), true);
        });
        await run(async f => {
            const originalWebkit = window.webkit;
            window.webkit = {};
            try {
                f.place(1, f.text, 6);
                window.touchCaret.requestNativeTextMenu(f.root, selection.getRangeAt(0));
            } finally {
                window.webkit = originalWebkit;
            }
        });
        for (const kind of ["pointerdown", "touchstart", "drag"]) {
            await run(async f => {
                const originalWebkit = window.webkit;
                const messages = [];
                window.webkit = {messageHandlers: {showTextMenu: {postMessage: async text => {
                    messages.push(text);
                    return true;
                }}}};
                try {
                    f.place(2, f.text, 6);
                    const selected = selection.toString();
                    window.touchCaret.requestNativeTextMenu(f.root, selection.getRangeAt(0));
                    await new Promise(resolve => setTimeout(resolve, 150));
                    const point = f.pointAt(5);
                    if (kind === "pointerdown") {
                        f.editable.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "touch", ...point}));
                    } else {
                        f.send("touchstart", point);
                    }
                    if (kind === "drag") {
                        f.send("touchmove", {...point, clientX: point.clientX + 40});
                        f.place(2, f.text, 10);
                        document.dispatchEvent(new Event("selectionchange"));
                        f.send("touchend", {...point, clientX: point.clientX + 40});
                    }
                    await nextFrame();
                    check.deepEqual(messages, [selected], "selection handle gestures do not dismiss the native menu");
                    check.equal(selection.toString(), f.text.textContent.slice(2, kind === "drag" ? 10 : 6));
                } finally {
                    f.dispose();
                    window.webkit = originalWebkit;
                }
            });
        }
        for (const endpoint of ["start", "end"]) {
            await run(async f => {
                const originalWebkit = window.webkit;
                const messages = [];
                window.webkit = {messageHandlers: {showTextMenu: {postMessage: async text => {
                    messages.push(text);
                    return true;
                }}}};
                try {
                    const table = document.createElement("table");
                    table.innerHTML = '<tbody><tr><td style="padding:24px"></td></tr></tbody>';
                    f.root.replaceWith(table);
                    const cell = table.querySelector("td");
                    cell.appendChild(f.root);
                    f.editable.focus();
                    f.place(2, f.text, 6);
                    const selected = selection.toString();
                    window.touchCaret.requestNativeTextMenu(f.root, selection.getRangeAt(0));
                    await new Promise(resolve => setTimeout(resolve, 150));
                    const rect = selection.getRangeAt(0).getBoundingClientRect();
                    const point = {clientX: endpoint === "start" ? rect.left : rect.right,
                        clientY: endpoint === "start" ? rect.top - 5 : rect.bottom + 5};
                    cell.dispatchEvent(new PointerEvent("pointerdown", {bubbles: true, pointerType: "touch", ...point}));
                    f.send("touchstart", point, cell);
                    check.deepEqual(messages, [selected], `${endpoint} handle outside the editor retains its native menu`);
                    document.querySelector("#outside").dispatchEvent(new PointerEvent("pointerdown", {
                        bubbles: true, pointerType: "touch", clientX: rect.right + 100, clientY: rect.bottom + 100,
                    }));
                    check.deepEqual(messages, [selected, ""], "an unrelated outside tap still dismisses the menu");
                } finally {
                    f.dispose();
                    window.webkit = originalWebkit;
                }
            });
        }
        await run(async f => {
            const originalWebkit = window.webkit;
            const messages = [];
            let rejectOldSelection;
            window.webkit = {messageHandlers: {showTextMenu: {postMessage: text => {
                messages.push(text);
                return text ? new Promise(resolve => { rejectOldSelection = resolve; }) : Promise.resolve(true);
            }}}};
            try {
                f.place(2, f.text, 6);
                const selected = selection.toString();
                window.touchCaret.requestNativeTextMenu(f.root, selection.getRangeAt(0));
                await new Promise(resolve => setTimeout(resolve, 150));
                f.place(2, f.text, 10);
                document.dispatchEvent(new Event("selectionchange"));
                rejectOldSelection(false);
                await nextFrame();
                check.deepEqual(messages, [selected], "a late response for the previous selection does not cancel a handle drag");
            } finally {
                f.dispose();
                window.webkit = originalWebkit;
            }
        });
        await run(async f => {
            f.root.innerHTML = '<div class="table" data-node-id="table" data-type="NodeTable">' +
                '<div contenteditable="false"><table contenteditable="true"><tbody><tr><td>table text</td></tr>' +
                "</tbody></table></div></div>";
            const cell = f.root.querySelector("td");
            check.equal(window.touchCaret.usesNativeTextMenu(cell, f.root), true, "table text uses the native menu");
            cell.innerHTML = '<div class="table__cell-editor" contenteditable="false">' +
                '<div class="protyle-wysiwyg" contenteditable="false"><div contenteditable="true">nested cell</div></div></div>';
            const inner = cell.querySelector(".protyle-wysiwyg");
            const target = inner.firstElementChild;
            check.equal(window.touchCaret.usesNativeTextMenu(target, inner), true, "the cell editor owns its text menu");
            check.equal(window.touchCaret.usesNativeTextMenu(target, f.root), false, "the outer editor ignores nested text menus");
        });
        for (const empty of [false, true]) {
            await run(async f => {
                f.root.innerHTML = '<div class="table" data-node-id="table" data-type="NodeTable">' +
                    '<div contenteditable="false"><table contenteditable="true"><tbody><tr>' +
                    '<td style="width:12px"></td><td>neighbor</td></tr></tbody></table></div></div>';
                const table = f.root.querySelector("table");
                const cell = table.querySelector("td");
                if (!empty) cell.textContent = "x";
                const neighbor = cell.nextElementSibling.firstChild;
                table.focus();
                f.place(0, neighbor);
                const originalCaret = document.caretRangeFromPoint;
                document.caretRangeFromPoint = () => {
                    const range = document.createRange();
                    range.setStart(neighbor, 0);
                    range.collapse(true);
                    return range;
                };
                try {
                    const rect = cell.getBoundingClientRect();
                    const point = {clientX: (rect.left + rect.right) / 2, clientY: (rect.top + rect.bottom) / 2};
                    f.send("touchstart", point, cell);
                    f.send("touchend", point, cell);
                    await nextFrame();
                    check.equal(selection.isCollapsed, true);
                    check.equal(cell.contains(selection.anchorNode), true, "a tap stays in its narrow or empty table cell");
                } finally {
                    document.caretRangeFromPoint = originalCaret;
                }
            });
        }
        {
            const clicks = [];
            const f = fixture(true, true);
            try {
                f.root.innerHTML = '<div class="table" data-node-id="table"><div contenteditable="false">' +
                    '<table contenteditable="true"><tbody><tr><td>cell</td></tr></tbody></table></div></div>';
                const cell = f.root.querySelector("td");
                cell.addEventListener("click", event => clicks.push({target: event.target, x: event.clientX, y: event.clientY}));
                const point = f.pointAt(1, cell.firstChild);
                f.send("touchstart", point, cell);
                const end = f.send("touchend", point, cell);
                await nextFrame();
                check.equal(end.defaultPrevented, true, "the delayed compatibility click is suppressed after table activation");
                check.equal(clicks.length, 1, "a cell activates even when WebKit never dispatches click");
                check.equal(clicks[0].target, cell);
                check.ok(Math.abs(clicks[0].x - point.clientX) < 1);
                check.ok(Math.abs(clicks[0].y - point.clientY) < 1);
                cases++;
            } finally {
                f.dispose();
            }
        }
        for (const kind of ["selected", "native", "changed", "scroll"]) {
            await run(async f => {
                let calls = 0;
                const originalWebkit = window.webkit;
                window.webkit = {messageHandlers: {showTextMenu: {postMessage: async () => { calls++; return true; }}}};
                try {
                    const point = f.pointAt(4);
                    f.send("touchstart", point);
                    time += 100;
                    f.send("touchstart", point);
                    if (kind === "native") {
                        f.place(2, f.text, 6);
                    }
                    await nextFrame();
                    if (kind === "changed") {
                        time += 1000;
                        f.place(f.text.length);
                    } else if (kind === "scroll") {
                        f.root.dispatchEvent(new Event("scroll"));
                    }
                    await new Promise(resolve => setTimeout(resolve, 150));
                    check.equal(calls, kind === "selected" || kind === "native" ? 1 : 0, kind);
                } finally {
                    window.webkit = originalWebkit;
                }
            });
        }
        for (const kind of ["collapsed", "changed", "outside", "ancestorScroll", "unrelatedScroll", "input", "duplicate", "dispose"]) {
            await run(async f => {
                const originalWebkit = window.webkit;
                const messages = [];
                window.webkit = {messageHandlers: {showTextMenu: {postMessage: async text => {
                    messages.push(text);
                    return true;
                }}}};
                try {
                    f.place(2, f.text, 6);
                    const text = selection.toString();
                    window.touchCaret.requestNativeTextMenu(f.root, selection.getRangeAt(0));
                    await new Promise(resolve => setTimeout(resolve, 150));
                    check.deepEqual(messages, [text]);
                    if (kind === "collapsed" || kind === "changed") {
                        f.place(1, f.text, kind === "collapsed" ? 1 : 3);
                        document.dispatchEvent(new Event("selectionchange"));
                    } else if (kind === "outside") {
                        document.querySelector("#outside").dispatchEvent(new Event("pointerdown", {bubbles: true}));
                    } else if (kind === "ancestorScroll") {
                        document.body.dispatchEvent(new Event("scroll"));
                    } else if (kind === "unrelatedScroll") {
                        document.querySelector("#outside").dispatchEvent(new Event("scroll"));
                    } else if (kind === "input") {
                        f.editable.dispatchEvent(new InputEvent("beforeinput", {bubbles: true, inputType: "insertText"}));
                    } else if (kind === "duplicate") {
                        window.touchCaret.requestNativeTextMenu(f.root, selection.getRangeAt(0));
                    } else if (kind === "dispose") {
                        f.dispose();
                    }
                    await new Promise(resolve => setTimeout(resolve, 150));
                    check.deepEqual(messages, kind === "unrelatedScroll" || kind === "duplicate" || kind === "changed" ?
                        [text] : [text, ""], kind);
                } finally {
                    window.webkit = originalWebkit;
                }
            });
        }
        await run(async f => {
            const other = f.root.querySelectorAll('[contenteditable="true"]')[1];
            const oldText = other.firstChild;
            other.focus();
            f.place(0, oldText, 2);
            const point = f.pointAt(4);
            f.send("touchstart", point);
            const staleTouch = new Touch({identifier: 2, target: other, ...point});
            f.send("touchend", point, f.editable, {touches: [staleTouch]});
            time += 100;
            f.send("touchstart", point);
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent, "double tap replaces the adjacent block's stale selection");
            check.equal(selection.anchorNode, f.text);
            check.equal(document.activeElement, f.editable);
        });
        await run(async f => {
            f.text.textContent = "alpha beta";
            f.place(0, f.text, 5);
            const point = f.pointAt(8);
            f.send("touchstart", point);
            time += 100;
            f.send("touchstart", point);
            await nextFrame();
            check.equal(selection.toString(), "beta", "double tap works when neither touch sends an end event");
        });
        await run(async f => {
            const point = f.pointAt(4);
            f.send("touchstart", point);
            time += 100;
            f.send("touchstart", point);
            f.place(2, f.text, 6);
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent.slice(2, 6));
        });
        await run(async f => {
            f.text.textContent = "alpha beta";
            const point = f.pointAt(2);
            f.send("touchstart", point);
            time += 100;
            f.send("touchstart", point);
            time += 100;
            f.send("touchstart", point);
            f.place(0, f.text, f.text.length);
            await nextFrame();
            check.equal(selection.toString(), "alpha beta");
        });
        for (const kind of ["touchcancel", "scroll", "move", "multitouch"]) {
            await run(async f => {
                const point = f.pointAt(4);
                f.send("touchstart", point);
                if (kind === "scroll") {
                    f.root.dispatchEvent(new Event("scroll"));
                } else if (kind === "move") {
                    f.send("touchmove", {...point, clientY: point.clientY + 10});
                } else if (kind === "multitouch") {
                    const touch = new Touch({identifier: 2, target: f.editable, ...point});
                    f.send("touchstart", point, f.editable, {touches: [touch, touch]});
                } else {
                    f.send("touchcancel", point);
                }
                time += 100;
                f.tap(4);
                await nextFrame();
                f.caret(4);
            });
        }
        await run(async f => {
            const subElement = document.createElement("div");
            window.touchCaret.bindNativeDoubleClick(f.root, {isMultiSelectMode: () => false, subElement});
            f.place(1, f.text, 6);
            f.editable.dispatchEvent(new MouseEvent("dblclick", {bubbles: true, detail: 2, ...f.pointAt(4)}));
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent.slice(1, 6));
            check.equal(subElement.classList.contains("fn__none"), true);
        });
        await run(async f => {
            const point = f.pointAt(4);
            f.tap(4);
            await nextFrame();
            time += 100;
            f.send("touchstart", point);
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent);
            f.send("touchcancel", point);
            check.equal(selection.toString(), f.text.textContent);
        }, false);
        await run(async f => {
            const point = f.pointAt(4);
            f.tap(4);
            await nextFrame();
            time += 100;
            f.send("touchstart", point);
            f.send("touchcancel", point);
            f.place(f.text.length);
            f.editable.dispatchEvent(new MouseEvent("dblclick", {bubbles: true, detail: 2, ...point}));
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent);
        }, false);
        await run(async f => {
            const point = f.pointAt(4);
            f.tap(4);
            await nextFrame();
            time += 100;
            f.tap(4);
            f.root.dispatchEvent(new Event("scroll"));
            f.place(f.text.length);
            f.editable.dispatchEvent(new MouseEvent("dblclick", {bubbles: true, detail: 2, ...point}));
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent);
        }, false);
        await run(async f => {
            const point = f.pointAt(4);
            f.tap(4);
            await nextFrame();
            time += 100;
            f.place(1, f.text, 6);
            f.editable.dispatchEvent(new MouseEvent("dblclick", {bubbles: true, detail: 2, ...point}));
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent.slice(1, 6));
        });
        await run(async f => {
            const {usesNativeTextMenu} = window.touchCaret;
            check.equal(usesNativeTextMenu(f.editable, f.root), true);
            f.editable.innerHTML = "<b>formatted text</b>";
            check.equal(usesNativeTextMenu(f.editable.firstChild, f.root), true);
            for (const markup of ["<a href='#'>link</a>", "<span data-type='block-ref'>reference</span>",
                "<span data-type='inline-math'>math</span>", "<span contenteditable='false'>readonly</span>",
                "<button>action</button>", "<img>", "<span class='protyle-action'>1.</span>"]) {
                f.editable.innerHTML = markup;
                check.equal(usesNativeTextMenu(f.editable.firstChild, f.root), false, markup);
            }
            check.equal(usesNativeTextMenu(document.getElementById("outside"), f.root), false);
            check.equal(usesNativeTextMenu(f.root, f.root), false);
        });
        await run(async f => {
            const point = f.pointAt(4);
            const touchTime = time;
            f.send("touchstart", point, f.editable, {timeStamp: touchTime});
            f.send("touchend", point, f.editable, {timeStamp: touchTime + 30});
            await nextFrame();
            f.root.style.paddingTop = "100px";
            time += 800;
            f.send("touchstart", point, f.root, {timeStamp: touchTime + 160});
            f.send("touchend", point, f.root, {timeStamp: touchTime + 190});
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent);
        }, false);
        await run(async f => {
            const point = f.pointAt(4);
            const touchTime = time;
            f.send("touchstart", point, f.editable, {timeStamp: touchTime});
            f.send("touchend", point, f.editable, {timeStamp: touchTime + 30});
            await nextFrame();
            time += 800;
            f.send("touchstart", point, f.editable, {timeStamp: touchTime + 160});
            f.send("touchend", point, f.editable, {timeStamp: touchTime + 190});
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent);
        });
        await run(async f => {
            check.equal(selection.rangeCount, 0);
            f.tap(4);
            check.equal(document.activeElement, f.editable);
            f.caret(4);
            await nextFrame();
            f.caret(4);
            time += 100;
            f.tap(4);
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent);
        }, false);
        await run(async f => {
            f.disable();
            f.tap(4);
            await nextFrame();
            check.equal(document.activeElement, document.body);
            check.equal(selection.rangeCount, 0);
        }, false);
        await run(async f => {
            const point = f.pointAt(4);
            f.send("touchstart", point);
            f.root.style.marginTop = "100px";
            f.send("touchend", point);
            await nextFrame();
            f.caret(4);
        }, false);
        await run(async f => {
            const point = f.pointAt(4);
            f.send("touchstart", point);
            f.root.style.paddingTop = "100px";
            f.send("touchend", point);
            await nextFrame();
            time += 100;
            f.send("touchstart", point, f.root);
            f.send("touchend", point, f.root);
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent);
        }, false);
        await run(async f => {
            const point = f.pointAt(4);
            f.send("touchstart", point);
            f.root.style.paddingTop = "100px";
            f.send("touchend", point);
            await nextFrame();
            f.editable.blur();
            selection.removeAllRanges();
            const event = new MouseEvent("click", {bubbles: true, cancelable: true, detail: 1, ...point});
            f.root.dispatchEvent(event);
            check.equal(event.defaultPrevented, true);
            await nextFrame();
            check.equal(document.activeElement, f.editable);
            f.caret(4);
        }, false);
        await run(async f => {
            f.text.textContent = "alpha beta";
            const character = document.createRange();
            character.setStart(f.text, 4);
            character.setEnd(f.text, 5);
            const rect = character.getBoundingClientRect();
            const point = {clientX: rect.right - 0.1, clientY: (rect.top + rect.bottom) / 2};
            f.send("touchstart", point);
            f.send("touchend", point);
            await nextFrame();
            time += 100;
            f.send("touchstart", point);
            f.send("touchend", point);
            await nextFrame();
            check.equal(selection.toString(), "alpha");
        });
        await run(async f => {
            f.tap(4);
            await nextFrame();
            let changed = new Promise(resolve => document.addEventListener("selectionchange", resolve, {once: true}));
            f.place(f.text.length);
            await changed;
            await nextFrame();
            f.caret(4);
            time += 100;
            f.tap(4);
            await nextFrame();
            changed = new Promise(resolve => document.addEventListener("selectionchange", resolve, {once: true}));
            f.place(f.text.length);
            await changed;
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent);
        });
        await run(async f => {
            f.editable.innerHTML = "hel<b>lo</b> world";
            const target = f.editable.querySelector("b");
            const text = target.firstChild;
            f.tap(1, target, text);
            await nextFrame();
            time += 100;
            f.tap(1, target, text);
            await nextFrame();
            check.equal(selection.toString(), "hello");
        });
        await run(async f => {
            const editable = f.root.querySelectorAll('[contenteditable="true"]')[1];
            const text = editable.firstChild;
            f.tap(2, editable, text);
            await nextFrame();
            time += 100;
            f.tap(2, editable, text);
            await nextFrame();
            check.ok(selection.toString().includes("定"));
            check.ok(editable.contains(selection.anchorNode));
            check.ok(editable.contains(selection.focusNode));
        }, false);
        await run(async f => {
            f.text.textContent = "a 😀 b";
            f.tap(2);
            await nextFrame();
            time += 100;
            f.tap(2);
            await nextFrame();
            check.equal(selection.toString(), "😀");
        });
        await run(async f => {
            f.text.textContent = "hel";
            f.editable.insertAdjacentHTML("beforeend", "<span data-type='a'>lo</span>");
            f.tap(1);
            await nextFrame();
            time += 100;
            f.tap(1);
            await nextFrame();
            check.equal(selection.isCollapsed, true);
        });
        await run(async f => {
            check.equal(f.tap(4).defaultPrevented, false);
            f.place(f.text.length);
            await nextFrame();
            f.caret(4);
            // 快速点击不同字符时，不能将第二次定位误判为双击。
            time += 100;
            f.tap(11);
            f.place(f.text.length);
            await nextFrame();
            f.caret(11);
        });
        await run(async f => {
            const editable = f.root.querySelectorAll('[contenteditable="true"]')[1];
            const text = editable.firstChild;
            f.tap(2, editable, text);
            editable.focus();
            f.place(text.length, text);
            await nextFrame();
            f.caret(2, text);
        });
        await run(async f => {
            f.root.setAttribute("contenteditable", "true");
            f.root.focus();
            f.tap(4);
            f.place(f.text.length);
            await nextFrame();
            f.caret(4);
        });
        await run(async f => {
            const point = f.pointAt(4);
            f.tap(4);
            await nextFrame();
            f.place(f.text.length);
            time += 100;
            f.editable.dispatchEvent(new MouseEvent("click", {bubbles: true, detail: 1, ...point}));
            await nextFrame();
            f.caret(4);
        });
        await run(async f => {
            f.tap(4);
            await nextFrame();
            time += 100;
            f.tap(4);
            f.place(0, f.text, f.text.length);
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent);
        });
        await run(async f => {
            f.tap(4);
            f.place(2, f.text, 6);
            await nextFrame();
            check.equal(selection.toString(), f.text.textContent.slice(2, 6));
        });
        for (const kind of ["longpress", "scroll", "cancel", "multitouch"]) {
            await run(async f => {
                const point = f.pointAt(4);
                f.send("touchstart", point);
                if (kind === "longpress") {
                    time += 500;
                } else if (kind === "scroll") {
                    f.send("touchmove", {...point, clientY: point.clientY + 10});
                } else if (kind === "cancel") {
                    f.send("touchcancel", point);
                } else {
                    const touch = new Touch({identifier: 2, target: f.editable, ...point});
                    f.send("touchstart", point, f.editable, {touches: [touch, touch]});
                }
                f.send("touchend", point);
                await nextFrame();
                f.caret(f.text.length);
            });
        }
        for (const kind of ["disabled", "removed", "outside", "disposed", "beforeinput", "keydown", "scroll"]) {
            await run(async f => {
                f.tap(4);
                if (kind === "disabled") {
                    f.disable();
                } else if (kind === "removed") {
                    f.editable.remove();
                } else if (kind === "outside") {
                    document.getElementById("outside").focus();
                } else if (kind === "disposed") {
                    f.dispose();
                } else {
                    f.editable.dispatchEvent(new Event(kind, {bubbles: true}));
                }
                const node = selection.anchorNode;
                const offset = selection.anchorOffset;
                await nextFrame();
                check.equal(selection.anchorNode, node);
                check.equal(selection.anchorOffset, offset);
            });
        }
        await run(async f => {
            f.editable.dispatchEvent(new CompositionEvent("compositionstart", {bubbles: true}));
            f.tap(4);
            await nextFrame();
            f.caret(f.text.length);
            f.editable.dispatchEvent(new InputEvent("input", {bubbles: true, isComposing: false, inputType: "insertText"}));
            time += 1000;
            f.tap(4);
            await nextFrame();
            f.caret(4);
        });
        for (const markup of ["<a href='#'>link</a>", "<span data-type='block-ref'>reference</span>",
            "<span data-type='inline-math'>math</span>", "<span contenteditable='false'>readonly</span>"]) {
            await run(async f => {
                f.editable.insertAdjacentHTML("beforeend", markup);
                const target = f.editable.lastElementChild;
                const point = f.pointAt(4);
                f.send("touchstart", point, target);
                f.send("touchend", point, target);
                await nextFrame();
                f.caret(f.text.length);
            });
        }
        await run(async f => {
            const caretRangeFromPoint = document.caretRangeFromPoint;
            try {
                document.caretRangeFromPoint = () => null;
                f.tap(4);
                await nextFrame();
                f.caret(f.text.length);
            } finally {
                document.caretRangeFromPoint = caretRangeFromPoint;
            }
        });
        await run(async f => {
            const text = f.root.querySelectorAll('[contenteditable="true"]')[1].firstChild;
            const point = f.pointAt(2, text);
            f.send("touchstart", point);
            f.send("touchend", point);
            await nextFrame();
            f.caret(f.text.length);
        });
        await nextFrame();
        check.deepEqual(errors, []);
        return cases;
    } finally {
        Date.now = originalNow;
        window.removeEventListener("error", onError);
    }
};

const runElectron = async () => {
    const {app, BrowserWindow} = require("electron");
    app.setPath("userData", process.argv[2]);
    app.commandLine.appendSwitch("disable-gpu");
    await app.whenReady();
    // 离屏渲染持续推进字符坐标和原生选区校正所需的渲染帧。
    const win = new BrowserWindow({show: false, webPreferences: {
        nodeIntegration: true, contextIsolation: false, offscreen: true, backgroundThrottling: false,
    }});
    let exitCode = 0;
    try {
        await win.loadURL("data:text/html,<html><body></body></html>");
        await win.webContents.executeJavaScript(`window.touchCaret = {};
            new Function("exports", ${JSON.stringify(rendererSource())})(window.touchCaret);`);
        const cases = await win.webContents.executeJavaScript(`(${runCases.toString()})()`);
        console.log(`iOS touch caret: ${cases} DOM cases passed`);
    } catch (error) {
        console.error(error);
        exitCode = 1;
    } finally {
        win.destroy();
        app.exit(exitCode);
    }
};

if (process.versions.electron && process.type === "browser") {
    runElectron().catch(error => { console.error(error); require("electron").app.exit(1); });
} else {
    require("node:test").test("places iOS short-tap carets at character coordinates and preserves native selection gestures", {
        skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
        timeout: 45000,
    }, async () => {
        const profile = mkdtempSync(path.join(os.tmpdir(), "siyuan-ios-touch-caret-"));
        const env = {...process.env};
        delete env.ELECTRON_RUN_AS_NODE;
        try {
            const {stdout} = await require("node:util").promisify(require("node:child_process").execFile)(
                require("electron"), [__filename, profile], {env, windowsHide: true, timeout: 40000});
            assert.match(stdout, /iOS touch caret: 75 DOM cases passed/);
        } finally {
            assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(profile).startsWith("siyuan-ios-touch-caret-"));
            rmSync(profile, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
        }
    });
}
