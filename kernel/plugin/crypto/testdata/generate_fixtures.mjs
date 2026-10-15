// 用 Node 的 WebCrypto 生成跨实现互通夹具，供 interop_test.go 使用。
// 重新生成：node generate_fixtures.mjs > interop.json
import crypto, { webcrypto } from "node:crypto";

const b64 = (buf) => Buffer.from(buf).toString("base64");
const encode = (text) => new TextEncoder().encode(text);

const message = "siyuan kernel plugin interop";
const fixtures = { message, cases: [] };

// 签名算法：导出公私钥并给出 Node 生成的签名。
const signCases = [
    { label: "RSASSA-PKCS1-v1_5 SHA-256", algorithm: { name: "RSASSA-PKCS1-v1_5" }, generate: { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" } },
    { label: "RSA-PSS SHA-256 salt 32", algorithm: { name: "RSA-PSS", saltLength: 32 }, generate: { name: "RSA-PSS", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" } },
    { label: "ECDSA P-256 SHA-256", algorithm: { name: "ECDSA", hash: "SHA-256" }, generate: { name: "ECDSA", namedCurve: "P-256" } },
    { label: "ECDSA P-384 SHA-384", algorithm: { name: "ECDSA", hash: "SHA-384" }, generate: { name: "ECDSA", namedCurve: "P-384" } },
    { label: "ECDSA P-521 SHA-512", algorithm: { name: "ECDSA", hash: "SHA-512" }, generate: { name: "ECDSA", namedCurve: "P-521" } },
    { label: "Ed25519", algorithm: { name: "Ed25519" }, generate: { name: "Ed25519" } },
];

for (const c of signCases) {
    const pair = await webcrypto.subtle.generateKey(c.generate, true, ["sign", "verify"]);
    const signature = await webcrypto.subtle.sign(c.algorithm, pair.privateKey, encode(message));
    fixtures.cases.push({
        kind: "sign",
        label: c.label,
        generate: { ...c.generate, publicExponent: undefined },
        algorithm: c.algorithm,
        // ECDSA 的摘要算法在签名参数里，RSA 的在生成参数里。
        hash: c.generate.hash ?? c.algorithm.hash ?? null,
        namedCurve: c.generate.namedCurve ?? null,
        spki: b64(await webcrypto.subtle.exportKey("spki", pair.publicKey)),
        pkcs8: b64(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey)),
        publicJwk: await webcrypto.subtle.exportKey("jwk", pair.publicKey),
        privateJwk: await webcrypto.subtle.exportKey("jwk", pair.privateKey),
        signature: b64(signature),
    });
}

// RSA-OAEP：给出 Node 生成的密文，内核需要能解密。
for (const hash of ["SHA-1", "SHA-256"]) {
    const pair = await webcrypto.subtle.generateKey(
        { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash },
        true,
        ["encrypt", "decrypt"],
    );
    const label = encode("oaep label");
    fixtures.cases.push({
        kind: "rsa-oaep",
        label: `RSA-OAEP ${hash}`,
        hash,
        pkcs8: b64(await webcrypto.subtle.exportKey("pkcs8", pair.privateKey)),
        spki: b64(await webcrypto.subtle.exportKey("spki", pair.publicKey)),
        ciphertext: b64(await webcrypto.subtle.encrypt({ name: "RSA-OAEP" }, pair.publicKey, encode(message))),
        labeledCiphertext: b64(await webcrypto.subtle.encrypt({ name: "RSA-OAEP", label }, pair.publicKey, encode(message))),
        labelText: "oaep label",
    });
}

// AES 对称算法：给出 Node 生成的密文。
const aesKeyBytes = new Uint8Array(32).fill(7);
const iv12 = new Uint8Array(12).fill(1);
const iv16 = new Uint8Array(16).fill(2);
const counter = new Uint8Array(16).fill(0);

const aesKey = (name) => webcrypto.subtle.importKey("raw", aesKeyBytes, { name }, true, ["encrypt", "decrypt"]);

fixtures.cases.push({
    kind: "aes",
    label: "AES-GCM 256",
    algorithm: { name: "AES-GCM" },
    keyBytes: b64(aesKeyBytes),
    iv: b64(iv12),
    ciphertext: b64(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: iv12 }, await aesKey("AES-GCM"), encode(message))),
});

fixtures.cases.push({
    kind: "aes",
    label: "AES-GCM 256 with AAD and 96-bit tag",
    algorithm: { name: "AES-GCM", tagLength: 96 },
    keyBytes: b64(aesKeyBytes),
    iv: b64(iv12),
    additionalData: b64(encode("aad")),
    tagLength: 96,
    ciphertext: b64(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: iv12, additionalData: encode("aad"), tagLength: 96 }, await aesKey("AES-GCM"), encode(message))),
});

fixtures.cases.push({
    kind: "aes",
    label: "AES-CBC 256",
    algorithm: { name: "AES-CBC" },
    keyBytes: b64(aesKeyBytes),
    iv: b64(iv16),
    ciphertext: b64(await webcrypto.subtle.encrypt({ name: "AES-CBC", iv: iv16 }, await aesKey("AES-CBC"), encode(message))),
});

fixtures.cases.push({
    kind: "aes",
    label: "AES-CTR 256 with 64-bit counter",
    algorithm: { name: "AES-CTR", length: 64 },
    keyBytes: b64(aesKeyBytes),
    counter: b64(counter),
    counterLength: 64,
    ciphertext: b64(await webcrypto.subtle.encrypt({ name: "AES-CTR", counter, length: 64 }, await aesKey("AES-CTR"), encode(message))),
});

// AES-KW：给出 Node 包装后的密钥。
const kwKey = await webcrypto.subtle.importKey("raw", aesKeyBytes, { name: "AES-KW" }, true, ["wrapKey", "unwrapKey"]);
const wrapTarget = await webcrypto.subtle.importKey("raw", new Uint8Array(16).fill(9), { name: "AES-GCM" }, true, ["encrypt"]);
fixtures.cases.push({
    kind: "aes-kw",
    label: "AES-KW 256 wrapping a 128-bit key",
    keyBytes: b64(aesKeyBytes),
    targetBytes: b64(new Uint8Array(16).fill(9)),
    wrapped: b64(await webcrypto.subtle.wrapKey("raw", wrapTarget, kwKey, "AES-KW")),
});

// HMAC 与 KDF：给出 Node 计算的结果。
const hmacKeyBytes = new Uint8Array(32).fill(3);
for (const hash of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"]) {
    const key = await webcrypto.subtle.importKey("raw", hmacKeyBytes, { name: "HMAC", hash }, true, ["sign"]);
    fixtures.cases.push({
        kind: "hmac",
        label: `HMAC ${hash}`,
        hash,
        keyBytes: b64(hmacKeyBytes),
        signature: b64(await webcrypto.subtle.sign("HMAC", key, encode(message))),
        jwk: await webcrypto.subtle.exportKey("jwk", key),
    });
}

const kdfBase = async (name) => webcrypto.subtle.importKey("raw", encode("password"), name, false, ["deriveBits"]);
for (const hash of ["SHA-256", "SHA-512"]) {
    fixtures.cases.push({
        kind: "hkdf",
        label: `HKDF ${hash}`,
        hash,
        secret: b64(encode("password")),
        salt: b64(encode("salt")),
        info: b64(encode("info")),
        length: 256,
        bits: b64(await webcrypto.subtle.deriveBits({ name: "HKDF", hash, salt: encode("salt"), info: encode("info") }, await kdfBase("HKDF"), 256)),
    });
    fixtures.cases.push({
        kind: "pbkdf2",
        label: `PBKDF2 ${hash} 1000 iterations`,
        hash,
        secret: b64(encode("password")),
        salt: b64(encode("salt")),
        iterations: 1000,
        length: 256,
        bits: b64(await webcrypto.subtle.deriveBits({ name: "PBKDF2", hash, salt: encode("salt"), iterations: 1000 }, await kdfBase("PBKDF2"), 256)),
    });
}

// ECDH 与 X25519：给出双方密钥与 Node 计算的共享密钥。
for (const [label, generate, namedCurve] of [
    ["ECDH P-256", { name: "ECDH", namedCurve: "P-256" }, "P-256"],
    ["ECDH P-384", { name: "ECDH", namedCurve: "P-384" }, "P-384"],
    ["X25519", { name: "X25519" }, null],
]) {
    const alice = await webcrypto.subtle.generateKey(generate, true, ["deriveBits"]);
    const bob = await webcrypto.subtle.generateKey(generate, true, ["deriveBits"]);
    fixtures.cases.push({
        kind: "ecdh",
        label,
        algorithm: generate.name,
        namedCurve,
        alicePkcs8: b64(await webcrypto.subtle.exportKey("pkcs8", alice.privateKey)),
        bobSpki: b64(await webcrypto.subtle.exportKey("spki", bob.publicKey)),
        length: 256,
        bits: b64(await webcrypto.subtle.deriveBits({ name: generate.name, public: bob.publicKey }, alice.privateKey, 256)),
    });
}

// MD5 与 AES-ECB 是内核的非规范扩展，Node 的 WebCrypto 不支持它们，
// 因此这两类夹具改用 Node 的传统 crypto 接口，其底层同样是 OpenSSL。
for (const [label, input] of [
    ["MD5 of the message", message],
    ["MD5 of an empty input", ""],
]) {
    fixtures.cases.push({
        kind: "md5",
        label,
        input: b64(encode(input)),
        digest: b64(crypto.createHash("md5").update(input, "utf8").digest()),
    });
}

for (const [label, keyBytes] of [
    ["HMAC-MD5 256-bit key", hmacKeyBytes],
    ["HMAC-MD5 short key", new Uint8Array(8).fill(0x0b)],
]) {
    const mac = crypto.createHmac("md5", Buffer.from(keyBytes));
    mac.update(message, "utf8");
    fixtures.cases.push({
        kind: "hmac-md5",
        label,
        keyBytes: b64(keyBytes),
        signature: b64(mac.digest()),
    });
}

// AES-ECB 使用 PKCS#7 填充，与内核一致，因此密文可以逐字节比较。
for (const [label, bits] of [["AES-ECB 128", 128], ["AES-ECB 256", 256]]) {
    const keyBytes = aesKeyBytes.slice(0, bits / 8);
    const cipher = crypto.createCipheriv(`aes-${bits}-ecb`, Buffer.from(keyBytes), null);
    const ciphertext = Buffer.concat([cipher.update(message, "utf8"), cipher.final()]);
    fixtures.cases.push({
        kind: "aes-ecb",
        label,
        keyBytes: b64(keyBytes),
        ciphertext: b64(ciphertext),
    });
}

process.stdout.write(JSON.stringify(fixtures, null, "\t") + "\n");
