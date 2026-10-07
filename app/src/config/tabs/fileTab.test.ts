import * as assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import * as ts from "typescript";
import {controlBoolean} from "../setting/control";
import {genSwitchRow} from "../render/fragments";

const loadBehaviorSettings = (parentEnabled: boolean, childEnabled?: boolean) => {
    const fileTree = {parentDocClickExpand: parentEnabled, parentDocDoubleClickOpen: childEnabled};
    const languages = {parentDocClickExpand: "Expand parent title", parentDocClickExpandTip: "Toggle child documents",
        parentDocDoubleClickOpen: "Double-click to open", parentDocDoubleClickOpenTip: "Wait about 300 ms"};
    const saved: unknown[][] = [];
    let item: {keywords: string[], html(): string, afterMount(root: unknown): void,
        controls: {control: ReturnType<typeof controlBoolean>, save?: (value: boolean) => void}[]};
    const source = readFileSync(join(__dirname, "fileTab.ts"), "utf8") + "\nexport {registerFileTreeBehaviorGroup};";
    const code = ts.transpileModule(source, {
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020},
    }).outputText;
    const exports: {registerFileTreeBehaviorGroup?: (tab: unknown) => void} = {};
    runInNewContext(code, {
        exports, CSS: {escape: (text: string) => text}, window: {siyuan: {config: {fileTree}, languages}},
        require: (name: string) => {
            if (name.endsWith("/control")) return {controlBoolean};
            if (name.endsWith("/fragments")) return {genSwitchRow};
            if (name.endsWith("/fileRuntime")) return {fileConfigApi: {patch: (...args: unknown[]) => saved.push(args)}};
            return {};
        },
    });
    exports.registerFileTreeBehaviorGroup({group: () => ({switch() {}, composite: (spec: typeof item) => { item = spec; }})});
    return {item, languages, saved};
};

test("double-click opening is a searchable child control and missing preferences inherit enabled", () => {
    const {item, languages} = loadBehaviorSettings(false);
    assert.equal(item.controls[0].control.id, "fileTree.parentDocClickExpand");
    assert.equal(item.controls[1].control.id, "fileTree.parentDocDoubleClickOpen");
    assert.equal(item.controls[1].control.readConfig(), true);
    const html = item.html();
    assert.equal(html.match(/b3-label--inner/g)?.length, 2);
    assert.match(html, /config-filetree-click__child/);
    assert.match(html, /id="fileTree.parentDocDoubleClickOpen" type="checkbox" checked disabled/);
    assert.ok(item.keywords.includes(languages.parentDocDoubleClickOpen));
    assert.ok(item.keywords.includes(languages.parentDocDoubleClickOpenTip));
});

test("parent toggling enables its child without clearing the child's saved choice", () => {
    for (const checked of [false, true]) {
        const {item, saved} = loadBehaviorSettings(false, checked);
        const parent = {checked: false, addEventListener: (_name: string, listener: () => void) => { change = listener; }};
        const child = {checked, disabled: false};
        let change: () => void;
        item.afterMount({querySelector: (selector: string) => selector.includes("parentDocClickExpand") ? parent : child});
        assert.equal(child.disabled, true);
        parent.checked = true;
        change();
        assert.equal(child.disabled, false);
        assert.equal(child.checked, checked);
        parent.checked = false;
        change();
        assert.equal(child.disabled, true);
        assert.equal(child.checked, checked);
        assert.equal(saved.length, 0);
        item.controls[0].save(true);
        assert.equal(saved[0][0], "parentDocClickExpand");
        assert.equal(saved[0][1], true);
    }
});
