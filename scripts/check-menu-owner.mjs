import {readFileSync, readdirSync} from "node:fs";
import {dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "app/package.json"));
const ts = require("typescript");
const calls = new Map();
const violations = [];

const property = (object, name) => ts.isObjectLiteralExpression(object) &&
    object.properties.find(entry => entry.name?.getText() === name);
const owned = node => {
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isCallExpression(parent) && parent.expression.getText() === "toggleMenu") {
            return true;
        }
    }
    return false;
};
const context = node => {
    const names = [];
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) {
            if (ts.isCallExpression(parent.parent) && parent.parent.expression.getText().endsWith(".addEventListener")) {
                names.push("event:" + parent.parent.arguments[0].getText());
            } else if (ts.isVariableDeclaration(parent.parent) || ts.isPropertyAssignment(parent.parent)) {
                names.push(parent.parent.name.getText());
            }
        } else if (ts.isMethodDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)) {
            if (parent.name) { names.push(parent.name.getText()); }
        }
    }
    return names.reverse().join("/");
};
const scan = directory => {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) { scan(file); continue; }
        if (!file.endsWith(".ts") || file.endsWith(".d.ts") || file.endsWith(".test.ts")) { continue; }
        const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
        const menuVariables = new Set();
        const findMenus = node => {
            if (ts.isVariableDeclaration(node) && node.initializer && ts.isNewExpression(node.initializer) &&
                /Menu$/.test(node.initializer.expression.getText())) {
                menuVariables.add(node.name.getText());
            }
            ts.forEachChild(node, findMenus);
        };
        findMenus(source);
        const path = relative(root, file).replaceAll("\\", "/");
        const visit = node => {
            if (ts.isCallExpression(node)) {
                if (node.expression.getText() === "toggleMenu") {
                    const options = node.arguments[0];
                    if (!options || (!property(options, "target") && property(options, "toggle")?.initializer?.getText() !== "false")) {
                        violations.push(path + ": toggleMenu requires target or explicit toggle: false");
                    }
                } else if (ts.isPropertyAccessExpression(node.expression)) {
                    const method = node.expression.name.text;
                    const receiver = node.expression.expression.getText();
                    const menu = /menu$/i.test(receiver) || menuVariables.has(receiver) || receiver.startsWith("init") ||
                        receiver.startsWith("window.siyuan.menus.menu") ||
                        ts.isNewExpression(node.expression.expression) && /Menu$/.test(node.expression.expression.expression.getText());
                    if ((method === "popup" || method === "fullscreen" || method === "open" && menu) && !owned(node)) {
                        const key = [path, context(node), receiver, method].join(" | ");
                        calls.set(key, (calls.get(key) || 0) + 1);
                    }
                }
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
    }
};
scan(join(root, "app/src"));

if (process.argv.includes("--inventory")) {
    console.log(JSON.stringify(Object.fromEntries([...calls].sort()), null, 2));
} else {
    // 例外逐项记录用途与调用数量，新增直接打开入口必须先明确其交互策略。
    const exemptions = JSON.parse(readFileSync(join(root, "scripts/menu-owner-exceptions.json"), "utf8"));
    for (const [key, count] of calls) {
        const exemption = exemptions[key];
        if (!exemption?.reason || exemption.count !== count) {
            violations.push(key + ": unowned menu call count " + count);
        }
    }
    for (const key of Object.keys(exemptions)) {
        if (!calls.has(key)) { violations.push(key + ": stale exemption"); }
    }
    if (violations.length) {
        console.error(violations.join("\n"));
        process.exitCode = 1;
    } else {
        console.log("Menu ownership: shared openings checked; explicit exceptions unchanged");
    }
}
