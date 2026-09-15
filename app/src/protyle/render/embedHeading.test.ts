import * as assert from "node:assert/strict";
import {test} from "node:test";
import {getEmbedHeadingLevel, getEmbedHeadingLevels, isDirectHeadingEmbed, renderEmbedHeadings} from "./embedHeading";

test("only direct heading embeds enable heading level selection", () => {
    const id = "20260914000000-abcdefg";
    for (const statement of [`select * from blocks where id='${id}'`, ` SELECT * FROM blocks WHERE id = "${id}"; `]) {
        assert.equal(isDirectHeadingEmbed(statement, id, "NodeHeading"), true);
        assert.equal(isDirectHeadingEmbed(statement, id, "NodeDocument"), false);
        assert.equal(isDirectHeadingEmbed(statement, id, "NodeParagraph"), false);
    }
    assert.equal(isDirectHeadingEmbed("select * from blocks where type='h'", id, "NodeHeading"), false);
    assert.equal(isDirectHeadingEmbed(`select * from blocks where id='${id}' or type='h'`, id, "NodeHeading"), false);
    assert.equal(isDirectHeadingEmbed(`//!js\nreturn ["${id}"];`, id, "NodeHeading"), false);
});

test("visible headings retain level gaps and the default preserves source levels", () => {
    assert.deepEqual(getEmbedHeadingLevels([3, 5], 2), [2, 4]);
    assert.deepEqual(getEmbedHeadingLevels([5, 3, 6], 2), [4, 2, 5]);
    assert.deepEqual(getEmbedHeadingLevels([3, 5], 5), [5, 7]);
    assert.deepEqual(getEmbedHeadingLevels([3, 5], 0), [3, 5]);
    assert.deepEqual(getEmbedHeadingLevels([], 2), []);
    for (const value of [null, "", "0", "7", "01", "NaN"]) {
        assert.equal(getEmbedHeadingLevel(value), 0);
    }
});

test("preview changes classes without changing source heading attributes and resets cleanly", () => {
    let value = "5";
    const headings = [3, 5].map(level => {
        const classes = new Set([`h${level}`]);
        return {
            classes,
            getAttribute: (name: string) => name === "data-subtype" ? `h${level}` : "NodeHeading",
            closest: () => embed,
            classList: {
                remove: (...names: string[]) => names.forEach(name => classes.delete(name)),
                add: (name: string) => classes.add(name),
            },
        };
    });
    const embed = {
        querySelectorAll: (selector: string) => selector.includes("NodeHeading") ? headings : [],
        querySelector: () => ({}),
        closest: () => embed,
        getAttribute: () => value,
    } as unknown as Element;
    renderEmbedHeadings(embed);
    assert.deepEqual([...headings[0].classes], ["h5"]);
    assert.deepEqual([...headings[1].classes], ["protyle-embed-heading--paragraph"]);
    renderEmbedHeadings(embed);
    assert.deepEqual([...headings[0].classes], ["h5"]);
    value = "";
    renderEmbedHeadings(embed);
    assert.deepEqual([...headings[0].classes], ["h3"]);
    assert.deepEqual([...headings[1].classes], ["h5"]);
});
