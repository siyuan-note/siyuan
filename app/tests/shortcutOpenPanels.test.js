const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const {runInNewContext} = require("node:vm");
const ts = require("typescript");
const {parse} = require("ifdef-loader/preprocessor");

const sourceFile = file => ts.createSourceFile(file, readFileSync(path.join(__dirname, "../src", file), "utf8"),
    ts.ScriptTarget.Latest, true);
const find = (source, predicate) => {
    let result;
    const visit = node => {
        if (!result && predicate(node)) {
            result = node;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(result);
    return result;
};
const arrow = (source, name) => find(source, node => ts.isVariableDeclaration(node) &&
    node.name.getText(source) === name).initializer;
const evaluate = (text, scope) => {
    const exports = {};
    runInNewContext(ts.transpileModule(text, {compilerOptions: {module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022}}).outputText, {exports, ...scope});
    return exports;
};
// 运行入口的实际重复打开分支，在首次打开的渲染和请求之前终止。
const prefix = (source, fn, marker, scope) => {
    const end = fn.body.statements.findIndex(node => node.getText(source).startsWith(marker));
    assert.ok(end >= 0);
    return evaluate(`exports.subject = async function(${fn.parameters.map(node => node.getText(source)).join(",")}) {
        ${fn.body.statements.slice(0, end).map(node => node.getText(source)).join("\n")}
        throw new Error("An existing panel must not be rendered again");
    };`, scope).subject;
};
const hiddenElement = (hidden = true) => ({classList: {contains: () => hidden}});

for (const [file, name, marker, args] of [
    ["business/openRecentDocs.ts", "openRecentDocs", "const sortBy", openOnly => [openOnly]],
    ["history/history.ts", "openHistory", "const localHistory", openOnly => [{}, "doc", openOnly]],
    ["card/openCard.ts", "openCardByData", "let lastRange", openOnly => [{}, {}, "doc", "id", "title", openOnly]],
    ["menus/workspace.ts", "workspaceMenu", "let remoteConnections", openOnly => [{}, {}, openOnly]],
]) {
    test(`${name} retains the open panel for shortcuts and toggles for mouse entry`, async () => {
        let closes = 0;
        const element = {...hiddenElement(false), getAttribute: () => "panel", querySelector: () => ({})};
        const item = {element, destroy: () => closes++};
        const window = {siyuan: {config: {}, dialogs: [item], menus: {menu: {element, remove: () => closes++}}}};
        const source = sourceFile(file);
        const subject = prefix(source, arrow(source, name), marker, {window,
            Constants: {DIALOG_RECENTDOCS: "panel", DIALOG_OPENCARD: "panel", MENU_BAR_WORKSPACE: "panel"},
            hideElements: () => closes++});
        await subject(...args(true));
        assert.equal(closes, 0);
        await subject(...args(false));
        assert.equal(closes, 1);
    });
}

test("tab list and inline appearance retain their existing shortcut panel", async () => {
    let closes = 0;
    const source = sourceFile("layout/Wnd.ts");
    const method = find(source, node => ts.isMethodDeclaration(node) && node.name.getText(source) === "renderTabList");
    const subject = prefix(source, method, "window.siyuan.menus.menu.remove();", {
        window: {siyuan: {menus: {menu: {element: {...hiddenElement(false), getAttribute: () => "tabs"},
            remove: () => closes++}}}}, Constants: {MENU_TAB_LIST: "tabs"},
    });
    const wnd = {headersElement: {children: [{}]}};
    await subject.call(wnd, {}, true);
    assert.equal(closes, 0);
    await subject.call(wnd, {}, false);
    assert.equal(closes, 1);
    const font = sourceFile("protyle/toolbar/Font.ts");
    const binding = find(font, node => ts.isCallExpression(node) &&
        node.expression.getText(font) === "this.element.addEventListener" && node.arguments[0]?.text === "click");
    const subElement = {dataset: {subElementSource: "selection"}, classList: {contains: () => false, add() {}}};
    const click = prefix(font, binding.arguments[1], "closeSubElement(protyle.toolbar);", {
        protyle: {toolbar: {subElement}}, SELECTION_TOOLBAR_SUB_ELEMENT_SOURCE: "selection", CustomEvent,
        closeSubElement: () => closes++, focusByRange() {},
    });
    await click(new CustomEvent("click", {detail: {openOnly: true}}));
    assert.equal(closes, 1);
    await click(new Event("click"));
    assert.equal(closes, 2);
});

test("native shortcut sources open panels without toggling while menu commands retain their behavior", async () => {
    const source = sourceFile("command/nativeRuntime.ts");
    const calls = [];
    const subject = prefix(source, arrow(source, "executeLegacyNativeCommand"), "const isFileFocus", {
        globalCommand: (...args) => {calls.push(args); return true;},
    });
    for (const commandSource of ["shortcut", "editorShortcut", "fileTreeShortcut", "dockShortcut", "globalShortcut", "keymap", "menu", "api", "commandPanel"]) {
        await subject("recentDocs", {app: {}, source: commandSource});
        assert.equal(calls.at(-1)[3], !["menu", "api", "commandPanel"].includes(commandSource));
    }
    const dispatches = [];
    const handlers = Object.fromEntries(["workspaceMenu", "openRecentDocs", "openHistory", "openCard"]
        .map(name => [name, (...args) => dispatches.push({name, args})]));
    const compiled = parse(sourceFile("boot/globalEvent/command/global.ts").text,
        {MOBILE: false, BROWSER: true}, false, true);
    const {globalCommand} = evaluate(compiled, {require: () => new Proxy(handlers, {get: (target, key) =>
        target[key] || (() => false)}), document: {querySelector: () => ({getBoundingClientRect: () => ({})})}});
    for (const command of ["mainMenu", "recentDocs", "dataHistory", "riffCard"]) {
        assert.equal(globalCommand(command, {}, undefined, true), true);
        assert.equal(dispatches.at(-1).args.at(-1), true);
    }
});

test("Ctrl+E and Alt+0 keep their dialogs open through the actual global keydown branches", async () => {
    const keymap = evaluate(sourceFile("util/keymapBindings.ts").text, {});
    const Constants = {DIALOG_RECENTDOCS: "recent", DIALOG_OPENCARD: "card", KEYCODELIST: {69: "E", 48: "0"}};
    const {matchHotKey} = evaluate(sourceFile("protyle/util/hotKey.ts").text, {
        require: name => name.endsWith("keymapBindings") ? keymap : name.endsWith("constants") ? {Constants} : {
            isMac: () => false, isNotCtrl: event => !event.ctrlKey && !event.metaKey,
            isOnlyMeta: event => event.ctrlKey && !event.metaKey,
        },
    });
    const source = sourceFile("boot/globalEvent/keydown.ts");
    for (const [command, key, eventFlags] of [
        ["recentDocs", "⌘E", {key: "e", keyCode: 69, ctrlKey: true}],
        ["riffCard", "⌥0", {key: "0", keyCode: 48, altKey: true}],
    ]) {
        const branch = find(source, node => ts.isIfStatement(node) &&
            node.expression.getText(source).includes(`keymap.general.${command}, event`));
        let closes = 0;
        let blurs = 0;
        const pending = [];
        const window = {siyuan: {config: {keymap: {general: {[command]: {custom: key}}}},
            dialogs: [{element: {getAttribute: () => command === "recentDocs" ? "recent" : "card"},
                destroy: () => closes++}]}};
        const recentSource = sourceFile("business/openRecentDocs.ts");
        const recent = prefix(recentSource, arrow(recentSource, "openRecentDocs"), "const sortBy", {
            window, Constants, hideElements: () => closes++,
        });
        const cardSource = sourceFile("card/openCard.ts");
        const card = prefix(cardSource, arrow(cardSource, "openCardByData"), "let lastRange", {window, Constants});
        const openCard = evaluate(`exports.openCard = ${arrow(cardSource, "openCard").getText(cardSource)};`, {
            window, fetchPost: (_url, _data, callback) => callback({data: {}}),
            openCardByData: (...args) => pending.push(card(...args)),
        }).openCard;
        const handler = evaluate(`exports.subject = function(event) {${branch.getText(source)}};`, {
            app: {}, window, Constants, isTabWindow: false, matchHotKey,
            document: {activeElement: {blur: () => blurs++}}, openCard,
            openRecentDocs: (...args) => pending.push(recent(...args)),
        }).subject;
        for (const repeat of [false, true]) {
            const event = {ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
                repeat, ...eventFlags, preventDefault() {this.defaultPrevented = true;}};
            handler(event);
            await Promise.all(pending);
            assert.equal(event.defaultPrevented, true);
            assert.equal(closes, 0);
            assert.equal(blurs, 0);
            assert.equal(window.siyuan.dialogs.length, 1);
        }
    }
});
