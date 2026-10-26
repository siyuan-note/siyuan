import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isClassDeclaration, ScriptTarget, transpileModule} from "typescript";

for (const sourcePath of ["src/layout/dock/Files.ts", "src/mobile/dock/MobileFiles.ts"]) {
    const source = createSourceFile(sourcePath, readFileSync(sourcePath, "utf8"), ScriptTarget.ES2021, true);
    const declaration = source.statements.find(isClassDeclaration);
    const methods = declaration.members.filter(member =>
        ["onRename", "onFiletreeSortChanged"].includes(member.name?.getText(source))
    ).map(member => member.getText(source)).join("\n");
    const compiled = transpileModule(`class Handler {${methods}} exports.Handler = Handler;`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;

    for (const parentPath of ["/", "/parent/child"]) {
        test(`${sourcePath}: renaming an unmounted row refreshes notebook ordering and metadata in ${parentPath}`, () => {
            const exports: {Handler?: new () => {
                docTree: {reload: (filter: {notebook: string}) => Promise<void>};
                element: {querySelector: () => never};
                onRename: (data: {box: string, path: string, title: string}) => void;
                onFiletreeSortChanged: (data: {notebook: string, parentPath: string}) => void;
            }} = {};
            runInNewContext(compiled, {exports});
            const handler = new exports.Handler();
            const requests: {notebook: string, parentID?: string}[] = [];
            handler.docTree = {reload: async filter => { requests.push(filter); }};
            handler.element = {querySelector: () => { throw new Error("An unmounted row has no DOM lookup"); }};
            handler.onRename({box: "notebook", path: `${parentPath}/document.sy`, title: "<new"});
            const expected = {notebook: "notebook", parentID: parentPath === "/" ? "" : "child"};
            assert.equal(JSON.stringify(requests), JSON.stringify([expected]));
            handler.onFiletreeSortChanged({notebook: "notebook", parentPath});
            assert.equal(JSON.stringify(requests), JSON.stringify([expected, expected]));
        });
    }
}
