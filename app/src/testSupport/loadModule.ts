import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

// 测试用的模块加载器。被测代码依赖 window、document 与大量同级模块，
// 直接在测试里 import 会把整棵依赖树拉进 Node；这里转译为 CommonJS 后
// 在独立上下文中求值，由调用方用 sandbox.require 提供依赖替身。

// 把 src 下的 TS 模块转译为 CommonJS 文本。与 evaluateModule 分开，
// 是因为有些用例先编译一次，再用不同替身多次求值。
export const compileModule = (file: string, target: ScriptTarget = ScriptTarget.ES2022) =>
    transpileModule(readFileSync(file, "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target},
    }).outputText;

// 在独立上下文里求值已编译的模块，返回其 exports。
// 每次调用都是全新实例，模块级状态（尚未保存的队列、缓存等）不会在用例之间泄漏。
export const evaluateModule = <T>(compiled: string, sandbox: Record<string, unknown> = {}): T => {
    const exports: Record<string, unknown> = {};
    runInNewContext(compiled, {exports, ...sandbox});
    return exports as T;
};

// 编译并加载 src 下的一个 TS 模块。
export const loadModule = <T>(file: string, sandbox: Record<string, unknown> = {},
                             target: ScriptTarget = ScriptTarget.ES2022): T =>
    evaluateModule<T>(compileModule(file, target), sandbox);
