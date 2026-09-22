import * as assert from "node:assert/strict";
import test from "node:test";
import {setTimeout as delay} from "node:timers/promises";
import {ParentDocClick} from "./parentDocClick";

const row = () => ({isConnected: true} as HTMLElement);

test("prefetch starts immediately but cached children wait for the single click", async () => {
    const click = new ParentDocClick();
    let requested = 0;
    let applied = 0;
    click.click(row(), async () => {
        requested++;
        return () => applied++;
    }, () => assert.fail("unexpected open"));
    assert.equal(requested, 1);
    await delay(30);
    assert.equal(applied, 0);
    await delay(300);
    assert.equal(applied, 1);
});

test("slow children render only after both the request and the click window finish", async () => {
    const click = new ParentDocClick();
    let resolve: (apply: () => void) => void;
    let applied = 0;
    click.click(row(), () => new Promise(done => { resolve = done; }), () => assert.fail("unexpected open"));
    await delay(330);
    assert.equal(applied, 0);
    resolve(() => applied++);
    await delay(0);
    assert.equal(applied, 1);
});

test("double click opens once and discards early or late child responses and collapse actions", async () => {
    for (const late of [false, true]) {
        const click = new ParentDocClick();
        const target = row();
        let resolve: (apply: () => void) => void;
        let applied = 0;
        let opened = 0;
        const prepare = () => new Promise<() => void>(done => { resolve = done; });
        click.click(target, prepare, () => opened++);
        if (!late) { resolve(() => applied++); }
        await delay(0);
        click.click(target, () => { throw new Error("duplicate request"); }, () => opened++);
        if (late) { resolve(() => applied++); }
        await delay(330);
        assert.equal(opened, 1);
        assert.equal(applied, 0);
    }
});

test("new rows, cancellation and detached rows invalidate pending display", async () => {
    const click = new ParentDocClick();
    let applied = 0;
    const prepare = async () => () => applied++;
    const open = () => assert.fail("different rows must not open");
    click.click(row(), prepare, open);
    const target = row();
    click.click(target, prepare, open);
    Object.defineProperty(target, "isConnected", {value: false});
    await delay(330);
    assert.equal(applied, 0);
    click.click(row(), prepare, open);
    click.cancel();
    await delay(330);
    assert.equal(applied, 0);
});
