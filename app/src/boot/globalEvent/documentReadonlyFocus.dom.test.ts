import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import test from "node:test";
import {createSourceFile, isClassDeclaration, isMethodDeclaration, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {canRunBrowser, runBrowserCase} from "../../datePicker/test/browser";

test("clicking the readonly document after a file tree menu action restores its shortcut target", {
    timeout: 45000, skip: !canRunBrowser,
}, async () => {
    const editorPath = join(__dirname, "../../editor/index.ts");
    const editor = createSourceFile(editorPath, readFileSync(editorPath, "utf8"), ScriptTarget.ES2021, true);
    const editorClass = editor.statements.find(isClassDeclaration);
    const initProtyle = editorClass.members.find(member => isMethodDeclaration(member) && member.name.getText(editor) === "initProtyle");
    assert.ok(initProtyle);
    const keydownPath = join(__dirname, "keydown.ts");
    const keydown = createSourceFile(keydownPath, readFileSync(keydownPath, "utf8"), ScriptTarget.ES2021, true);
    const dispatch = keydown.statements.find(statement => isVariableStatement(statement) &&
        statement.declarationList.declarations.some(declaration => declaration.name.getText(keydown) === "windowKeyDown"));
    assert.ok(isVariableStatement(dispatch));
    const compile = (source: string) => transpileModule(source, {compilerOptions: {target: ScriptTarget.ES2021}}).outputText;
    const result = await runBrowserCase(async sources => {
        document.body.innerHTML = '<aside class="sy__file layout__tab--active"><button id="file">Document</button></aside>' +
            '<main class="protyle"><div class="protyle-wysiwyg" contenteditable="false">Readonly paragraph</div></main>' +
            '<div class="b3-menu"><button id="copy">Copy ID</button></div>';
        const panel = document.querySelector<HTMLElement>(".protyle");
        const Editor = new Function("Protyle", sources.editor)(
            class { protyle = {element: panel}; }
        );
        new Editor(panel);
        const calls: string[] = [];
        const windowKeyDown = new Function("editKeydown", "fileTreeKeydown", sources.dispatch)(
            (_app: unknown, event: KeyboardEvent) => {
                if (event.key === "g") {
                    calls.push("editor");
                    event.preventDefault();
                    return true;
                }
            },
            (_app: unknown, event: KeyboardEvent) => {
                if (event.key === "g") {
                    calls.push("files");
                    return true;
                }
            }
        );
        window.addEventListener("keydown", event => windowKeyDown({}, event));
        document.getElementById("copy").addEventListener("click", event => {
            (event.target as HTMLElement).closest(".b3-menu").remove();
        });
        Object.assign(window, {readonlyFocusCalls: calls});
        return "ready";
    }, {
        editor: compile(`class Editor {
            constructor(public element: HTMLElement) { this.initProtyle({blockId: "doc", rootId: "doc"}); }
            ${initProtyle.getText(editor)}
        }; return Editor;`),
        dispatch: compile(`let switchDialog;
            const filterHotkey = event => event.key !== "g";
            const searchKeydown = () => false, bindMenuKeydown = () => false, bindAVPanelKeydown = () => false;
            const isWindow = () => false, handleDatabaseRowShortcut = () => false;
            const ${dispatch.declarationList.declarations[0].getText(keydown)};
            return windowKeyDown;`),
    }, "", {interact: async win => {
        const click = async (selector: string) => {
            const point = await win.webContents.executeJavaScript(`(() => {
                const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
                return {x: Math.round(rect.left + 15), y: Math.round(rect.top + rect.height / 2)};
            })()`);
            win.webContents.sendInputEvent({type: "mouseDown", button: "left", clickCount: 1, ...point});
            win.webContents.sendInputEvent({type: "mouseUp", button: "left", clickCount: 1, ...point});
        };
        const shortcut = async () => {
            win.webContents.sendInputEvent({type: "keyDown", keyCode: "G", modifiers: ["control"]});
            win.webContents.sendInputEvent({type: "keyUp", keyCode: "G", modifiers: ["control"]});
        };
        await click("#copy");
        await click(".protyle-wysiwyg");
        await shortcut();
        await click("#file");
        await shortcut();
        return win.webContents.executeJavaScript("JSON.stringify(window.readonlyFocusCalls)");
    }});
    assert.deepEqual(JSON.parse(result), ["editor", "files"]);
});
