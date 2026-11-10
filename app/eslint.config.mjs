import typescriptEslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import {fileURLToPath} from "node:url";
import js from "@eslint/js";
import {FlatCompat} from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default [{
    ignores: [
        "build",
        "electron-dist",
        "node_modules",
        "src/asset/pdf",
        "src/types/dist",
        "stage",
        "appearance",
    ],
}, ...compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended"), {
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        globals: {
            ...globals.node,
            ...globals.browser,
        },

        parser: tsParser,
    },

    rules: {
        // 条件编译保留的互斥分支会使重复赋值检查误报初始值。
        "no-useless-assignment": "off",
        semi: [2, "always"],
        quotes: [2, "double", {
            avoidEscape: true,
        }],
        "@typescript-eslint/no-unused-vars": ["warn", {caughtErrors: "none"}],
        "no-async-promise-executor": "off",
        "no-prototype-builtins": "off",
        "no-useless-escape": "off",
        "no-irregular-whitespace": "off",
        "@typescript-eslint/ban-ts-comment": "off",
        "@typescript-eslint/no-var-requires": "off",
        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/explicit-module-boundary-types": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-require-imports": "off",
    },
}, {
    // 窗口账本的读写统一走 windowRegistry，避免绕过它导致崩溃预期与初始化状态失真。
    // 直接访问 `state.windows` 的只有该模块与 runtime 的初始化 / 重置，因此这里是错误而不是告警。
    files: ["electron/**/*.ts"],
    ignores: ["electron/window/windowRegistry.ts", "electron/shared/runtime.ts", "electron/**/*.test.ts"],
    rules: {
        "no-restricted-syntax": ["error", {
            // 覆盖 `state.windows.targets`、`state["windows"]` 与 `const {windows} = state` 三种写法。
            selector: "MemberExpression[object.name=\"state\"][property.name=\"windows\"]",
            message: "窗口账本请通过 windowRegistry 的读写函数访问",
        }, {
            selector: "MemberExpression[object.name=\"state\"][computed=true][property.value=\"windows\"]",
            message: "窗口账本请通过 windowRegistry 的读写函数访问",
        }, {
            selector: "VariableDeclarator[init.name=\"state\"] Property[key.name=\"windows\"]",
            message: "窗口账本请通过 windowRegistry 的读写函数访问",
        }],
    },
}];
