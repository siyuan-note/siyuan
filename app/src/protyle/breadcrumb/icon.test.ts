import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getBreadcrumbCustomIcon} from "./icon";

require("../../../stage/protyle/js/lute/lute.min.js");

test("breadcrumb emoji use the real icon renderer and sanitizer", () => {
    assert.match(getBreadcrumbCustomIcon("1f600", "protyle-breadcrumb__graphic"), /😀/);
    assert.match(getBreadcrumbCustomIcon("1f469-200d-1f4bb"), /👩‍💻/);
});

test("local, network and dynamic icons retain safe image markup", () => {
    for (const icon of ["custom.png", "https://example.com/icon?id=1&size=16", "api/icon/getDynamicIcon?type=text&content=A"]) {
        const html = getBreadcrumbCustomIcon(icon, "b3-menu__icon protyle-breadcrumb__graphic");
        assert.match(html, /<img /);
        assert.match(html, /protyle-breadcrumb__graphic/);
        assert.doesNotMatch(html, /<script|onerror=/);
    }
    assert.match(getBreadcrumbCustomIcon("https://example.com/icon"), /referrerpolicy="no-referrer"/);
    assert.doesNotMatch(getBreadcrumbCustomIcon('custom.png" onerror="alert(1)'), /"\s+onerror=/);
});

test("unicode validation rejects partial sequences and invalid scalar values", () => {
    for (const icon of ["1f600-110000", "1f600-dfff", "1f600-", "-1f600", "1f600xyz"]) {
        assert.equal(getBreadcrumbCustomIcon(icon), undefined, icon);
    }
});

test("menu emoji keep the shared sizing class while image URLs remain attribute-escaped", () => {
    const classes = "b3-menu__icon protyle-breadcrumb__graphic";
    assert.match(getBreadcrumbCustomIcon("1f4c1", classes), /<span class="b3-menu__icon protyle-breadcrumb__graphic">/);
    const html = getBreadcrumbCustomIcon('https://example.com/icon?name="x"&size=16', classes);
    assert.match(html, /class="b3-menu__icon protyle-breadcrumb__graphic"/);
    assert.doesNotMatch(html, /name="x"/);
});

test("missing, malformed and unsafe icons select the caller's default SVG", () => {
    for (const icon of [undefined, "", "garbage", "1f600-xyz", "110000", "d800", "javascript:alert(1)",
        "data:image/svg+xml,<svg onload=alert(1)>", "//example.com/icon.png", "file:///tmp/icon.png"]) {
        assert.equal(getBreadcrumbCustomIcon(icon), undefined, String(icon));
    }
});
