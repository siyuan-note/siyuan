import {test} from "node:test";
import {isBuiltinArg, isDroppedOnConnectionSwitch} from "./builtinArgs";
const assert = require("node:assert/strict");

// 内置参数写成裸名与 name=value 两种形式都成立，比较只看等号前的名字。
test("builtin arguments cover both bare and valued forms", () => {
    for (const name of ["--workspace", "--openAsHidden", "--port", "--safe-mode", "--lang",
        "--connection-session", "--remote", "--trust-remote-extensions"]) {
        assert.equal(isBuiltinArg(name), true, name);
        assert.equal(isBuiltinArg(name + "=value"), true, name + "=value");
    }
    assert.equal(isBuiltinArg("siyuan://blocks/20261025000000-abcdefg"), true);
    assert.equal(isBuiltinArg("--ignore-certificate-errors"), false);
    assert.equal(isBuiltinArg("--workspace-path=/notes"), false);
});

// 切换连接时只丢弃与目标绑定或由启动开关重新决定的参数，语言由目标连接重新给出。
test("connection switch drops builtin arguments except the language", () => {
    for (const name of ["--workspace", "--openAsHidden", "--port", "--safe-mode",
        "--connection-session", "--remote", "--trust-remote-extensions"]) {
        assert.equal(isDroppedOnConnectionSwitch(name), true, name);
        assert.equal(isDroppedOnConnectionSwitch(name + "=value"), true, name + "=value");
    }
    assert.equal(isDroppedOnConnectionSwitch("siyuan://blocks/20261025000000-abcdefg"), true);
    assert.equal(isDroppedOnConnectionSwitch("--no-proxy-server"), true);
    assert.equal(isDroppedOnConnectionSwitch("--lang=en"), false);
    assert.equal(isDroppedOnConnectionSwitch("--lang"), false);
    assert.equal(isDroppedOnConnectionSwitch("--foo=bar"), false);
});
