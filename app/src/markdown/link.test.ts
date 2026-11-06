import * as assert from "node:assert/strict";
import {test} from "node:test";
import {markdownLinkDestination} from "./link";

const anchor = {tagName: "A", matches: () => false} as unknown as Element;
const marker = (textContent: string, type = "a") => ({tagName: "SPAN", textContent,
    matches: (selector: string) => selector === "span.vditor-ir__marker--link",
    parentElement: {getAttribute: () => type},
}) as unknown as Element;

test("Markdown links resolve protected anchors and IR destination markers", () => {
    for (const destination of ["https://example.com/path?q=a&b=c#part", "http://example.com/", "mailto:test@example.com"]) {
        assert.equal(markdownLinkDestination(anchor, (element, name) => {
            assert.equal(element, anchor);
            assert.equal(name, "href");
            return destination;
        }), destination);
        assert.equal(markdownLinkDestination(marker(destination), () => {
            throw new Error("An IR marker has no href");
        }), destination);
    }
    assert.equal(markdownLinkDestination(marker("https://example.com", "img"), () => null), undefined);
    assert.equal(markdownLinkDestination(null, () => null), undefined);
});

test("Markdown link activation rejects unsupported schemes, malformed URLs and credentials", () => {
    for (const destination of ["javascript:alert(1)", "data:text/html,test", "file:///etc/passwd", "siyuan://blocks/test",
        "//example.com", "assets/test.md", "#heading", "https://", "https://user:pass@example.com", "https://user@example.com",
        "https://example.com/a\nb", "mailto:test@example.com\rsubject:test", "https://example.com/" + "a".repeat(8192)]) {
        assert.equal(markdownLinkDestination(anchor, () => destination), undefined, destination);
        assert.equal(markdownLinkDestination(marker(destination), () => null), undefined, destination);
    }
});
