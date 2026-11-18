import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {compile, Logger} from "sass";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {canRunBrowser, runBrowserCase} from "../../datePicker/test/browser";

test("locking the focused editor preserves shortcut focus without outlining its container", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const sourcePath = join(__dirname, "onGet.ts");
    const source = createSourceFile(sourcePath, readFileSync(sourcePath, "utf8"), ScriptTarget.ES2021, true);
    const declaration = source.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(item => item.name.getText(source) === "disabledProtyle"));
    assert.ok(declaration);
    const code = readFileSync(join(__dirname, "disabledWYSIWYG.ts"), "utf8") + "\n" + declaration.getText(source);
    const compiled = transpileModule(code.replace(/^export /gm, ""), {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const css = compile(join(__dirname, "../../assets/scss/protyle/_content.scss"), {logger: Logger.silent}).css;
    const result = await runBrowserCase(async (sources, styles) => {
        Object.assign(window, {siyuan: {mobile: {}, menus: {menu: {remove() {}}}}});
        const disable = new Function("hideElements", "syncRelatedAVEditor", "refreshCalendarReadonly",
            "hideTooltip", "updateMobileTitleReadonly", sources.disable + "\nreturn disabledProtyle;")(
            () => {}, () => {}, () => {}, () => {}, () => {},
        );
        const style = document.createElement("style");
        document.head.append(style);
        document.body.innerHTML = '<main class="protyle" tabindex="-1" style="width:320px;font-size:48px">' +
            '<div class="protyle-wysiwyg" contenteditable="true">Paragraph</div>' +
            '<button>Editor action</button><input aria-label="Editor field"></main>';
        const panel = document.querySelector<HTMLElement>(".protyle");
        const body = panel.querySelector<HTMLElement>(".protyle-wysiwyg");
        let protyle: {element: HTMLElement, wysiwyg: {element: HTMLElement}, disabled: boolean};
        let shortcuts = 0;
        window.addEventListener("keydown", event => {
            if (event.key === "F9") {
                event.preventDefault();
                disable(protyle);
            } else if (event.key === "F8" && (event.target as HTMLElement).closest(".protyle")) {
                shortcuts++;
            }
        });
        Object.assign(window, {verifyReadonlyFocus: (theme: string) => {
            style.textContent = sources[theme] + styles;
            body.contentEditable = "true";
            protyle = {element: panel, wysiwyg: {element: body}, disabled: false};
            body.focus();
        }, inspectReadonlyFocus: () => {
            const focused = document.activeElement === panel;
            const outline = getComputedStyle(panel).outlineStyle;
            const field = panel.querySelector("input");
            field.focus();
            return {focused, outline, fieldOutline: getComputedStyle(field).outlineStyle !== "none"};
        }, readonlyShortcutCount: () => shortcuts});
        return "ready";
    }, {
        disable: compiled,
        daylight: readFileSync(join(__dirname, "../../../appearance/themes/daylight/theme.css"), "utf8"),
        midnight: readFileSync(join(__dirname, "../../../appearance/themes/midnight/theme.css"), "utf8"),
    }, css, {interact: async win => {
        const results = [];
        for (const theme of ["daylight", "midnight"]) {
            await win.webContents.executeJavaScript(`window.verifyReadonlyFocus(${JSON.stringify(theme)})`);
            for (const keyCode of ["F9", "F8"]) {
                win.webContents.sendInputEvent({type: "keyDown", keyCode});
                win.webContents.sendInputEvent({type: "keyUp", keyCode});
            }
            results.push(await win.webContents.executeJavaScript("window.inspectReadonlyFocus()"));
        }
        return JSON.stringify({results, shortcuts: await win.webContents.executeJavaScript("window.readonlyShortcutCount()")});
    }});
    const actual = JSON.parse(result);
    assert.equal(actual.shortcuts, 2);
    assert.deepEqual(actual.results, [
        {focused: true, outline: "none", fieldOutline: true},
        {focused: true, outline: "none", fieldOutline: true},
    ]);
});
