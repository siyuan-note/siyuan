// electron.d.ts 把 Electron 声明成全局命名空间，其中的 class 让它同时拥有值语义。
// 于是在值位置写 Electron.BrowserWindow 能通过 tsc 与 ESLint，运行时却抛 ReferenceError：
// 主进程只有 `import {BrowserWindow} from "electron"`，不存在名为 Electron 的全局绑定。
// 这条检查按 AST 判断值位置，类型位置（Electron.Session、as Electron.OpenDialogOptions）不受影响。
import {test} from "node:test";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = __dirname;

const sourceFiles = () => {
    const files = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== "fixtures" && entry.name !== "node_modules") {
                    walk(full);
                }
            } else if (entry.name.endsWith(".ts")) {
                files.push(full);
            }
        }
    };
    walk(root);
    return files;
};

// 类型位置的 Electron.Session 被解析为 QualifiedName，只有值位置才是 PropertyAccessExpression。
const globalValueUsages = (file) => {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const found = [];
    const visit = (node) => {
        if (ts.isPropertyAccessExpression(node) && node.parent && ts.isPropertyAccessExpression(node.parent) &&
            node.parent.expression === node) {
            ts.forEachChild(node, visit); // 链上只报告最外层，避免同一处重复计数
            return;
        }
        if (ts.isPropertyAccessExpression(node)) {
            let head = node.expression;
            while (ts.isPropertyAccessExpression(head)) {
                head = head.expression;
            }
            if (ts.isIdentifier(head) && "Electron" === head.text) {
                const {line} = source.getLineAndCharacterOfPosition(node.getStart(source));
                found.push(path.relative(root, file) + ":" + (line + 1) + " " + node.getText(source));
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
};

test("the global Electron namespace is never used as a value", () => {
    const usages = sourceFiles().flatMap(globalValueUsages);
    assert.deepEqual(usages, [], "import the value from \"electron\" instead of using the global Electron namespace:\n" +
        usages.join("\n"));
});
