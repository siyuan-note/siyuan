import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getDynamicIconValue, refreshDynamicIcons} from "./dynamicIcon";

test("font refresh reloads only local text icons and preserves date icons and saved values", () => {
    assert.equal(getDynamicIconValue("api/icon/getDynamicIcon?_fontRefresh=old"), "api/icon/getDynamicIcon");
    const sources = [
        "api/icon/getDynamicIcon?type=8&content=%E6%97%A5&id=target",
        "/api/icon/getDynamicIcon?type=8&content=Text&_fontRefresh=old",
        "http://localhost/api/icon/getDynamicIcon?type=8&content=Text",
        ...["1", "2", "3", "4", "5", "6", "7", "", "unknown"].map(type =>
            `api/icon/getDynamicIcon?type=${type}&date=&_fontRefresh=old`),
        "api/icon/getDynamicIcon",
        "https://example.com/api/icon/getDynamicIcon?type=8",
        "/emojis/custom.svg",
        "http://[invalid",
    ];
    const images = sources.map(src => ({
        src,
        getAttribute: () => src,
        setAttribute(name: string, value: string) {
            assert.equal(name, "src");
            this.src = value;
        },
    }));
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "document", {configurable: true, value: {
        baseURI: "http://localhost/", querySelectorAll: () => images,
    }});
    Object.defineProperty(globalThis, "window", {configurable: true, value: {location: {origin: "http://localhost"}}});
    try {
        refreshDynamicIcons();
        for (let i = 0; i < 3; i++) {
            assert.match(images[i].src, /[?&]_fontRefresh=\d+$/);
            assert.equal(new URL(images[i].src, "http://localhost").searchParams.getAll("_fontRefresh").length, 1);
            assert.equal(getDynamicIconValue(images[i].src), getDynamicIconValue(sources[i]));
        }
        assert.deepEqual(images.slice(3).map(image => image.src), sources.slice(3));
    } finally {
        for (const [name, descriptor] of [["document", originalDocument], ["window", originalWindow]] as const) {
            if (descriptor) {
                Object.defineProperty(globalThis, name, descriptor);
            } else {
                Reflect.deleteProperty(globalThis, name);
            }
        }
    }
});
