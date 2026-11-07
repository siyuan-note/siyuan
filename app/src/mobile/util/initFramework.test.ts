import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const compile = (file: string, suffix = "") => transpileModule(
    readFileSync(resolve(__dirname, file), "utf8") + suffix,
    {compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021}},
).outputText;

for (const rootID of ["document", "box"]) {
    test(`mobile ${rootID === "box" ? "notebook document" : "document"} summaries open full title source without plain writes`, () => {
        const listeners = new Map<string, (event?: object) => void>();
        let opened = 0;
        let requests = 0;
        const input = {
            value: "Summary", blur: () => listeners.get("blur")?.(), getAttribute: (): undefined => undefined, setAttribute: () => {},
            addEventListener: (name: string, handler: (event?: object) => void) => listeners.set(name, handler),
        };
        const protyle = {notebookId: "box", block: {rootID}, disabled: false,
            preview: {element: {classList: {contains: () => true}}},
            title: {openEditor: () => opened++}};
        const runtime = {siyuan: {config: {editor: {autoDirection: false}},
            languages: {_kernel: {16: "Untitled"}}, mobile: {editor: {protyle}}}};
        const moduleExports: {initEditorName?: () => void} = {};
        runInNewContext(compile("initFramework.ts", "\nexport {initEditorName};"), {
            exports: moduleExports, window: runtime, document: {getElementById: (id: string) =>
                id === "toolbarName" ? input : {addEventListener: (name: string, handler: (event?: object) => void) =>
                    listeners.set("label:" + name, handler)}},
            require: (name: string) => {
                if (name === "../../util/fetch") return {fetchPost: () => requests++};
                if (name === "../../protyle/render/autoDirection") return {setTitleAutoDirection: () => {}};
                return {};
            },
        });
        moduleExports.initEditorName();
        input.value = "A derived summary must not replace rich source";
        listeners.get("blur")?.();
        listeners.get("click")();
        listeners.get("keydown")({key: "Enter", preventDefault: () => {}, stopPropagation: () => {}});
        assert.equal(opened, 2);
        const target = {closest: (): null => null};
        listeners.get("label:click")({target, preventDefault: () => {}});
        listeners.get("label:keydown")({target, key: " ", preventDefault: () => {}});
        assert.equal(opened, 4);
        assert.equal(requests, 0);
        const inlineTarget = {closest: () => ({})};
        listeners.get("label:click")({target: inlineTarget, preventDefault: () => assert.fail("inline clicks retain native selection")});
        listeners.get("label:keydown")({target: inlineTarget, key: " ", preventDefault: () => assert.fail("inline spaces stay editable")});
        assert.equal(opened, 4, "inline editor interactions do not reopen the title");
        protyle.disabled = true;
        listeners.get("click")();
        listeners.get("label:click")({target, preventDefault: () => {}});
        assert.equal(opened, 4);
    });
}
