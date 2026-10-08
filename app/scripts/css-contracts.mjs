import {readFileSync, readdirSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import * as sass from "sass";
import selectorParser from "postcss-selector-parser";
import postcss from "postcss";
import ts from "typescript";
import stylelint from "stylelint";
import stylelintConfig from "../stylelint.config.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
const relative = file => path.relative(root, file).replaceAll("\\", "/");
const filesIn = directory => readdirSync(directory, {withFileTypes: true}).flatMap(entry =>
    entry.isDirectory() ? filesIn(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);

export const selectorClasses = selector => {
    const classes = new Set();
    try {
        selectorParser(selectors => selectors.walkClasses(node => classes.add(node.value))).processSync(selector);
    } catch {
        // 字符串中的运行时选择器可能不完整，仅检查能够解析的字面量。
    }
    return classes;
};

export const literalClasses = (text, file = "sample.ts") => {
    const classes = new Set();
    const addWords = value => value.split(/\s+/).filter(Boolean).forEach(name => {
        if (/^[a-zA-Z_][\w-]*$/.test(name)) {
            classes.add(name);
        }
    });
    const addHTML = value => {
        for (const match of value.matchAll(/\bclass\s*=\s*["']([^"']*)["']/g)) {
            addWords(match[1]);
        }
    };
    if (file.endsWith(".tpl") || file.endsWith(".html")) {
        addHTML(text);
        return classes;
    }
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const literal = node => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node));
    const visit = node => {
        if (literal(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
            addHTML(node.text);
        }
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isPropertyAccessExpression(node.left) && node.left.name.text === "className" && literal(node.right)) {
            addWords(node.right.text);
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const call = node.expression;
            if (ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "classList" &&
                ["add", "remove", "toggle", "contains", "replace"].includes(call.name.text)) {
                node.arguments.filter(literal).forEach(item => addWords(item.text));
            } else if (["querySelector", "querySelectorAll", "closest", "matches"].includes(call.name.text) && literal(node.arguments[0])) {
                selectorClasses(node.arguments[0].text).forEach(name => classes.add(name));
            } else if (call.name.text === "setAttribute" && literal(node.arguments[0]) && node.arguments[0].text === "class" &&
                literal(node.arguments[1])) {
                addWords(node.arguments[1].text);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return classes;
};

export const cssClasses = css => {
    const classes = new Set();
    postcss.parse(css).walkRules(rule => selectorClasses(rule.selector).forEach(name => classes.add(name)));
    return classes;
};

export const injectedCSSClasses = text => {
    const source = ts.createSourceFile("injected.ts", text, ts.ScriptTarget.Latest, true);
    const classes = new Set();
    const visit = node => {
        let value;
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            value = node.text;
        } else if (ts.isTemplateExpression(node)) {
            // 只连接静态部分，表达式以注释占位，不把运行时生成的类名当作已声明类名。
            value = node.head.text + node.templateSpans.map(span => `/* dynamic */${span.literal.text}`).join("");
        }
        if (value !== undefined) {
            const fragments = value.includes("<") ?
                [...value.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)].map(match => match[1]) : [value];
            for (const fragment of fragments) {
                for (const match of fragment.matchAll(/(?:^|[{}\n])\s*([^{};]*?)\s*\{/g)) {
                    selectorClasses(match[1]).forEach(name => classes.add(name));
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return classes;
};

export const collectClassContract = () => {
    const defined = new Set();
    const used = new Map();
    const compiled = {};
    for (const entry of ["base", "mobile", "export"]) {
        compiled[entry] = sass.compile(path.join(root, "src/assets/scss", `${entry}.scss`), {logger: sass.Logger.silent}).css;
        cssClasses(compiled[entry]).forEach(name => defined.add(name));
    }
    for (const file of filesIn(path.join(root, "appearance"))) {
        if (file.endsWith(".css")) {
            cssClasses(readFileSync(file, "utf8")).forEach(name => defined.add(name));
        }
    }
    for (const file of filesIn(path.join(root, "src"))) {
        if (!/\.(?:ts|tsx|tpl|html)$/.test(file) || /(?:\.test\.|\.generated\.|[/\\]types[/\\])/.test(file)) {
            continue;
        }
        const text = readFileSync(file, "utf8");
        for (const name of literalClasses(text, file)) {
            const references = used.get(name) || [];
            references.push(relative(file));
            used.set(name, references);
        }
        injectedCSSClasses(text).forEach(name => defined.add(name));
    }
    return {defined, used, compiled};
};

// 只约束内置 UI 的稳定命名空间，第三方 PDF、代码高亮及 Lute 内容类名属于各自协议。
export const managedClass = name => /^(?:[a-z][\w-]*__|b3-|config-|agent-chat__|protyle-|tabs-|tab-item)/.test(name);

export const newClassViolations = (defined, used, exceptions) => [...used.keys()]
    .filter(name => managedClass(name) && !defined.has(name) && !exceptions[name]).sort();

export const styleFindings = async () => {
    const result = await stylelint.lint({files: "src/assets/scss/**/*.scss", cwd: root, config: stylelintConfig});
    const findings = [];
    for (const item of result.results) {
        if (item.parseErrors.length || item.invalidOptionWarnings.length) {
            throw new Error(`Stylelint could not check ${relative(item.source)}`);
        }
        const lines = readFileSync(item.source, "utf8").split(/\r?\n/);
        for (const warning of item.warnings) {
            findings.push({file: relative(item.source), rule: warning.rule, text: warning.text,
                source: lines[warning.line - 1].trim()});
        }
    }
    return findings;
};

export const findingKey = item => JSON.stringify([item.file, item.rule, item.text, item.source]);

export const newStyleViolations = (findings, baseline) => {
    const remaining = new Map();
    for (const item of baseline) {
        const key = findingKey(item);
        remaining.set(key, (remaining.get(key) || 0) + 1);
    }
    return findings.filter(item => {
        const key = findingKey(item);
        const count = remaining.get(key) || 0;
        if (count) {
            remaining.set(key, count - 1);
            return false;
        }
        return true;
    });
};

export const checkContracts = async () => {
    const baseline = JSON.parse(readFileSync(path.join(root, "scripts/css-contract-baseline.json"), "utf8"));
    for (const [name, exception] of Object.entries(baseline.classes)) {
        if (!exception.reason?.trim() || !exception.references?.length) {
            throw new Error(`Class exception requires a reason and source references: ${name}`);
        }
    }
    if (baseline.styles.some(item => !item.reason?.trim())) {
        throw new Error("Style exceptions require concrete compatibility reasons");
    }
    const contract = collectClassContract();
    const classes = newClassViolations(contract.defined, contract.used, baseline.classes);
    const styles = newStyleViolations(await styleFindings(), baseline.styles);
    if (classes.length || styles.length) {
        throw new Error(`New CSS contract violations:\n${classes.map(name => `${name}: ${contract.used.get(name).join(", ")}`).join("\n")}\n${styles.map(findingKey).join("\n")}`);
    }
    console.log(`CSS contracts: ${contract.used.size} literal classes checked; no new violations`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.includes("--report-unused")) {
        const {defined, used} = collectClassContract();
        // 反向结果只供人工调查，不能据此删除主题钩子或运行时生成的类名。
        console.log(JSON.stringify([...defined].filter(name => managedClass(name) && !used.has(name)).sort(), null, 2));
    } else {
        await checkContracts();
    }
}
