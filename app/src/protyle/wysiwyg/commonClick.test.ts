import * as assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {test} from "node:test";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

test("title backlink contexts open their source title editor on desktop and mobile", async () => {
    const source = transpileModule(readFileSync(join(__dirname, "commonClick.ts"), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    for (const mobile of [false, true]) {
        const opened: object[] = [];
        const moduleExports: {commonClick?: (event: object, protyle: object) => boolean} = {};
        runInNewContext(source, {
            exports: moduleExports,
            require: (name: string) => {
                if (name === "../../util/functions") return {isMobile: () => mobile};
                if (name === "../util/hasClosest") return {hasClosestByClassName: () => false};
                if (name === "../header/documentTitleDialog") return {openDocumentTitleDialog: (options: object) => opened.push(options)};
                return {};
            },
        });
        let prevented = false;
        const event = {target: {closest: () => ({dataset: {nodeId: "source-document"}})},
            preventDefault: () => { prevented = true; }, stopPropagation: () => {}};
        assert.equal(moduleExports.commonClick(event, {notebookId: "reference-target-notebook"}), true);
        await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(prevented, true);
        assert.deepEqual(JSON.parse(JSON.stringify(opened)), [{id: "source-document"}],
            "the source resolves its own notebook; backlink target context must not be reused");
    }
});
