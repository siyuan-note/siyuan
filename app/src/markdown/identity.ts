// Match Lute.NewNodeID (ast/node.go): local timestamp + seven lowercase letters
// or digits. This also works before Lute loads and in the kernel-free main process.
export const createMarkdownInstanceId = (source: Pick<Crypto, "getRandomValues"> = globalThis.crypto, now = new Date()): string => {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    const timestamp = [now.getFullYear().toString().padStart(4, "0"), ...[now.getMonth() + 1, now.getDate(),
        now.getHours(), now.getMinutes(), now.getSeconds()].map(value => value.toString().padStart(2, "0"))].join("");
    // Rejection sampling avoids favoring characters when reducing bytes modulo 36.
    let suffix = "";
    while (suffix.length < 7) {
        for (const value of source.getRandomValues(new Uint8Array(16))) {
            if (value < 252 && suffix.length < 7) suffix += alphabet[value % alphabet.length];
        }
    }
    return timestamp + "-" + suffix;
};

// Capabilities and unforgeable preservation markers are secrets, not document
// IDs. Keep 256 random bits without UUID formatting or predictable timestamps.
export const createMarkdownCapabilityToken = (source: Pick<Crypto, "getRandomValues"> = globalThis.crypto): string =>
    Array.from(source.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, "0")).join("");

export const createAvailableMarkdownId = (isUsed: (id: string) => boolean, createId: () => string = createMarkdownInstanceId): string => {
    for (let attempt = 0; attempt < 8; attempt++) {
        const id = createId();
        if (!isUsed(id)) return id;
    }
    throw new Error("Unable to allocate a unique Markdown ID");
};
