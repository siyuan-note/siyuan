const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
import {test} from "node:test";
const {MarkdownDiskService} = require("./disk");

const setup = async (t, fileSystem?: typeof fs) => {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "siyuan-markdown-")));
    t.after(() => fs.rm(directory, {recursive: true, force: true}));
    const service = new MarkdownDiskService({fileSystem,
        ...(fileSystem?.rename && fileSystem.rename !== fs.rename ? {replace: fileSystem.rename} : {})});
    service.createSession("a");
    service.createSession("b");
    return {directory, service, file: name => path.join(directory, name)};
};
const request = (target, content, extras = {}) => ({sessionId: "a", targetGeneration: 1, operationId: "write-1",
    revision: 1, target, expectedBaseline: target.baseline, content, ...extras});

test("authorized handles are owner-bound and do not disclose paths or overwrite on open", async t => {
    const {service, file} = await setup(t);
    const selected = file("source.md");
    const bytes = Buffer.from("\uFEFFone\r\ntwo\n");
    await fs.writeFile(selected, bytes);
    const opened = await service.authorizeOpen("a", selected);
    assert.equal(opened.kind, "opened");
    assert.equal(opened.content, "one\ntwo\n");
    assert.equal(JSON.stringify(opened).includes(selected), false);
    assert.deepEqual(await fs.readFile(selected), bytes);
    assert.equal((await service.read({sessionId: "b", target: opened.target})).kind, "blocked");
    assert.equal((await service.write(request(opened.target, "attack", {sessionId: "b"}))).kind, "blocked");
    assert.deepEqual(await fs.readFile(selected), bytes);
});

test("temporary ID collisions retry without overwriting or removing another writer's files", async t => {
    for (const exhausted of [false, true]) {
        const occupied: string[] = [];
        const io = {...fs, open: async (name, flags, mode) => {
            if (flags === "wx" && (exhausted || occupied.length === 0)) {
                occupied.push(name);
                await fs.writeFile(name, "another writer", {flag: "wx"});
                throw Object.assign(new Error("occupied"), {code: "EEXIST"});
            }
            return fs.open(name, flags, mode);
        }};
        const {service, file} = await setup(t, io);
        const selected = file("note.md");
        await fs.writeFile(selected, "original");
        const opened = await service.authorizeOpen("a", selected);
        const result = await service.write(request(opened.target, "edited"));
        assert.equal(result.kind, exhausted ? "blocked" : "committed");
        assert.equal(occupied.length, exhausted ? 8 : 1);
        assert.equal(await fs.readFile(selected, "utf8"), exhausted ? "original" : "edited");
        for (const name of occupied) {
            assert.match(path.basename(name), /^\.siyuan-markdown-\d{14}-[a-z0-9]{7}\.tmp$/);
            assert.equal(await fs.readFile(name, "utf8"), "another writer");
        }
    }
});

test("parallel opens and hard-link aliases focus the existing owner", async t => {
    const {service, file} = await setup(t);
    await fs.writeFile(file("source.md"), "original");
    await fs.link(file("source.md"), file("alias.md"));
    const results = await Promise.all([service.authorizeOpen("a", file("source.md")),
        service.authorizeOpen("b", file("alias.md"))]);
    assert.deepEqual(results.map(result => result.kind).sort(), ["occupied", "opened"]);
    assert.equal(service.registry.entries.size, 1);
});

test("save-as reserves absent and existing targets before any write and preserves old binding", async t => {
    const {service, file} = await setup(t);
    await fs.writeFile(file("source.md"), "source");
    const opened = await service.authorizeOpen("a", file("source.md"));
    const reserved = await service.authorizeSaveAs("a", file("target.md"), opened.target.format);
    assert.equal(reserved.kind, "reserved");
    assert.deepEqual(await service.authorizeSaveAs("b", file("target.md")), {kind: "occupied", sessionId: "a"});
    assert.deepEqual(await service.authorizeOpen("b", file("source.md")), {kind: "occupied", sessionId: "a"});
    assert.equal((await service.write(request(reserved.target, "new"))).kind, "blocked");
    const receipt = await service.write(request(reserved.target, "new", {reservationId: reserved.reservationId}));
    assert.equal(receipt.kind, "committed");
    assert.equal(await fs.readFile(file("source.md"), "utf8"), "source");
    const target = service.commitSaveAs({sessionId: "a", target: reserved.target,
        reservationId: reserved.reservationId, previousTarget: opened.target});
    assert.equal(target.baseline, receipt.baseline);
    assert.equal((await service.authorizeOpen("b", file("source.md"))).kind, "opened");
    assert.deepEqual(await service.authorizeOpen("b", file("target.md")), {kind: "occupied", sessionId: "a"});
});

test("two simultaneous save-as reservations cannot claim one absent destination", async t => {
    const {service, file} = await setup(t);
    const results = await Promise.all([service.authorizeSaveAs("a", file("same.md")),
        service.authorizeSaveAs("b", file("same.md"))]);
    assert.deepEqual(results.map(result => result.kind).sort(), ["occupied", "reserved"]);
    assert.equal(service.registry.entries.size, 1);
});

test("failed UTF-8 open releases its target without modifying the original", async t => {
    const {service, file} = await setup(t);
    await fs.writeFile(file("invalid.md"), new Uint8Array([0xc0, 0xaf]));
    assert.equal((await service.authorizeOpen("a", file("invalid.md"))).kind, "blocked");
    assert.equal(service.registry.entries.size, 0);
    assert.deepEqual(await fs.readFile(file("invalid.md")), Buffer.from([0xc0, 0xaf]));
});

test("missing files and invalid selections return structured failures without creating grants", async t => {
    const {service, file} = await setup(t);
    assert.deepEqual(await service.authorizeOpen("a", file("missing.md")),
        {kind: "blocked", error: {code: "deleted", recoverable: true}});
    assert.deepEqual(await service.authorizeOpen("a", file("file.txt")),
        {kind: "blocked", error: {code: "protocol", recoverable: false}});
    assert.equal(service.registry.entries.size, 0);
});

test("save detects external writes even with restored mtime and never replaces the conflict", async t => {
    const {service, file} = await setup(t);
    await fs.writeFile(file("source.md"), "before");
    const opened = await service.authorizeOpen("a", file("source.md"));
    const stat = await fs.stat(file("source.md"));
    await fs.writeFile(file("source.md"), "edited");
    await fs.utimes(file("source.md"), stat.atime, stat.mtime);
    assert.equal((await service.write(request(opened.target, "mine"))).kind, "conflict");
    assert.equal(await fs.readFile(file("source.md"), "utf8"), "edited");
});

test("external reload does not advance the accepted baseline and can be accepted explicitly by the caller", async t => {
    const {service, file} = await setup(t);
    await fs.writeFile(file("source.md"), "before");
    const opened = await service.authorizeOpen("a", file("source.md"));
    await fs.writeFile(file("source.md"), "external");
    const loaded = await service.read({sessionId: "a", target: opened.target});
    assert.equal(loaded.kind, "read");
    assert.notEqual(loaded.target.baseline, opened.target.baseline);
    assert.equal(service.registry.get("a", opened.target.handle).descriptor.baseline, opened.target.baseline);
    assert.equal((await service.write(request(opened.target, "stale"))).kind, "conflict");
    assert.equal((await service.write(request(loaded.target, "accepted"))).kind, "committed");
});

test("same-path replacement can reload while stale writes remain protected even for identical bytes", async t => {
    const {service, file} = await setup(t);
    await fs.writeFile(file("source.md"), "same");
    const opened = await service.authorizeOpen("a", file("source.md"));
    await fs.writeFile(file("replacement.md"), "same");
    await fs.rename(file("replacement.md"), file("source.md"));
    const result = await service.write(request(opened.target, "mine"));
    assert.equal(result.kind, "blocked");
    assert.equal(result.error.code, "identity-changed");
    const loaded = await service.read({sessionId: "a", target: opened.target});
    assert.equal(loaded.kind, "read");
    assert.equal(loaded.target.identity, opened.target.identity);
    assert.notEqual(loaded.target.baseline, opened.target.baseline);
    assert.equal(service.registry.get("a", opened.target.handle).descriptor.baseline, opened.target.baseline);
    assert.equal((await service.write(request(opened.target, "stale"))).kind, "conflict");
    assert.equal(await fs.readFile(file("source.md"), "utf8"), "same");
    assert.equal((await service.write(request(loaded.target, "accepted"))).kind, "committed");
});

test("save writes UTF-8 BOM and selected newlines through atomic replacement", async t => {
    const {service, file, directory} = await setup(t);
    await fs.writeFile(file("source.md"), "\uFEFFone\r\n");
    const opened = await service.authorizeOpen("a", file("source.md"));
    const receipt = await service.write(request(opened.target, "two\nthree\n"));
    assert.equal(receipt.kind, "committed");
    assert.equal(receipt.durability, "local");
    assert.deepEqual(await fs.readFile(file("source.md")), Buffer.from("\uFEFFtwo\r\nthree\r\n"));
    assert.deepEqual(await fs.readdir(directory), ["source.md"]);
    const reload = await service.read({sessionId: "a", target: opened.target});
    assert.equal(reload.kind, "read");
    assert.equal(reload.target.identity, opened.target.identity);
    const next = {...opened.target, baseline: receipt.baseline};
    assert.equal((await service.write(request(next, "four"))).kind, "committed");
});

test("new target creation never overwrites a file appearing after the final check", async t => {
    const {service, file} = await setup(t, {...fs, link: async (from, to) => {
        await fs.writeFile(to, "external");
        return fs.link(from, to);
    }});
    const destination = file("new.md");
    const reserved = await service.authorizeSaveAs("a", destination);
    const result = await service.write(request(reserved.target, "mine", {reservationId: reserved.reservationId}));
    assert.equal(result.kind, "conflict");
    assert.equal(await fs.readFile(destination, "utf8"), "external");
    assert.equal(service.releaseSaveAs({sessionId: "a", target: reserved.target, reservationId: reserved.reservationId}), true);
});

test("reservation release and session close wait for pending writes", async t => {
    let continueRename;
    let entered;
    const reached = new Promise(resolve => entered = resolve);
    const gate = new Promise(resolve => continueRename = resolve);
    const {service, file} = await setup(t, {...fs, rename: async (...args) => {
        entered();
        await gate;
        return fs.rename(...args);
    }});
    await fs.writeFile(file("target.md"), "old");
    const reserved = await service.authorizeSaveAs("a", file("target.md"));
    const pending = service.write(request(reserved.target, "new", {reservationId: reserved.reservationId}));
    await reached;
    assert.equal(service.releaseSaveAs({sessionId: "a", target: reserved.target, reservationId: reserved.reservationId}), false);
    assert.equal(service.closeSession("a"), false);
    assert.deepEqual(await service.authorizeOpen("b", file("target.md")), {kind: "occupied", sessionId: "a"});
    continueRename();
    assert.equal((await pending).kind, "committed");
    assert.equal(service.releaseSaveAs({sessionId: "a", target: reserved.target, reservationId: reserved.reservationId}), false);
    service.commitSaveAs({sessionId: "a", target: reserved.target, reservationId: reserved.reservationId});
    assert.equal(service.closeSession("a"), true);
});

test("a replacement whose result cannot be proved keeps its reservation", async t => {
    const {service, file} = await setup(t, {...fs, rename: async (...args) => {
        await fs.rename(...args);
        throw new Error("provider disconnected after replacement");
    }});
    await fs.writeFile(file("target.md"), "old");
    const reserved = await service.authorizeSaveAs("a", file("target.md"));
    const result = await service.write(request(reserved.target, "new", {reservationId: reserved.reservationId}));
    assert.equal(result.kind, "indeterminate");
    assert.equal(service.closeSession("a"), false);
    assert.equal(service.releaseSaveAs({sessionId: "a", target: reserved.target, reservationId: reserved.reservationId}), false);
    assert.deepEqual(await service.authorizeOpen("b", file("target.md")), {kind: "occupied", sessionId: "a"});
    assert.equal((await service.write(request(reserved.target, "again", {reservationId: reserved.reservationId}))).kind, "blocked");
    const verified = await service.reconcileWrite(request(reserved.target, "new", {reservationId: reserved.reservationId}));
    assert.equal(verified.kind, "committed");
    assert.equal(service.releaseSaveAs({sessionId: "a", target: reserved.target, reservationId: reserved.reservationId}), false);
    const committed = service.commitSaveAs({sessionId: "a", target: reserved.target, reservationId: reserved.reservationId});
    assert.equal(committed.baseline, verified.baseline);
});

test("file size is rejected before allocating or reading oversized content", async t => {
    const {service, file} = await setup(t);
    const large = await fs.open(file("large.md"), "w");
    await large.truncate(8 * 1024 * 1024 + 1);
    await large.close();
    const result = await service.authorizeOpen("a", file("large.md"));
    assert.equal(result.kind, "blocked");
    assert.deepEqual(result.error, {code: "size", recoverable: false});
    assert.equal(service.registry.entries.size, 0);
});

test("the 8 MiB boundary counts UTF-8 and BOM bytes and rejects an oversized write without changing the file", async t => {
    const {service, file} = await setup(t);
    const content = "汉".repeat(2796201) + "ab";
    const bytes = Buffer.from("\ufeff" + content);
    assert.equal(bytes.length, 8 * 1024 * 1024);
    await fs.writeFile(file("boundary.md"), bytes);
    const opened = await service.authorizeOpen("a", file("boundary.md"));
    assert.equal(opened.kind, "opened");
    assert.equal(opened.content, content);
    const result = await service.write(request(opened.target, content + "x"));
    assert.equal(result.kind, "blocked");
    assert.equal(result.error.code, "size");
    assert.deepEqual(await fs.readFile(file("boundary.md")), bytes);
});

test("changes during staging are checked again before replacing the destination", async t => {
    let changed = false;
    const {service, file, directory} = await setup(t, {...fs, open: async (name, ...args) => {
        const handle = await fs.open(name, ...args);
        if (!path.basename(name).startsWith(".siyuan-markdown-")) return handle;
        return {writeFile: async bytes => {
            await handle.writeFile(bytes);
            if (!changed) {
                changed = true;
                await fs.writeFile(selected, "external update during staging");
            }
        }, stat: options => handle.stat(options), chown: (...args) => handle.chown(...args),
        chmod: mode => handle.chmod(mode), sync: () => handle.sync(), close: () => handle.close()};
    }});
    const selected = file("source.md");
    await fs.writeFile(selected, "original");
    const opened = await service.authorizeOpen("a", selected);
    assert.equal((await service.write(request(opened.target, "mine"))).kind, "conflict");
    assert.equal(await fs.readFile(selected, "utf8"), "external update during staging");
    assert.deepEqual(await fs.readdir(directory), ["source.md"]);
});

test("directory durability must be confirmed before commit and again when reconciling a failed sync", async t => {
    const {service, directory, file} = await setup(t);
    await fs.writeFile(file("sync.md"), "original");
    const opened = await service.authorizeOpen("a", file("sync.md"));
    let fail = true; const events = [];
    service.replace = async (from, to) => {await fs.rename(from, to); events.push("replace");};
    service.synchronizeDirectory = async parent => {
        assert.equal(parent, directory); assert.equal(await fs.readFile(file("sync.md"), "utf8"), "saved");
        events.push("directory-sync"); if (fail) throw Object.assign(new Error("sync failed"), {code: "EIO"});
    };
    const operation = request(opened.target, "saved");
    assert.equal((await service.write(operation)).kind, "indeterminate");
    assert.deepEqual(events, ["replace", "directory-sync"]);
    assert.equal((await service.reconcileWrite(operation)).kind, "indeterminate");
    fail = false;
    assert.equal((await service.reconcileWrite(operation)).kind, "committed");
    assert.equal(events.filter(value => value === "replace").length, 1);
});

test("directory junction aliases share ownership and changing the junction revokes file access", async t => {
    const {service, file} = await setup(t);
    await fs.mkdir(file("first"));
    await fs.mkdir(file("second"));
    await fs.writeFile(file("first/source.md"), "first");
    await fs.writeFile(file("second/source.md"), "second");
    await fs.symlink(file("first"), file("linked"), process.platform === "win32" ? "junction" : "dir");
    const opened = await service.authorizeOpen("a", file("linked/source.md"));
    assert.equal(opened.kind, "opened");
    assert.deepEqual(await service.authorizeOpen("b", file("first/source.md")), {kind: "occupied", sessionId: "a"});
    await fs.unlink(file("linked"));
    await fs.symlink(file("second"), file("linked"), process.platform === "win32" ? "junction" : "dir");
    const result = await service.write(request(opened.target, "wrong"));
    assert.equal(result.kind, "blocked");
    assert.equal(result.error.code, "identity-changed");
    assert.equal(await fs.readFile(file("second/source.md"), "utf8"), "second");
});

test("atomic saves retain existing POSIX permission bits", {skip: process.platform === "win32"}, async t => {
    const {service, file} = await setup(t);
    await fs.writeFile(file("source.md"), "old", {mode: 0o640});
    const opened = await service.authorizeOpen("a", file("source.md"));
    assert.equal((await service.write(request(opened.target, "new"))).kind, "committed");
    assert.equal((await fs.stat(file("source.md"))).mode & 0o777, 0o640);
});

test("read-only files can be opened but cannot be replaced through a writable parent", async t => {
    const {service, file} = await setup(t);
    const selected = file("readonly.md");
    await fs.writeFile(selected, "old");
    await fs.chmod(selected, 0o444);
    try {
        const opened = await service.authorizeOpen("a", selected);
        assert.equal(opened.kind, "opened");
        assert.equal(opened.target.writable, false);
        const result = await service.write(request(opened.target, "new"));
        assert.equal(result.kind, "blocked");
        assert.equal(result.error.code, "readonly");
        assert.equal(await fs.readFile(selected, "utf8"), "old");
    } finally {
        await fs.chmod(selected, 0o600);
    }
});

test("queued writes copy caller state and stale baselines cannot overwrite an earlier commit", async t => {
    const {service, file} = await setup(t);
    await fs.writeFile(file("source.md"), "old");
    const opened = await service.authorizeOpen("a", file("source.md"));
    const first = request(opened.target, "first");
    const pending = service.write(first);
    first.content = "mutated";
    first.target.format = {bom: true, newline: "\r\n"};
    const second = service.write(request(opened.target, "stale", {operationId: "write-2"}));
    assert.equal((await pending).kind, "committed");
    assert.equal((await second).kind, "conflict");
    assert.equal(await fs.readFile(file("source.md"), "utf8"), "first");
});

test("rename failure preserves the old file and cleans the staging file without an unlink fallback", async t => {
    const {service, file, directory} = await setup(t, {...fs, rename: async () => {
        throw Object.assign(new Error("access denied"), {code: "EACCES"});
    }});
    await fs.writeFile(file("source.md"), "old");
    const opened = await service.authorizeOpen("a", file("source.md"));
    assert.equal((await service.write(request(opened.target, "new"))).kind, "blocked");
    assert.equal(await fs.readFile(file("source.md"), "utf8"), "old");
    assert.deepEqual(await fs.readdir(directory), ["source.md"]);
});

test("symbolic-link grants preserve the link and reject a changed link target", async t => {
    const {service, file} = await setup(t);
    await fs.writeFile(file("first.md"), "first");
    await fs.writeFile(file("second.md"), "second");
    try {
        await fs.symlink(file("first.md"), file("alias.md"));
    } catch (error) {
        if (error.code === "EPERM") return t.skip("Creating symbolic links requires Windows developer mode or permission");
        throw error;
    }
    const opened = await service.authorizeOpen("a", file("alias.md"));
    assert.equal((await service.write(request(opened.target, "new"))).kind, "committed");
    assert.equal((await fs.lstat(file("alias.md"))).isSymbolicLink(), true);
    assert.equal(await fs.readFile(file("first.md"), "utf8"), "new");
    await fs.unlink(file("alias.md"));
    await fs.symlink(file("second.md"), file("alias.md"));
    assert.equal((await service.write(request(opened.target, "wrong"))).kind, "blocked");
    assert.equal(await fs.readFile(file("second.md"), "utf8"), "second");
});

test("asset authorization binds the verified identity before occupied reuse and after asynchronous reading", async t => {
    const {service, file} = await setup(t);
    const selected = file("asset.md");
    await fs.writeFile(selected, "original");
    const expected = await service.describe(selected);
    const opened = await service.authorizeOpen("a", selected, expected);
    assert.equal(opened.kind, "opened");
    assert.equal((await service.authorizeOpen("b", selected, {...expected, identity: "other"})).kind, "blocked");
    assert.equal((await service.authorizeOpen("b", selected, expected)).kind, "occupied");
    service.closeSession("a");
    const snapshot = service.snapshot.bind(service);
    service.snapshot = async (...args) => {
        await fs.rename(selected, file("previous.md"));
        await fs.writeFile(selected, "replacement");
        return snapshot(...args);
    };
    assert.equal((await service.authorizeOpen("b", selected, expected)).kind, "blocked");
    assert.equal(service.registry.entries.size, 0);
});

test("asset authorization rejects symlink replacement before granting an outside file", async t => {
    if (process.platform === "win32") return t.skip("symlink creation requires additional Windows privileges");
    const {service, file} = await setup(t);
    const selected = file("asset.md");
    await fs.writeFile(selected, "original");
    const expected = await service.describe(selected);
    const outside = file("outside.md");
    await fs.writeFile(outside, "private");
    await fs.unlink(selected);
    await fs.symlink(outside, selected);
    assert.equal((await service.authorizeOpen("a", selected, expected)).kind, "blocked");
    assert.equal(service.registry.entries.size, 0);
});
