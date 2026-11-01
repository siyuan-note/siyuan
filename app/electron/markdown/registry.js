const {randomUUID} = require("node:crypto");

// 由主进程持有；真实路径与磁盘身份均不得序列化到渲染进程。
class MarkdownTargetRegistry {
    constructor() {
        this.sessions = new Set();
        this.entries = new Map();
        this.keys = new Map();
    }

    createSession(sessionId = randomUUID()) {
        if (typeof sessionId !== "string" || !sessionId || this.sessions.has(sessionId)) {
            throw new Error("Invalid or duplicate Markdown session");
        }
        this.sessions.add(sessionId);
        return sessionId;
    }

    assertSession(sessionId) {
        if (!this.sessions.has(sessionId)) {
            throw new Error("Unknown Markdown session");
        }
    }

    claim(sessionId, descriptor, reserved) {
        this.assertSession(sessionId);
        for (const key of descriptor.keys) {
            const occupied = this.entries.get(this.keys.get(key));
            if (occupied) {
                return {kind: "occupied", sessionId: occupied.sessionId};
            }
        }
        const entry = {handle: randomUUID(), targetIdentity: randomUUID(), sessionId, descriptor, state: reserved ? "reserved" : "bound",
            reservationId: reserved ? randomUUID() : undefined, pending: 0};
        this.entries.set(entry.handle, entry);
        descriptor.keys.forEach(key => this.keys.set(key, entry.handle));
        return {kind: "claimed", entry};
    }

    get(sessionId, handle) {
        this.assertSession(sessionId);
        const entry = this.entries.get(handle);
        if (!entry || entry.sessionId !== sessionId) {
            throw new Error("Markdown target is not authorized for this session");
        }
        return entry;
    }

    update(entry, descriptor) {
        for (const key of descriptor.keys) {
            const handle = this.keys.get(key);
            if (handle && handle !== entry.handle) {
                throw new Error("Markdown target identity is occupied");
            }
        }
        entry.descriptor.keys.forEach(key => {
            if (this.keys.get(key) === entry.handle) this.keys.delete(key);
        });
        descriptor.keys.forEach(key => this.keys.set(key, entry.handle));
        entry.descriptor = {...descriptor};
        delete entry.descriptor.bytes;
    }

    commitSaveAs(sessionId, handle, reservationId, previousHandle) {
        const entry = this.get(sessionId, handle);
        if (entry.state !== "reserved" || entry.reservationId !== reservationId || !entry.written || entry.pending) {
            throw new Error("Markdown save target is not ready to commit");
        }
        if (previousHandle && previousHandle !== handle) {
            const previous = this.get(sessionId, previousHandle);
            if (!this.release(previous)) throw new Error("Previous Markdown target is still busy");
        }
        entry.state = "bound";
        entry.reservationId = undefined;
        return entry;
    }

    release(entry) {
        if (entry.pending || entry.state === "indeterminate" || (entry.state === "reserved" && entry.written)) return false;
        entry.descriptor.keys.forEach(key => {
            if (this.keys.get(key) === entry.handle) this.keys.delete(key);
        });
        this.entries.delete(entry.handle);
        return true;
    }

    releaseSaveAs(sessionId, handle, reservationId) {
        const entry = this.get(sessionId, handle);
        if (entry.reservationId !== reservationId || entry.state === "bound") {
            throw new Error("Invalid Markdown target reservation");
        }
        return this.release(entry);
    }

    closeSession(sessionId) {
        this.assertSession(sessionId);
        const entries = [...this.entries.values()].filter(entry => entry.sessionId === sessionId);
        if (entries.some(entry => entry.pending || entry.state === "indeterminate" || (entry.state === "reserved" && entry.written))) return false;
        entries.forEach(entry => this.release(entry));
        this.sessions.delete(sessionId);
        return true;
    }
}

module.exports = {MarkdownTargetRegistry};
