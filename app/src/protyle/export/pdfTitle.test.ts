import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import * as path from "node:path";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {toScriptLiteral} from "./scriptLiteral";

test("PDF preview titles use each language's unnamed document label and preserve named titles", async () => {
    const text = readFileSync(path.join(__dirname, "index.ts"), "utf8");
    const source = createSourceFile("export.ts", text, ScriptTarget.Latest, true);
    const render = source.statements.filter(isVariableStatement)
        .flatMap(statement => Array.from(statement.declarationList.declarations))
        .find(item => item.name.getText(source) === "renderPDF");
    assert.ok(render?.initializer);
    const code = transpileModule(`(${render.initializer.getText(source)})("document-id")`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText;
    const languageRoot = path.join(__dirname, "../../../appearance/langs");
    for (const filename of readdirSync(languageRoot).filter(name => name.endsWith(".json"))) {
        const languages = JSON.parse(readFileSync(path.join(languageRoot, filename), "utf8"));
        let html = "";
        await runInNewContext(code, {
            window: {siyuan: {languages, storage: {pdf: {}}, config: {appearance: {themeLight: "daylight"},
                editor: {}, export: {}, system: {}}}},
            Constants: {LOCAL_EXPORTPDF: "pdf"},
            ipcRenderer: {invoke: async () => 1},
            getAvailableExportPath: async () => "",
            setInlineStyle: async () => "",
            getHostCapabilities: () => ({}),
            getPluginStyle: async () => "",
            getSnippetCSS: () => "",
            getSnippetJS: () => "",
            getIconScript: () => "",
            getExportLanguages: () => "{}",
            toScriptLiteral,
            headingPageBreakControls: () => "",
            fetchPost: (url: string, data: {content: string}) => {
                assert.equal(url, "/api/export/exportTempContent");
                html = data.content;
            },
        });
        const assignment = html.match(/^\s*document\.title\s*=.+$/m)?.[0];
        assert.ok(assignment, filename);
        assert.ok(!assignment.includes("</script>"), "localized titles cannot close the generated script");
        for (const name of ["", "Named document", "标题 </script> & \"quotes\""]) {
            const document = {title: "Export PDF"};
            runInNewContext(assignment, {response: {data: {name}}, document});
            assert.equal(document.title, name || languages._kernel[16], filename);
        }
    }
});
