const assert = require("node:assert/strict");
const {test} = require("node:test");

require("../stage/protyle/js/lute/lute.min.js");

const createLute = () => {
    const lute = globalThis.Lute.New();
    lute.SetProtyleWYSIWYG(true);
    lute.SetKramdownIAL(true);
    lute.SetSpin(true);
    return lute;
};

const assertBlockAttributes = (dom, id, updated) => {
    const openingTag = dom.slice(0, dom.indexOf(">") + 1);
    assert.ok(openingTag.includes(`data-node-id="${id}"`), dom);
    if (updated) {
        assert.ok(openingTag.includes(`updated="${updated}"`), dom);
    } else {
        assert.ok(!openingTag.includes(" updated="), dom);
    }
};

test("bundled Lute preserves short block IDs without deriving updated timestamps", () => {
    for (const [id, existingUpdated, expectedUpdated] of [
        ["1", "", ""],
        ["1234567890123", "", ""],
        ["20200101000000", "", "20200101000000"],
        ["20200101000000-abcdefg", "", "20200101000000"],
        ["1", "20210101000000", "20210101000000"],
    ]) {
        const lute = createLute();
        const updated = existingUpdated ? ` updated="${existingUpdated}"` : "";
        const markdown = `foo\n{: id="${id}"${updated}}\n`;
        const dom = lute.Md2BlockDOM(markdown, true);
        assertBlockAttributes(dom, id, expectedUpdated);
        assert.ok(dom.includes(">foo</div>"), dom);

        let spun = `<div data-node-id="${id}" data-type="NodeParagraph" class="p"${updated}>` +
            '<div contenteditable="true">foo</div><div class="protyle-attr" contenteditable="false"></div></div>';
        for (let round = 0; round < 3; round++) {
            spun = lute.SpinBlockDOM(spun);
            assertBlockAttributes(spun, id, expectedUpdated);
            assert.ok(spun.includes(">foo</div>"), spun);
        }
    }
});

test("bundled Lute accepts a short ID on an HTML block", () => {
    const dom = createLute().SpinBlockDOM('<div data-node-id="1">x</div>');
    assertBlockAttributes(dom, "1", "");
    assert.ok(dom.includes('data-type="NodeHTMLBlock"'), dom);
});

test("bundled Lute preserves a short ID when splitting a paragraph", () => {
    const lute = createLute();
    const dom = lute.SpinBlockDOM('<div data-node-id="1" data-type="NodeParagraph" class="p">' +
        '<div contenteditable="true">a<br /><br />b</div><div class="protyle-attr" contenteditable="false"></div></div>');
    assertBlockAttributes(dom, "1", "");
    const ids = [...dom.matchAll(/data-node-id="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, 2, dom);
    assert.equal(ids[0], "1", dom);
    assert.match(ids[1], /^\d{14}-[a-z0-9]{7}$/);
    assert.ok(dom.includes(`updated="${ids[1].slice(0, 14)}"`), dom);
    assert.ok(dom.includes(">a</div>") && dom.includes(">b</div>"), dom);
});
