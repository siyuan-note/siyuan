import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, createSourceFile, isIfStatement, transpileModule} from "typescript";

const source = createSourceFile("keydown.ts", readFileSync("src/protyle/wysiwyg/keydown.ts", "utf8"),
    ScriptTarget.ES2021, true);
let tabBranch: import("typescript").IfStatement;
const findTabBranch = (node: import("typescript").Node) => {
    if (isIfStatement(node) &&
        node.expression.getText(source) === 'event.key === "Tab" && isNotCtrl(event) && !event.altKey') {
        tabBranch = node;
    }
    node.forEachChild(findTabBranch);
};
source.forEachChild(findTabBranch);
assert.ok(tabBranch);

const compiled = transpileModule(`const handleTab = (event, range, nodeElement, endElement, protyle) => {
    const blockSelectionModeElement = undefined;
    ${tabBranch.getText(source)}
};
handleTab;`, {compilerOptions: {module: ModuleKind.None, target: ScriptTarget.ES2021}}).outputText;

const setup = () => {
    const blocks = ["1", "2", "3", "4", "5", "6"];
    const commands: Array<{name: string, value: string}> = [];
    const codeBlockTabs: boolean[] = [];
    const handleTab = runInNewContext(compiled, {
        isNotCtrl: () => true,
        document: {execCommand: (name: string, _showUI: boolean, value: string) => {
            commands.push({name, value});
            blocks.splice(1, 4);
        }},
        window: {siyuan: {config: {editor: {codeTabSpaces: 4}}}},
        tabCodeBlock: (_protyle: unknown, _block: unknown, _range: unknown, outdent: boolean) => {
            codeBlockTabs.push(outdent);
        },
    }) as (event: KeyboardEvent, range: Range, nodeElement: HTMLElement, endElement: HTMLElement,
           protyle: IProtyle) => boolean;
    const event = {
        key: "Tab",
        altKey: false,
        shiftKey: false,
        defaultPrevented: false,
        preventDefault() {
            this.defaultPrevented = true;
        },
    } as KeyboardEvent;
    const paragraph = {getAttribute: () => "NodeParagraph"} as unknown as HTMLElement;
    const codeBlock = {getAttribute: () => "NodeCodeBlock"} as unknown as HTMLElement;
    return {blocks, commands, codeBlockTabs, handleTab, event, paragraph, codeBlock};
};

test("Tab keeps a cross-block text selection and all selected blocks intact", () => {
    const {blocks, commands, handleTab, event, paragraph} = setup();
    const result = handleTab(event, {collapsed: false} as Range, paragraph,
        {getAttribute: () => "NodeParagraph"} as unknown as HTMLElement, {} as IProtyle);
    assert.equal(result, true);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(blocks, ["1", "2", "3", "4", "5", "6"]);
    assert.equal(commands.length, 0);
});

test("Tab still inserts spaces in one paragraph and indents one code block", () => {
    const {commands, codeBlockTabs, handleTab, event, paragraph, codeBlock} = setup();
    assert.equal(handleTab(event, {collapsed: false} as Range, paragraph, paragraph, {} as IProtyle), true);
    assert.deepEqual(commands, [{name: "insertHTML", value: "    "}]);
    assert.equal(handleTab(event, {collapsed: false} as Range, codeBlock, codeBlock, {} as IProtyle), true);
    assert.deepEqual(codeBlockTabs, [false]);
});
