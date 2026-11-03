import * as assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import * as path from "node:path";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {createSourceFile, isVariableStatement, ScriptTarget, transpileModule} from "typescript";
import {toScriptLiteral} from "./scriptLiteral";

test("PDF previews preserve localized titles and suggest safe filenames in the remembered directory", async () => {
    const rename = createSourceFile("rename.ts", readFileSync(path.join(__dirname, "../../editor/rename.ts"), "utf8"),
        ScriptTarget.Latest, true);
    const sanitizer = rename.statements.filter(isVariableStatement)
        .flatMap(statement => Array.from(statement.declarationList.declarations))
        .find(item => item.name.getText(rename) === "replaceLocalPath");
    assert.ok(sanitizer?.initializer);
    const replaceLocalPath = runInNewContext(transpileModule(`(${sanitizer.initializer.getText(rename)})`, {
        compilerOptions: {target: ScriptTarget.ES2021},
    }).outputText) as (name: string) => string;
    const defaultDirectory = path.resolve("pdf-exports");
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
            getAvailableExportPath: async () => defaultDirectory,
            setInlineStyle: async () => "",
            getHostCapabilities: () => ({}),
            getPluginStyle: async () => "",
            getSnippetCSS: () => "",
            getSnippetJS: () => "",
            getIconScript: () => "",
            getExportLanguages: () => "{}",
            toScriptLiteral,
            replaceLocalPath,
            headingPageBreakControls: () => "",
            fetchPost: (url: string, data: {content: string}) => {
                assert.equal(url, "/api/export/exportTempContent");
                html = data.content;
            },
        });
        const assignment = html.match(/^\s*document\.title\s*=.+$/m)?.[0];
        assert.ok(assignment, filename);
        assert.ok(!assignment.includes("</script>"), "localized titles cannot close the generated script");
        const dialog = html.slice(html.indexOf("            const defaultPath ="),
            html.indexOf("            const result = await ipcRenderer.invoke"));
        for (const name of ["", "Named document", "/", "标题 </script> & \"quotes\""]) {
            const document = {title: "Export PDF"};
            runInNewContext(assignment, {response: {data: {name}}, document});
            assert.equal(document.title, name || languages._kernel[16], filename);
            const options = runInNewContext(dialog + "\ndialogOptions;", {response: {data: {name}}, require: () => path});
            assert.equal(options.cmd, "showSaveDialog");
            assert.equal(options.defaultPath, path.join(defaultDirectory,
                (replaceLocalPath(document.title) || languages._kernel[16]) + ".pdf"));
            assert.equal(options.buttonLabel, languages.save);
            assert.deepEqual(JSON.parse(JSON.stringify(options.filters)), [{name: "PDF", extensions: ["pdf"]}]);
            assert.ok(options.properties.includes("showOverwriteConfirmation"));
        }
    }
});
