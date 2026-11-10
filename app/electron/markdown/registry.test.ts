import * as assert from "node:assert/strict";
import {test} from "node:test";
import {MarkdownTargetRegistry, MarkdownFileDescriptor} from "./registry";

test("generated session and target IDs never reuse issued or reserved identities", () => {
    const values = ["historical", "session", "session", "handle", "handle", "target", "target", "reservation"];
    const registry = new MarkdownTargetRegistry({createId: () => values.shift()!});
    registry.reserveIds(["historical"]);
    const session = registry.createSession();
    assert.equal(session, "session");
    const descriptor: MarkdownFileDescriptor = {path: "/file.md", selection: "/file.md", keys: ["file"],
        identity: "file", mode: 0o600, writable: true};
    const result = registry.claim(session, descriptor, true);
    assert.equal(result.kind, "claimed");
    if (result.kind !== "claimed") throw new Error("Missing claim");
    assert.equal(result.entry.handle, "handle");
    assert.equal(result.entry.targetIdentity, "target");
    assert.equal(result.entry.reservationId, "reservation");
    assert.equal(values.length, 0);
});

test("collision exhaustion leaves the existing target and ownership unchanged", () => {
    const values = ["session", "handle", "target"];
    const registry = new MarkdownTargetRegistry({createId: () => values.shift() ?? "handle"});
    const session = registry.createSession();
    const descriptor: MarkdownFileDescriptor = {path: "/first.md", selection: "/first.md", keys: ["first"],
        identity: "first", mode: 0o600, writable: true};
    const result = registry.claim(session, descriptor, false);
    assert.throws(() => registry.claim(session, {...descriptor, keys: ["second"]}, false), /unique Markdown ID/);
    assert.equal(registry.entries.size, 1);
    assert.equal(registry.keys.has("second"), false);
    if (result.kind !== "claimed") throw new Error("Missing claim");
    assert.equal(registry.entries.get("handle"), result.entry);
});
