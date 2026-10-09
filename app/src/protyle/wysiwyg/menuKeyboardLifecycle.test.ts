import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {
    createSourceFile,
    isCallExpression,
    isIfStatement,
    isVariableStatement,
    ModuleKind,
    ScriptTarget,
    transpileModule,
} from "typescript";
import type {Node} from "typescript";

const keydownSource = createSourceFile("keydown.ts", readFileSync("src/protyle/wysiwyg/keydown.ts", "utf8"),
    ScriptTarget.ES2021, true);
const keyupSource = createSourceFile("index.ts", readFileSync("src/protyle/wysiwyg/index.ts", "utf8"),
    ScriptTarget.ES2021, true);

const findNodes = <T extends Node>(root: Node, predicate: (node: Node) => node is T): T[] => {
    const matches: T[] = [];
    const visit = (node: Node) => {
        if (predicate(node)) {
            matches.push(node);
        }
        node.forEachChild(visit);
    };
    visit(root);
    return matches;
};

const compiledSources = new Map<string, string>();
const compile = (source: string, globals: Record<string, unknown>) => {
    if (!compiledSources.has(source)) {
        compiledSources.set(source, transpileModule(source, {
            compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
        }).outputText);
    }
    const exports: any = {};
    runInNewContext(compiledSources.get(source), {exports, ...globals});
    return exports.subject;
};

const loadFunction = (path: string, name: string, globals: Record<string, unknown>) => {
    const source = createSourceFile(path, readFileSync(path, "utf8"), ScriptTarget.ES2021, true);
    const declaration = source.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(source) === name));
    assert.ok(declaration);
    return compile(`${declaration.getText(source)}\nexports.subject = ${name};`, globals);
};

const menuBranches = findNodes(keydownSource, (node): node is import("typescript").IfStatement =>
    isIfStatement(node) && !!node.elseStatement && node.expression.getText(keydownSource).startsWith(
        '!window.siyuan.menus.menu.element.classList.contains("fn__none") &&'));
assert.equal(menuBranches.length, 1);

const keydownDeclaration = keydownSource.statements.find(statement => isVariableStatement(statement) &&
    statement.declarationList.declarations.some(item => item.name.getText(keydownSource) === "keydown"));
assert.ok(keydownDeclaration);

const keyupBindings = findNodes(keyupSource, (node): node is import("typescript").CallExpression =>
    isCallExpression(node) && node.expression.getText(keyupSource) === "this.element.addEventListener" &&
    node.arguments[0]?.getText(keyupSource) === '"keyup"' &&
    findNodes(node.arguments[1], (child): child is import("typescript").CallExpression =>
        isCallExpression(child) && child.expression.getText(keyupSource) === "protyle.toolbar.render").length > 0);
assert.equal(keyupBindings.length, 1);

const keyCodes: Record<string, number> = {
    Enter: 13, Shift: 16, Control: 17, Alt: 18, Escape: 27,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Meta: 91,
};
const keyboardEvent = (key: string, overrides: Record<string, unknown> = {}) => ({
    key,
    keyCode: keyCodes[key] || 65,
    code: key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    eventPhase: 3,
    target: {localName: "div", closest: (): unknown => null},
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    ...overrides,
});

const menuFixture = (initiallyHidden = false) => {
    let hidden = initiallyHidden;
    const calls: string[] = [];
    const menu = {
        element: {classList: {contains: (className: string) => className === "fn__none" && hidden}},
        remove: () => {
            hidden = true;
            calls.push("remove");
        },
    };
    const handleMenu = compile(`exports.subject = (event) => {
        ${menuBranches[0].getText(keydownSource)}
        return "continue";
    };`, {
        window: {siyuan: {menus: {menu}}},
        Constants: {KEYCODELIST: {13: "↩", 37: "←", 38: "↑", 39: "→", 40: "↓"}},
        isNotCtrl: (event: KeyboardEvent) => !event.ctrlKey && !event.metaKey,
    });
    return {menu, calls, handleMenu};
};

test("pure modifier keys keep the menu open without consuming the event", () => {
    for (const [key, modifier] of [["Control", "ctrlKey"], ["Shift", "shiftKey"],
        ["Alt", "altKey"], ["Meta", "metaKey"]]) {
        for (const otherModifiers of [false, true]) {
            const {menu, calls, handleMenu} = menuFixture();
            const event = keyboardEvent(key, otherModifiers ? {
                ctrlKey: true, shiftKey: true, altKey: true, metaKey: true,
            } : {[modifier]: true});
            assert.equal(handleMenu(event), "continue", key);
            assert.deepEqual(calls, [], key);
            assert.equal(menu.element.classList.contains("fn__none"), false, key);
            assert.equal(event.defaultPrevented, false, key);
            assert.equal(event.propagationStopped, false, key);
        }
    }
});

test("the action key still closes the menu with or without held modifiers", () => {
    for (const modifier of ["", "ctrlKey", "shiftKey", "altKey", "metaKey"]) {
        const {menu, calls, handleMenu} = menuFixture();
        const event = keyboardEvent("a", modifier ? {[modifier]: true} : {});
        assert.equal(handleMenu(event), "continue");
        assert.deepEqual(calls, ["remove"]);
        assert.equal(menu.element.classList.contains("fn__none"), true);
        assert.equal(event.defaultPrevented, false);
        assert.equal(event.propagationStopped, false);
    }
});

test("unmodified arrows and Enter retain menu navigation and global bubbling", () => {
    for (const key of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Enter"]) {
        const {calls, handleMenu} = menuFixture();
        const event = keyboardEvent(key);
        assert.equal(handleMenu(event), undefined, key);
        assert.deepEqual(calls, [], key);
        assert.equal(event.defaultPrevented, true, key);
        assert.equal(event.propagationStopped, false, key);
    }
});

test("modified arrows and Enter close the menu and continue to editor shortcuts", () => {
    for (const key of ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Enter"]) {
        for (const modifier of ["ctrlKey", "shiftKey", "altKey", "metaKey"]) {
            const {calls, handleMenu} = menuFixture();
            const event = keyboardEvent(key, {[modifier]: true});
            assert.equal(handleMenu(event), "continue", key);
            assert.deepEqual(calls, ["remove"], key);
            assert.equal(event.defaultPrevented, false, key);
            assert.equal(event.propagationStopped, false, key);
        }
    }
});

test("Escape remains available to the global menu dismissal handler", () => {
    const {calls, handleMenu} = menuFixture();
    const event = keyboardEvent("Escape");
    assert.equal(handleMenu(event), "continue");
    assert.deepEqual(calls, []);
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.propagationStopped, false);
});

const historyFixture = (menuHidden = false) => {
    const {menu, calls} = menuFixture(menuHidden);
    let listener: (event: ReturnType<typeof keyboardEvent>) => Promise<void>;
    const editorElement = {
        addEventListener: (type: string, callback: typeof listener) => {
            assert.equal(type, "keydown");
            listener = callback;
        },
    };
    const protyle = {
        disabled: false,
        selectElement: {classList: {contains: () => true}},
        wysiwyg: {element: editorElement, preventKeyup: true},
        undo: {
            undo: (editor: unknown) => {
                assert.equal(editor, protyle);
                assert.equal(menu.element.classList.contains("fn__none"), true);
                calls.push("undo");
            },
            redo: (editor: unknown) => {
                assert.equal(editor, protyle);
                assert.equal(menu.element.classList.contains("fn__none"), true);
                calls.push("redo");
            },
        },
    };
    const bind = compile(`${keydownDeclaration.getText(keydownSource)}\nexports.subject = keydown;`, {
        bindVerticalNavigationReset: (): void => undefined,
        handleDocumentBoundaryHotkey: () => false,
        handleReadonlyAttributeHotkey: () => false,
        getAVTemplateInteractiveElement: () => false,
        hasClosestByAttribute: () => false,
        matchHotKey: (binding: string, event: KeyboardEvent) => binding === event.key,
        getEditorRange: () => assert.fail("history and input guards must not read or repair the selection"),
        window: {siyuan: {menus: {menu}, config: {keymap: {editor: {general: {undo: "undo", redo: "redo"}}}}}},
    });
    bind(protyle, editorElement);
    const event = (key: string, overrides: Record<string, unknown> = {}) => keyboardEvent(key, {
        target: {
            localName: "div",
            closest: (selector: string) => selector === ".protyle-wysiwyg" ? editorElement : null,
        },
        ...overrides,
    });
    return {calls, menu, protyle, event, handle: (event: ReturnType<typeof keyboardEvent>) => listener(event)};
};

test("configured body undo and redo close the menu before using the document history", async () => {
    for (const command of ["undo", "redo"]) {
        for (const hidden of [false, true]) {
            for (const repeat of [false, true]) {
                const {calls, event, handle, protyle} = historyFixture(hidden);
                const keyEvent = event(command, {repeat});
                await handle(keyEvent);
                assert.deepEqual(calls, ["remove", command]);
                assert.equal(keyEvent.defaultPrevented, true);
                assert.equal(keyEvent.propagationStopped, true);
                assert.equal(protyle.wysiwyg.preventKeyup, false);
            }
        }
    }
});

test("readonly body leaves history, menu and keyboard event handling to the global dispatcher", async () => {
    for (const command of ["undo", "redo"]) {
        for (const hidden of [false, true]) {
            const {calls, menu, event, handle, protyle} = historyFixture(hidden);
            protyle.disabled = true;
            const keyEvent = event(command);
            await handle(keyEvent);
            assert.deepEqual(calls, []);
            assert.equal(menu.element.classList.contains("fn__none"), hidden);
            assert.equal(keyEvent.defaultPrevented, false);
            assert.equal(keyEvent.propagationStopped, false);
            assert.equal(protyle.wysiwyg.preventKeyup, true);
        }
    }
});

test("input targets and IME composition bypass body history and menu cleanup", async () => {
    for (const command of ["undo", "redo"]) {
        for (const target of ["input", "protyle-html", "composition"]) {
            const {calls, menu, event, handle, protyle} = historyFixture();
            const keyEvent = event(command, target === "composition" ? {isComposing: true} : {
                target: {localName: target, closest: () => assert.fail("input target must exit before editor lookup")},
            });
            await handle(keyEvent);
            assert.deepEqual(calls, []);
            assert.equal(menu.element.classList.contains("fn__none"), false);
            assert.equal(keyEvent.defaultPrevented, false);
            assert.equal(keyEvent.propagationStopped, true);
            assert.equal(protyle.wysiwyg.preventKeyup, true);
        }
    }
});

test("menu INPUT and TEXTAREA keep native undo and redo in ordinary and keymap inputs", () => {
    for (const tagName of ["INPUT", "TEXTAREA"]) {
        for (const keymapInput of [false, true]) {
            for (const command of ["undo", "redo"]) {
                for (const modifier of ["ctrlKey", "metaKey"]) {
                    const {menu, calls} = menuFixture();
                    const inputItem = {contains: (element: unknown) => element === target};
                    const target = {
                        tagName,
                        getAttribute: () => keymapInput ? "true" : null,
                        closest: () => ({children: [inputItem]}),
                    };
                    Object.assign(menu.element, {
                        contains: (element: unknown) => element === target,
                        querySelector: () => inputItem,
                    });
                    const globals = {
                        window: {siyuan: {menus: {menu}, config: {keymap: {editor: {general: {
                            undo: "undo", redo: "redo",
                        }}}}}},
                        Constants: {KEYCODELIST: {}, ATTRIBUTE_MENU_KEYMAP: "data-keymap", SIYUAN_CMD: "siyuan-cmd"},
                        matchHotKey: (binding: string, event: KeyboardEvent) => binding === event.key,
                        ipcRenderer: {send: (_channel: string, action: string) => calls.push(action)},
                    };
                    const electronUndo = loadFunction("src/protyle/undo/index.ts", "electronUndo", globals);
                    const handle = loadFunction("src/menus/Menu.ts", "bindMenuKeydown", {...globals, electronUndo});
                    const event = keyboardEvent(command, {target, [modifier]: true});
                    assert.equal(handle(event), false);
                    assert.deepEqual(calls, keymapInput ? [command] : []);
                    assert.equal(menu.element.classList.contains("fn__none"), false);
                    assert.equal(event.defaultPrevented, keymapInput);
                    assert.equal(event.propagationStopped, keymapInput);
                }
            }
        }
    }
});

const keyupFixture = (mac: boolean, text = "selected text", blockSelectionMode = false) => {
    const {menu} = menuFixture();
    const calls: string[] = [];
    let listener: (event: ReturnType<typeof keyboardEvent>) => void;
    const element = {
        addEventListener: (type: string, callback: typeof listener) => {
            assert.equal(type, "keyup");
            listener = callback;
        },
        querySelectorAll: (): unknown[] => [],
    };
    const range = {startContainer: {}, cloneRange: () => range, toString: () => text};
    const nodeElement = {classList: {contains: () => false}};
    const wysiwyg = {element, preventKeyup: false};
    const protyle = {
        wysiwyg,
        toolbar: {render: (editor: unknown, selectedRange: unknown) => {
            assert.equal(editor, protyle);
            assert.equal(selectedRange, range);
            calls.push("toolbar");
        }},
    };
    const bind = compile(`exports.subject = function (protyle) {
        let isComposition = false;
        let arrowStartElement;
        ${keyupBindings[0].getText(keyupSource)};
    };`, {
        getAVTemplateInteractiveElement: () => false,
        getEditorRange: () => range,
        hasClosestBlock: () => nodeElement,
        getBlockSelectionModeElement: () => blockSelectionMode ? nodeElement : false,
        isOnlyMeta: (event: KeyboardEvent) => mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey,
        countSelectWord: () => calls.push("count"),
        window: {siyuan: {menus: {menu}}},
    });
    bind.call(wysiwyg, protyle);
    return {calls, menu, wysiwyg, handle: (event: ReturnType<typeof keyboardEvent>) => listener(event)};
};

test("selection keyup keeps the toolbar hidden until the common menu closes", () => {
    for (const mac of [false, true]) {
        for (const key of ["Shift", "ArrowRight"]) {
            const {calls, menu, handle} = keyupFixture(mac);
            const event = keyboardEvent(key, key === "Shift" ? {[mac ? "metaKey" : "ctrlKey"]: true} : {
                shiftKey: true,
            });
            handle(event);
            assert.deepEqual(calls, []);
            assert.equal(event.defaultPrevented, false);
            assert.equal(event.propagationStopped, false);
            menu.remove();
            handle(event);
            assert.deepEqual(calls, ["toolbar", "count"]);
            assert.equal(event.defaultPrevented, false);
            assert.equal(event.propagationStopped, false);
        }
    }
});

test("selection keyup retains composition, empty selection and preventKeyup guards", () => {
    for (const guard of ["composition", "empty", "preventKeyup"]) {
        const {calls, menu, wysiwyg, handle} = keyupFixture(false, guard === "empty" ? "" : "selected text");
        menu.remove();
        wysiwyg.preventKeyup = guard === "preventKeyup";
        handle(keyboardEvent("Shift", {ctrlKey: true, isComposing: guard === "composition"}));
        assert.deepEqual(calls, [], guard);
        assert.equal(wysiwyg.preventKeyup, false, guard);
    }
});

test("block selection keyup preserves the menu without replacing block statistics with text statistics", () => {
    for (const mac of [false, true]) {
        for (const preventKeyup of [false, true]) {
            const {calls, menu, wysiwyg, handle} = keyupFixture(mac, "selected text", true);
            wysiwyg.preventKeyup = preventKeyup;
            const event = keyboardEvent("Shift", {[mac ? "metaKey" : "ctrlKey"]: true});
            handle(event);
            assert.deepEqual(calls, []);
            assert.equal(menu.element.classList.contains("fn__none"), false);
            assert.equal(wysiwyg.preventKeyup, false);
            assert.equal(event.defaultPrevented, false);
            assert.equal(event.propagationStopped, true);
        }
    }
});
