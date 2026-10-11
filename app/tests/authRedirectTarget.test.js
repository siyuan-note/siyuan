const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {test} = require("node:test");
const vm = require("node:vm");

const authPageSource = readFileSync(path.join(__dirname, "../stage/auth.html"), "utf8");

// 提取授权页实际发布的跳转校验函数，保证测试与线上代码一致
const extractSafeRedirectTarget = () => {
    const matched = /const safeRedirectTarget = \(target\) => \{[\s\S]*?\n {4}\};/.exec(authPageSource);
    assert.ok(matched, "auth.html 必须定义 safeRedirectTarget 跳转校验函数");
    return matched[0];
};

// 复现授权页的 toPath 求值：to 参数缺失或为空时回退首页，否则必须通过同源校验
const createToPathResolver = (origin) => {
    const context = vm.createContext({URL, window: {location: {origin}}});
    vm.runInContext(`${extractSafeRedirectTarget()}
this.resolveToPath = (to) => safeRedirectTarget(to || "/");`, context);
    return (to) => context.resolveToPath(to);
};

test("auth page rejects redirect targets outside the kernel origin", () => {
    const resolveToPath = createToPathResolver("http://127.0.0.1:6806");
    for (const target of [
        'javascript:document.title="poc";void 0',
        "javascript:alert(1)",
        "JavaScript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "vbscript:msgbox(1)",
        "//evil.example/stage/build/desktop/",
        "https://evil.example/stage/build/desktop/",
        "http://evil.example/stage/build/desktop/",
        "/\\evil.example",
        "\\\\evil.example",
        "https://127.0.0.1:6806/stage/build/desktop/",
    ]) {
        assert.equal(resolveToPath(target), "/", `跳转目标必须回退到首页：${target}`);
    }
});

test("auth page keeps same-origin redirect targets", () => {
    const origin = "http://127.0.0.1:6806";
    const resolveToPath = createToPathResolver(origin);
    assert.equal(resolveToPath("/stage/build/desktop/"), "/stage/build/desktop/");
    // redirectToCheckAuth 传入的是绝对同源地址，必须保留原页面而不是回退首页
    assert.equal(resolveToPath(`${origin}/stage/build/app/window.html?w=1`), "/stage/build/app/window.html?w=1");
    assert.equal(resolveToPath(`${origin}/stage/build/desktop/?id=x#y`), "/stage/build/desktop/?id=x#y");
});

test("auth page falls back to home when the to parameter is absent", () => {
    const resolveToPath = createToPathResolver("http://127.0.0.1:6806");
    assert.equal(resolveToPath(null), "/");
    assert.equal(resolveToPath(""), "/");
});

test("auth page routes the to parameter through the origin guard", () => {
    assert.ok(authPageSource.includes('toPath = safeRedirectTarget(url.searchParams.get("to") || "/")'),
        "to 参数必须经过 safeRedirectTarget 校验");
    assert.ok(!authPageSource.includes('toPath = url.searchParams.get("to")'),
        "授权页不得直接使用未校验的 to 参数");
});
