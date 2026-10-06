// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package plugin

import "testing"

// 本文件在沙箱中覆盖 MD5 与 AES-ECB 两个非规范扩展。

func TestCryptoMD5InSandbox(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// digest 可以使用 MD5，结果与 RFC 1321 一致。
	got := rt.await(`(async () => {
		const subtle = crypto.subtle;
		const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

		const digest = await subtle.digest("MD5", new TextEncoderLike("abc"));
		const lower = await subtle.digest("md5", new TextEncoderLike("abc"));
		report([hex(digest), digest.byteLength, hex(lower) === hex(digest)].join(","));
	})()`)
	want := "900150983cd24fb0d6963f7d28e17f72,16,true"
	if got != want {
		t.Fatalf("MD5 digest = %s, want %s", got, want)
	}

	// HMAC-MD5 可用，向量来自 RFC 2202 用例 2。
	got = rt.await(`(async () => {
		const subtle = crypto.subtle;
		const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

		const key = await subtle.importKey("raw", new TextEncoderLike("Jefe"),
			{name: "HMAC", hash: "MD5"}, true, ["sign", "verify"]);
		const data = new TextEncoderLike("what do ya want for nothing?");
		const signature = await subtle.sign("HMAC", key, data);
		const valid = await subtle.verify("HMAC", key, signature, data);

		report([hex(signature), valid, key.algorithm.hash.name, key.algorithm.length].join(","));
	})()`)
	want = "750c783e6ab0b503eaa86e310a5db738,true,MD5,32"
	if got != want {
		t.Fatalf("HMAC-MD5 = %s, want %s", got, want)
	}

	// HKDF 与 PBKDF2 也接受 MD5。
	got = rt.await(`(async () => {
		const subtle = crypto.subtle;
		const results = [];
		for (const params of [
			{name: "HKDF", hash: "MD5", salt: new Uint8Array(8), info: new TextEncoderLike("ctx")},
			{name: "PBKDF2", hash: "MD5", salt: new Uint8Array(8), iterations: 16},
		]) {
			const base = await subtle.importKey("raw", new TextEncoderLike("password"),
				{name: params.name}, false, ["deriveBits"]);
			const bits = await subtle.deriveBits(params, base, 128);
			results.push(params.name + ":" + bits.byteLength);
		}
		report(results.join(","));
	})()`)
	if got != "HKDF:16,PBKDF2:16" {
		t.Fatalf("MD5 derivation = %s, want HKDF:16,PBKDF2:16", got)
	}
}

func TestCryptoMD5RejectedBySignaturesInSandbox(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// RSA 生成密钥时拒绝 MD5。
	got := rt.await(`(async () => {
		const subtle = crypto.subtle;
		const results = [];
		for (const name of ["RSASSA-PKCS1-v1_5", "RSA-PSS", "RSA-OAEP"]) {
			const usages = name === "RSA-OAEP" ? ["encrypt", "decrypt"] : ["sign", "verify"];
			try {
				await subtle.generateKey({name, modulusLength: 2048,
					publicExponent: new Uint8Array([1, 0, 1]), hash: "MD5"}, true, usages);
				results.push("resolved");
			} catch (e) {
				results.push(e.name);
			}
		}
		report(results.join(","));
	})()`)
	want := "NotSupportedError,NotSupportedError,NotSupportedError"
	if got != want {
		t.Fatalf("RSA with MD5 = %s, want %s", got, want)
	}

	// ECDSA 在签名与校验时拒绝 MD5，同一密钥用 SHA-256 仍然可用。
	got = rt.await(`(async () => {
		const subtle = crypto.subtle;
		const pair = await subtle.generateKey({name: "ECDSA", namedCurve: "P-256"},
			true, ["sign", "verify"]);
		const data = new TextEncoderLike("md5 is rejected");
		const results = [];

		try {
			await subtle.sign({name: "ECDSA", hash: "MD5"}, pair.privateKey, data);
			results.push("resolved");
		} catch (e) {
			results.push(e.name);
		}
		try {
			await subtle.verify({name: "ECDSA", hash: "MD5"}, pair.publicKey, new Uint8Array(64), data);
			results.push("resolved");
		} catch (e) {
			results.push(e.name);
		}

		const signature = await subtle.sign({name: "ECDSA", hash: "SHA-256"}, pair.privateKey, data);
		results.push(await subtle.verify({name: "ECDSA", hash: "SHA-256"}, pair.publicKey, signature, data));
		report(results.join(","));
	})()`)
	if got != "NotSupportedError,NotSupportedError,true" {
		t.Fatalf("ECDSA with MD5 = %s, want NotSupportedError,NotSupportedError,true", got)
	}

	// 错误消息说明原因，便于插件作者定位。
	got = rt.await(`(async () => {
		try {
			await crypto.subtle.generateKey({name: "RSA-PSS", modulusLength: 2048,
				publicExponent: new Uint8Array([1, 0, 1]), hash: "MD5"}, true, ["sign"]);
			report("resolved");
		} catch (e) {
			report(e.message);
		}
	})()`)
	if got != "MD5 cannot be used with RSA-PSS because it is not collision resistant" {
		t.Fatalf("message = %q", got)
	}
}

func TestCryptoAESECBInSandbox(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// NIST SP 800-38A F.1.1 的第一个分组，密钥与明文都取自该向量。
	got := rt.await(`(async () => {
		const subtle = crypto.subtle;
		const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
		const unhex = (s) => new Uint8Array(s.match(/../g).map((x) => parseInt(x, 16)));

		const key = await subtle.importKey("raw", unhex("2b7e151628aed2a6abf7158809cf4f3c"),
			{name: "AES-ECB"}, true, ["encrypt", "decrypt"]);
		const plaintext = unhex("6bc1bee22e409f96e93d7e117393172a");

		const ciphertext = await subtle.encrypt({name: "AES-ECB"}, key, plaintext);
		const decrypted = await subtle.decrypt({name: "AES-ECB"}, key, ciphertext);

		report([
			hex(ciphertext).slice(0, 32),
			ciphertext.byteLength,
			hex(decrypted) === hex(plaintext),
			key.algorithm.name,
			key.algorithm.length,
		].join(","));
	})()`)
	// 明文正好一个分组，因此密文是数据分组加一个完整的填充分组。
	want := "3ad77bb40d7a3660a89ecaf32466ef97,32,true,AES-ECB,128"
	if got != want {
		t.Fatalf("AES-ECB = %s, want %s", got, want)
	}

	// 相同明文分组产生相同密文分组，且不需要 iv。
	got = rt.await(`(async () => {
		const subtle = crypto.subtle;
		const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

		const key = await subtle.generateKey({name: "AES-ECB", length: 256}, true, ["encrypt", "decrypt"]);
		const plaintext = new Uint8Array(32).fill(0x41);
		const first = await subtle.encrypt({name: "AES-ECB"}, key, plaintext);
		const second = await subtle.encrypt({name: "AES-ECB"}, key, plaintext);

		const blocks = hex(first);
		report([blocks.slice(0, 32) === blocks.slice(32, 64), hex(first) === hex(second)].join(","));
	})()`)
	if got != "true,true" {
		t.Fatalf("AES-ECB determinism = %s, want true,true", got)
	}

	// 填充被破坏时报 OperationError。
	got = rt.await(`(async () => {
		const subtle = crypto.subtle;
		const key = await subtle.generateKey({name: "AES-ECB", length: 128}, true, ["encrypt", "decrypt"]);
		const ciphertext = await subtle.encrypt({name: "AES-ECB"}, key, new TextEncoderLike("legacy"));

		const tampered = new Uint8Array(ciphertext);
		tampered[tampered.length - 1] ^= 0xff;
		const results = [];
		try {
			await subtle.decrypt({name: "AES-ECB"}, key, tampered);
			results.push("resolved");
		} catch (e) {
			results.push(e.name);
		}
		// 长度不是分组整数倍。
		try {
			await subtle.decrypt({name: "AES-ECB"}, key, new Uint8Array(17));
			results.push("resolved");
		} catch (e) {
			results.push(e.name);
		}
		report(results.join(","));
	})()`)
	if got != "OperationError,OperationError" {
		t.Fatalf("AES-ECB errors = %s, want OperationError twice", got)
	}
}

func TestCryptoAESECBRejectsWrappingInSandbox(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// AES-ECB 不支持包装密钥，声明该用法时即报错。
	got := rt.await(`(async () => {
		const subtle = crypto.subtle;
		const results = [];
		for (const usages of [["wrapKey"], ["unwrapKey"], ["encrypt", "wrapKey"]]) {
			try {
				await subtle.generateKey({name: "AES-ECB", length: 256}, true, usages);
				results.push("resolved");
			} catch (e) {
				results.push(e.name);
			}
		}

		// 加解密密钥也不能当作包装密钥。
		const key = await subtle.generateKey({name: "AES-ECB", length: 256}, true, ["encrypt", "decrypt"]);
		const target = await subtle.generateKey({name: "AES-GCM", length: 128}, true, ["encrypt"]);
		try {
			await subtle.wrapKey("raw", target, key, {name: "AES-ECB"});
			results.push("resolved");
		} catch (e) {
			results.push(e.name);
		}
		report(results.join(","));
	})()`)
	want := "SyntaxError,SyntaxError,SyntaxError,InvalidAccessError"
	if got != want {
		t.Fatalf("AES-ECB wrapping = %s, want %s", got, want)
	}
}

func TestCryptoAESECBKeyFormatsInSandbox(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// raw 与 jwk 往返，jwk 不含 alg 成员。
	got := rt.await(`(async () => {
		const subtle = crypto.subtle;
		const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

		const key = await subtle.generateKey({name: "AES-ECB", length: 256}, true, ["encrypt", "decrypt"]);
		const raw = await subtle.exportKey("raw", key);
		const jwk = await subtle.exportKey("jwk", key);

		const fromRaw = await subtle.importKey("raw", raw, {name: "AES-ECB"}, true, ["encrypt", "decrypt"]);
		const fromJWK = await subtle.importKey("jwk", jwk, {name: "AES-ECB"}, true, ["encrypt", "decrypt"]);

		const plaintext = new TextEncoderLike("formats");
		const ciphertext = await subtle.encrypt({name: "AES-ECB"}, key, plaintext);
		const viaRaw = await subtle.decrypt({name: "AES-ECB"}, fromRaw, ciphertext);
		const viaJWK = await subtle.decrypt({name: "AES-ECB"}, fromJWK, ciphertext);

		report([
			raw.byteLength,
			jwk.kty,
			jwk.alg === undefined,
			typeof jwk.k,
			hex(viaRaw) === hex(plaintext),
			hex(viaJWK) === hex(plaintext),
		].join(","));
	})()`)
	want := "32,oct,true,string,true,true"
	if got != want {
		t.Fatalf("AES-ECB formats = %s, want %s", got, want)
	}

	// 对称密钥不支持 spki 与 pkcs8。
	got = rt.await(`(async () => {
		const subtle = crypto.subtle;
		const key = await subtle.generateKey({name: "AES-ECB", length: 128}, true, ["encrypt"]);
		const results = [];
		for (const format of ["spki", "pkcs8"]) {
			try {
				await subtle.exportKey(format, key);
				results.push("resolved");
			} catch (e) {
				results.push(e.name);
			}
		}
		report(results.join(","));
	})()`)
	if got != "NotSupportedError,NotSupportedError" {
		t.Fatalf("AES-ECB unsupported formats = %s, want NotSupportedError twice", got)
	}
}
