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

const compiled = transpileModule(`const handleTab = async (event, range, nodeElement, endElement, protyle) => {
    const blockSelectionModeElement = undefined;
    ${tabBranch.getText(source)}
};
handleTab;`, {compilerOptions: {module: ModuleKind.None, target: ScriptTarget.ES2021}}).outputText;

const setup = (codeTabSpaces = 4) => {
    const commands: Array<{name: string, value: string}> = [];
    const codeBlockTabs: boolean[] = [];
    const replacements: Array<{range: Range, start: HTMLElement, end: HTMLElement,
        skipRefCheck: boolean, text: string}> = [];
    const handleTab = runInNewContext(compiled, {
        isNotCtrl: () => true,
        document: {execCommand: (name: string, _showUI: boolean, value: string) => {
            commands.push({name, value});
        }},
        window: {siyuan: {config: {editor: {codeTabSpaces}}}},
        removeCrossBlockRange: async (_protyle: IProtyle, range: Range, start: HTMLElement,
                                      end: HTMLElement, skipRefCheck: boolean, replacement: {text: string}) => {
            replacements.push({range, start, end, skipRefCheck, text: replacement.text});
        },
        tabCodeBlock: (_protyle: unknown, _block: unknown, _range: unknown, outdent: boolean) => {
            codeBlockTabs.push(outdent);
        },
    }) as (event: KeyboardEvent, range: Range, nodeElement: HTMLElement, endElement: HTMLElement,
           protyle: IProtyle) => Promise<boolean>;
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
    return {commands, replacements, codeBlockTabs, handleTab, event, paragraph, codeBlock};
};

test("Tab replaces cross-block text through the merging removal path", async () => {
    const {commands, replacements, handleTab, event, paragraph} = setup();
    const range = {collapsed: false} as Range;
    const end = {getAttribute: () => "NodeParagraph"} as unknown as HTMLElement;
    const result = await handleTab(event, range, paragraph, end, {} as IProtyle);
    assert.equal(result, true);
    assert.equal(event.defaultPrevented, true);
    assert.equal(commands.length, 0);
    assert.equal(replacements.length, 1);
    assert.equal(replacements[0].range, range);
    assert.equal(replacements[0].start, paragraph);
    assert.equal(replacements[0].end, end);
    assert.equal(replacements[0].skipRefCheck, false);
    assert.equal(replacements[0].text, "    ");
});

test("cross-block Tab honors literal tabs while Shift+Tab preserves the selection", async () => {
    const {commands, replacements, handleTab, event, paragraph} = setup(0);
    const end = {getAttribute: () => "NodeParagraph"} as unknown as HTMLElement;
    await handleTab(event, {collapsed: false} as Range, paragraph, end, {} as IProtyle);
    assert.equal(replacements[0].text, "\t");
    await handleTab({...event, shiftKey: true}, {collapsed: false} as Range, paragraph, end, {} as IProtyle);
    assert.equal(replacements.length, 1);
    assert.equal(commands.length, 0);
});

test("Tab still inserts spaces in one paragraph and indents one code block", async () => {
    const {commands, codeBlockTabs, handleTab, event, paragraph, codeBlock} = setup();
    assert.equal(await handleTab(event, {collapsed: false} as Range, paragraph, paragraph, {} as IProtyle), true);
    assert.deepEqual(commands, [{name: "insertHTML", value: "    "}]);
    assert.equal(await handleTab(event, {collapsed: false} as Range, codeBlock, codeBlock, {} as IProtyle), true);
    assert.deepEqual(codeBlockTabs, [false]);
});
