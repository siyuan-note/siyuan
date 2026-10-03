import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, forEachChild, isCallExpression, isVariableDeclaration, Node, ScriptTarget, transpileModule} from "typescript";
import {isMobileLandscape} from "./orientation";
import {getKeyboardPanelHeight} from "./keyboardPanelHeight";
import {shouldHideKeyboardAfterResize} from "./touchSelection";

const source = createSourceFile("keyboardToolbar.ts", readFileSync(join(__dirname, "keyboardToolbar.ts"), "utf8"), ScriptTarget.Latest);
let resizeSource: string;
let panelSource: string;
const visit = (node: Node) => {
    if (isCallExpression(node) && node.expression.getText(source) === "window.addEventListener" &&
        node.arguments[0].getText(source) === '"resize"' &&
        node.arguments[1].getText(source).includes("window.siyuan.mobile.size.isLandscape")) {
        resizeSource = node.arguments[1].getText(source);
    }
    if (isVariableDeclaration(node) && node.name.getText(source) === "updateKeyboardPanelHeight") {
        panelSource = node.initializer.getText(source);
    }
    forEachChild(node, visit);
};
visit(source);
assert.ok(resizeSource && panelSource);
const compile = (text: string) => transpileModule(`(${text})`, {
    compilerOptions: {target: ScriptTarget.ES2020},
}).outputText;

const createBrowser = () => ({
    screen: {orientation: {type: "portrait-primary"}, width: 800, height: 1200},
    innerWidth: 800,
    innerHeight: 1200,
    siyuan: {mobile: {size: {isLandscape: false, portrait: {height1: 1200, height2: 1200}}}},
});

test("portrait keyboard resizing updates only the portrait height cache", () => {
    const browser = createBrowser();
    const onResize = runInNewContext(compile(resizeSource), {
        window: browser,
        isMobileLandscape: () => isMobileLandscape(browser as unknown as typeof window),
        updateKeyboardToolbarPosition() {}, renderKeyboardToolbar() {},
        document: {activeElement: {tagName: "DIV", isContentEditable: true}},
        shouldHideKeyboardAfterResize, hasRecentAndroidTableCellSelectAll: () => false,
        activeBlur: () => assert.fail("keyboard-only resizing must keep editor focus"), preventRender: false,
    });
    for (const height of [450, 1200, 450]) {
        browser.innerHeight = height;
        onResize();
        assert.equal(browser.siyuan.mobile.size.isLandscape, false);
        assert.equal("landscape" in browser.siyuan.mobile.size, false);
        assert.equal(browser.siyuan.mobile.size.portrait.height1, 1200);
        assert.equal(browser.siyuan.mobile.size.portrait.height2, 450);
    }
});

test("a keyboard panel survives viewport aspect changes but closes on physical rotation", () => {
    const browser = createBrowser();
    let closed = 0;
    const toolbar = {style: {height: ""}, querySelector: () => ({clientHeight: 48})};
    const update = runInNewContext(compile(panelSource), {
        keyboardPanelTop: 400, keyboardPanelLandscape: false, keyboardPanelClosing: false,
        isMobileLandscape: () => isMobileLandscape(browser as unknown as typeof window),
        hideKeyboardToolbarUtil: () => closed++,
        document: {getElementById: () => toolbar},
        getKeyboardPanelHeight, getKeyboardViewportBottom: () => browser.innerHeight,
        isInMobileApp: () => false, getCurrentEditor: (): null => null,
    });
    browser.innerHeight = 450;
    update();
    assert.equal(closed, 0);
    assert.equal(toolbar.style.height, "50px");
    browser.screen.orientation.type = "landscape-primary";
    update();
    assert.equal(closed, 1);
});
