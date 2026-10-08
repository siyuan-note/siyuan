const assert = require("node:assert/strict");
const {existsSync, readFileSync} = require("node:fs");
const {createRequire} = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const {parse} = require("ifdef-loader/preprocessor");
const {transformSync} = createRequire(require.resolve("esbuild-loader"))("esbuild");

const root = path.resolve(__dirname, "../src");
const configuration = require("../webpack.export")({}, {mode: "production"});
const loaders = configuration.module.rules.find(rule => rule.test.test("example.ts")).use;
const options = {...loaders.find(loader => loader.loader === "ifdef-loader").options};
delete options["ifdef-verbose"];

// 按导出包的条件编译与类型擦除流程检查静态和动态依赖，不生成构建产物。
const getExportDependencies = () => {
    const visited = new Set();
    const pending = [path.join(root, "protyle/method.ts")];
    while (pending.length) {
        const file = pending.pop();
        if (visited.has(file)) {
            continue;
        }
        visited.add(file);
        const original = readFileSync(file, "utf8");
        const code = file.endsWith(".ts") ? transformSync(parse(original, options, false), {
            loader: "ts", target: "es6", format: "esm",
        }).code : original;
        const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
        const add = specifier => {
            if (!specifier.startsWith(".")) {
                return;
            }
            const target = path.resolve(path.dirname(file), specifier);
            const dependency = [target, target + ".ts", target + ".js", path.join(target, "index.ts")]
                .find(candidate => /\.(ts|js)$/.test(candidate) && existsSync(candidate));
            if (dependency) {
                pending.push(dependency);
            }
        };
        const visit = node => {
            if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier &&
                ts.isStringLiteral(node.moduleSpecifier)) {
                add(node.moduleSpecifier.text);
            } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0]) &&
                (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                    ts.isIdentifier(node.expression) && node.expression.text === "require")) {
                add(node.arguments[0].text);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
    return Array.from(visited, file => path.relative(root, file).replaceAll(path.sep, "/"));
};

test("export rendering keeps application UI outside its runtime dependency graph", t => {
    const dependencies = getExportDependencies();
    // 富文本字体规范化只处理值，不加载工具栏或编辑器界面。
    const sharedRenderHelpers = new Set(["protyle/toolbar/fontFamilyCore.ts"]);
    const applicationModules = dependencies.filter(file => !sharedRenderHelpers.has(file) && (/^(config|layout|menus|mobile|plugin)\//.test(file) ||
        /^protyle\/(hint|toolbar|header|gutter|ui)\//.test(file) || file === "protyle/util/selection.ts" ||
        file === "protyle/render/tableCellRichEditor.ts"));
    assert.deepEqual(applicationModules, [], "Export rendering imported application or editing UI");
    assert.ok(dependencies.includes("protyle/render/listMindmap/legacy.ts"), "Legacy mind map rendering must remain available");
    t.diagnostic(`Export renderer runtime dependency graph: ${dependencies.length} modules`);
});
