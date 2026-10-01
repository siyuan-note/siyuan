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

func TestCryptoGenerateKeyPairShape(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// 非对称算法返回含 publicKey 与 privateKey 的 CryptoKeyPair。
	got := rt.await(`(async () => {
		const pair = await siyuan.crypto.subtle.generateKey(
			{name: "ECDSA", namedCurve: "P-256"}, true, ["sign", "verify"]);
		report([
			typeof pair,
			Object.keys(pair).sort().join("|"),
			pair.privateKey.type,
			pair.publicKey.type,
			pair.privateKey.usages.join("|"),
			pair.publicKey.usages.join("|"),
			pair.publicKey.algorithm.namedCurve,
			pair.privateKey.extractable,
			pair.publicKey.extractable,
		].join(","));
	})()`)
	want := "object,privateKey|publicKey,private,public,sign,verify,P-256,true,true"
	if got != want {
		t.Fatalf("ECDSA key pair = %s, want %s", got, want)
	}

	// RSA 的 algorithm 暴露 modulusLength 与 publicExponent。
	got = rt.await(`(async () => {
		const pair = await siyuan.crypto.subtle.generateKey(
			{name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"},
			true, ["encrypt", "decrypt"]);
		const alg = pair.publicKey.algorithm;
		report([
			alg.name,
			alg.modulusLength,
			alg.publicExponent instanceof Uint8Array,
			[...alg.publicExponent].join("."),
			alg.hash.name,
			pair.publicKey.usages.join("|"),
			pair.privateKey.usages.join("|"),
		].join(","));
	})()`)
	want = "RSA-OAEP,2048,true,1.0.1,SHA-256,encrypt,decrypt"
	if got != want {
		t.Fatalf("RSA key pair = %s, want %s", got, want)
	}

	// 不可导出时只有私钥不可导出，公钥始终可导出。
	got = rt.await(`(async () => {
		const pair = await siyuan.crypto.subtle.generateKey({name: "Ed25519"}, false, ["sign", "verify"]);
		report([pair.privateKey.extractable, pair.publicKey.extractable].join(","));
	})()`)
	if got != "false,true" {
		t.Fatalf("extractable = %s, want false,true", got)
	}
}

func TestCryptoPublicExponentIsNotAliased(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// publicExponent 由内核保留并被公私钥共享，脚本修改它不应影响后续读取。
	got := rt.await(`(async () => {
		const pair = await siyuan.crypto.subtle.generateKey(
			{name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"},
			true, ["encrypt", "decrypt"]);

		pair.publicKey.algorithm.publicExponent.fill(0);
		report([
			[...pair.publicKey.algorithm.publicExponent].join("."),
			[...pair.privateKey.algorithm.publicExponent].join("."),
		].join(","));
	})()`)
	// 第一个值是被改写的那份副本，第二个必须仍是原值。
	if got != "0.0.0,1.0.1" {
		t.Fatalf("publicExponent = %s, want 0.0.0,1.0.1", got)
	}
}

func TestCryptoAsymmetricSignVerify(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	cases := []struct {
		label    string
		generate string
		sign     string
	}{
		{"ECDSA", `{name: "ECDSA", namedCurve: "P-256"}`, `{name: "ECDSA", hash: "SHA-256"}`},
		{"Ed25519", `{name: "Ed25519"}`, `"Ed25519"`},
		{"RSASSA-PKCS1-v1_5",
			`{name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"}`,
			`"RSASSA-PKCS1-v1_5"`},
		{"RSA-PSS",
			`{name: "RSA-PSS", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"}`,
			`{name: "RSA-PSS", saltLength: 32}`},
	}

	for _, c := range cases {
		got := rt.await(`(async () => {
			const subtle = siyuan.crypto.subtle;
			const pair = await subtle.generateKey(` + c.generate + `, true, ["sign", "verify"]);
			const data = new TextEncoderLike("sign me");

			const signature = await subtle.sign(` + c.sign + `, pair.privateKey, data);
			const valid = await subtle.verify(` + c.sign + `, pair.publicKey, signature, data);

			const tampered = new Uint8Array(signature);
			tampered[0] ^= 0xff;
			const invalid = await subtle.verify(` + c.sign + `, pair.publicKey, tampered, data);

			const other = await subtle.verify(` + c.sign + `, pair.publicKey, signature, new TextEncoderLike("other"));
			report([valid, invalid, other, signature instanceof ArrayBuffer].join(","));
		})()`)
		if got != "true,false,false,true" {
			t.Errorf("%s = %s, want true,false,false,true", c.label, got)
		}
	}
}

func TestCryptoECDSAUsesOperationHash(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// ECDSA 密钥不携带 hash，摘要算法由签名参数指定，同一密钥可配不同摘要。
	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const pair = await subtle.generateKey({name: "ECDSA", namedCurve: "P-256"}, true, ["sign", "verify"]);
		const data = new TextEncoderLike("hash choice");

		const results = [];
		for (const hash of ["SHA-256", "SHA-384", "SHA-512"]) {
			const signature = await subtle.sign({name: "ECDSA", hash}, pair.privateKey, data);
			results.push(await subtle.verify({name: "ECDSA", hash}, pair.publicKey, signature, data));
		}

		// 用不同摘要校验必须失败。
		const signature = await subtle.sign({name: "ECDSA", hash: "SHA-256"}, pair.privateKey, data);
		results.push(await subtle.verify({name: "ECDSA", hash: "SHA-384"}, pair.publicKey, signature, data));

		report([pair.publicKey.algorithm.hash === undefined, results.join("|")].join(","));
	})()`)
	want := "true,true|true|true|false"
	if got != want {
		t.Fatalf("ECDSA hash handling = %s, want %s", got, want)
	}
}

func TestCryptoRSAOAEPEncryptDecrypt(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const pair = await subtle.generateKey(
			{name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"},
			true, ["encrypt", "decrypt"]);
		const data = new TextEncoderLike("rsa oaep payload");

		const ciphertext = await subtle.encrypt({name: "RSA-OAEP"}, pair.publicKey, data);
		const decrypted = await subtle.decrypt({name: "RSA-OAEP"}, pair.privateKey, ciphertext);
		const same = [...new Uint8Array(decrypted)].join(",") === [...data].join(",");

		// label 参与认证。
		const label = new TextEncoderLike("label");
		const labeled = await subtle.encrypt({name: "RSA-OAEP", label}, pair.publicKey, data);
		let labelMismatch = "resolved";
		try {
			await subtle.decrypt({name: "RSA-OAEP"}, pair.privateKey, labeled);
		} catch (e) {
			labelMismatch = e.name;
		}

		report([same, ciphertext.byteLength, labelMismatch].join(","));
	})()`)
	want := "true,256,OperationError"
	if got != want {
		t.Fatalf("RSA-OAEP = %s, want %s", got, want)
	}

	// 公钥不能解密，私钥不能加密。
	got = rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const pair = await subtle.generateKey(
			{name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"},
			true, ["encrypt", "decrypt"]);
		const results = [];
		for (const [op, key] of [["encrypt", pair.privateKey], ["decrypt", pair.publicKey]]) {
			try {
				await subtle[op]({name: "RSA-OAEP"}, key, new Uint8Array(8));
				results.push("resolved");
			} catch (e) {
				results.push(e.name);
			}
		}
		report(results.join(","));
	})()`)
	if got != "InvalidAccessError,InvalidAccessError" {
		t.Fatalf("key direction = %s, want InvalidAccessError twice", got)
	}
}

func TestCryptoECDHDeriveInSandbox(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	for _, generate := range []string{`{name: "ECDH", namedCurve: "P-256"}`, `{name: "X25519"}`} {
		got := rt.await(`(async () => {
			const subtle = siyuan.crypto.subtle;
			const alice = await subtle.generateKey(` + generate + `, true, ["deriveBits", "deriveKey"]);
			const bob = await subtle.generateKey(` + generate + `, true, ["deriveBits", "deriveKey"]);
			const name = alice.privateKey.algorithm.name;

			const fromAlice = await subtle.deriveBits({name, public: bob.publicKey}, alice.privateKey, 256);
			const fromBob = await subtle.deriveBits({name, public: alice.publicKey}, bob.privateKey, 256);
			const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

			// 派生出的 AES 密钥可用于加解密。
			const key = await subtle.deriveKey({name, public: bob.publicKey}, alice.privateKey,
				{name: "AES-GCM", length: 256}, true, ["encrypt", "decrypt"]);
			const iv = siyuan.crypto.getRandomValues(new Uint8Array(12));
			const payload = new TextEncoderLike("shared");
			const ciphertext = await subtle.encrypt({name: "AES-GCM", iv}, key, payload);
			const plaintext = await subtle.decrypt({name: "AES-GCM", iv}, key, ciphertext);

			report([
				hex(fromAlice) === hex(fromBob),
				fromAlice.byteLength,
				alice.publicKey.usages.length,
				[...new Uint8Array(plaintext)].join(",") === [...payload].join(","),
			].join(","));
		})()`)
		want := "true,32,0,true"
		if got != want {
			t.Errorf("%s = %s, want %s", generate, got, want)
		}
	}

	// 对方公钥算法不符时报 InvalidAccessError。
	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const ecdh = await subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, true, ["deriveBits"]);
		const x = await subtle.generateKey({name: "X25519"}, true, ["deriveBits"]);
		try {
			await subtle.deriveBits({name: "ECDH", public: x.publicKey}, ecdh.privateKey, 128);
			report("resolved");
		} catch (e) {
			report(e.name);
		}
	})()`)
	if got != "InvalidAccessError" {
		t.Fatalf("mismatched public key = %s, want InvalidAccessError", got)
	}

	// public 成员必须是 CryptoKey。
	got = rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const ecdh = await subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, true, ["deriveBits"]);
		try {
			await subtle.deriveBits({name: "ECDH", public: {}}, ecdh.privateKey, 128);
			report("resolved");
		} catch (e) {
			report(e.constructor.name);
		}
	})()`)
	if got != "TypeError" {
		t.Fatalf("invalid public member = %s, want TypeError", got)
	}
}

func TestCryptoKeyFormatsInSandbox(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// spki 与 pkcs8 往返。
	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const alg = {name: "ECDSA", namedCurve: "P-256"};
		const pair = await subtle.generateKey(alg, true, ["sign", "verify"]);

		const spki = await subtle.exportKey("spki", pair.publicKey);
		const pkcs8 = await subtle.exportKey("pkcs8", pair.privateKey);
		const publicKey = await subtle.importKey("spki", spki, alg, true, ["verify"]);
		const privateKey = await subtle.importKey("pkcs8", pkcs8, alg, true, ["sign"]);

		const data = new TextEncoderLike("formats");
		const signature = await subtle.sign({name: "ECDSA", hash: "SHA-256"}, privateKey, data);
		const valid = await subtle.verify({name: "ECDSA", hash: "SHA-256"}, publicKey, signature, data);

		report([spki instanceof ArrayBuffer, pkcs8 instanceof ArrayBuffer,
			publicKey.type, privateKey.type, valid].join(","));
	})()`)
	want := "true,true,public,private,true"
	if got != want {
		t.Fatalf("spki/pkcs8 round trip = %s, want %s", got, want)
	}

	// jwk 往返，私钥含 d 成员。
	got = rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const alg = {name: "ECDSA", namedCurve: "P-256"};
		const pair = await subtle.generateKey(alg, true, ["sign", "verify"]);

		const publicJwk = await subtle.exportKey("jwk", pair.publicKey);
		const privateJwk = await subtle.exportKey("jwk", pair.privateKey);
		const reimported = await subtle.importKey("jwk", privateJwk, alg, true, ["sign"]);
		const again = await subtle.exportKey("jwk", reimported);

		report([publicJwk.kty, publicJwk.crv, publicJwk.alg, publicJwk.ext,
			publicJwk.d === undefined, typeof privateJwk.d,
			privateJwk.d === again.d, privateJwk.x === again.x].join(","));
	})()`)
	want = "EC,P-256,ES256,true,true,string,true,true"
	if got != want {
		t.Fatalf("jwk round trip = %s, want %s", got, want)
	}

	// raw 格式导出 Ed25519 与 ECDH 公钥。
	got = rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const ed = await subtle.generateKey({name: "Ed25519"}, true, ["sign", "verify"]);
		const raw = await subtle.exportKey("raw", ed.publicKey);
		const reimported = await subtle.importKey("raw", raw, {name: "Ed25519"}, true, ["verify"]);

		const data = new TextEncoderLike("raw public key");
		const signature = await subtle.sign("Ed25519", ed.privateKey, data);
		const valid = await subtle.verify("Ed25519", reimported, signature, data);

		let privateRaw = "resolved";
		try {
			await subtle.exportKey("raw", ed.privateKey);
		} catch (e) {
			privateRaw = e.name;
		}
		report([raw.byteLength, valid, privateRaw].join(","));
	})()`)
	want = "32,true,InvalidAccessError"
	if got != want {
		t.Fatalf("raw format = %s, want %s", got, want)
	}

	// 算法不支持的格式报 NotSupportedError，不受密钥数据影响。
	got = rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const results = [];
		const key = await subtle.generateKey({name: "AES-GCM", length: 128}, true, ["encrypt"]);
		for (const format of ["spki", "pkcs8"]) {
			try {
				await subtle.exportKey(format, key);
				results.push("resolved");
			} catch (e) {
				results.push(e.name);
			}
		}
		try {
			await subtle.importKey("pkcs8", new Uint8Array(8), {name: "HMAC", hash: "SHA-256"}, true, ["sign"]);
			results.push("resolved");
		} catch (e) {
			results.push(e.name);
		}
		report(results.join(","));
	})()`)
	want = "NotSupportedError,NotSupportedError,NotSupportedError"
	if got != want {
		t.Fatalf("unsupported formats = %s, want %s", got, want)
	}
}

func TestCryptoAESKWInSandbox(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const wrapping = await subtle.generateKey({name: "AES-KW", length: 256}, true, ["wrapKey", "unwrapKey"]);
		const target = await subtle.generateKey({name: "AES-GCM", length: 128}, true, ["encrypt", "decrypt"]);

		const wrapped = await subtle.wrapKey("raw", target, wrapping, "AES-KW");
		const unwrapped = await subtle.unwrapKey("raw", wrapped, wrapping, "AES-KW",
			{name: "AES-GCM"}, true, ["encrypt", "decrypt"]);

		const before = await subtle.exportKey("raw", target);
		const after = await subtle.exportKey("raw", unwrapped);
		const same = [...new Uint8Array(before)].join(",") === [...new Uint8Array(after)].join(",");

		// 篡改包装结果必须导致完整性校验失败。
		const tampered = new Uint8Array(wrapped);
		tampered[0] ^= 0xff;
		let integrity = "resolved";
		try {
			await subtle.unwrapKey("raw", tampered, wrapping, "AES-KW", {name: "AES-GCM"}, true, ["encrypt"]);
		} catch (e) {
			integrity = e.name;
		}

		report([wrapped.byteLength, same, integrity, wrapping.algorithm.name].join(","));
	})()`)
	want := "24,true,OperationError,AES-KW"
	if got != want {
		t.Fatalf("AES-KW = %s, want %s", got, want)
	}
}

func TestCryptoWrapsAsymmetricKeys(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// 用 AES-GCM 包装 pkcs8 私钥，解包装后仍能签名。
	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const alg = {name: "ECDSA", namedCurve: "P-256"};
		const pair = await subtle.generateKey(alg, true, ["sign", "verify"]);
		const wrapping = await subtle.generateKey({name: "AES-GCM", length: 256}, true, ["wrapKey", "unwrapKey"]);
		const iv = siyuan.crypto.getRandomValues(new Uint8Array(12));

		const wrapped = await subtle.wrapKey("pkcs8", pair.privateKey, wrapping, {name: "AES-GCM", iv});
		const unwrapped = await subtle.unwrapKey("pkcs8", wrapped, wrapping, {name: "AES-GCM", iv},
			alg, true, ["sign"]);

		const data = new TextEncoderLike("wrapped key");
		const signature = await subtle.sign({name: "ECDSA", hash: "SHA-256"}, unwrapped, data);
		const valid = await subtle.verify({name: "ECDSA", hash: "SHA-256"}, pair.publicKey, signature, data);
		report([unwrapped.type, valid].join(","));
	})()`)
	if got != "private,true" {
		t.Fatalf("wrapped private key = %s, want private,true", got)
	}
}

func TestCryptoAsymmetricLimits(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// RSA 的公开指数限制。
	got := rt.await(`(async () => {
		try {
			await siyuan.crypto.subtle.generateKey(
				{name: "RSA-PSS", modulusLength: 2048, publicExponent: new Uint8Array([3]), hash: "SHA-256"},
				true, ["sign"]);
			report("resolved");
		} catch (e) {
			report(e.name);
		}
	})()`)
	if got != "NotSupportedError" {
		t.Fatalf("publicExponent 3 = %s, want NotSupportedError", got)
	}

	// RSA-PSS 的零长度盐。
	got = rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const pair = await subtle.generateKey(
			{name: "RSA-PSS", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"},
			true, ["sign"]);
		try {
			await subtle.sign({name: "RSA-PSS", saltLength: 0}, pair.privateKey, new Uint8Array(4));
			report("resolved");
		} catch (e) {
			report(e.name);
		}
	})()`)
	if got != "NotSupportedError" {
		t.Fatalf("saltLength 0 = %s, want NotSupportedError", got)
	}

	// 未知曲线。
	got = rt.await(`(async () => {
		try {
			await siyuan.crypto.subtle.generateKey({name: "ECDSA", namedCurve: "P-224"}, true, ["sign"]);
			report("resolved");
		} catch (e) {
			report(e.name);
		}
	})()`)
	if got != "NotSupportedError" {
		t.Fatalf("unknown curve = %s, want NotSupportedError", got)
	}

	// 生成密钥对时必须至少有一个私钥用法。
	got = rt.await(`(async () => {
		try {
			await siyuan.crypto.subtle.generateKey({name: "ECDSA", namedCurve: "P-256"}, true, ["verify"]);
			report("resolved");
		} catch (e) {
			report(e.name);
		}
	})()`)
	if got != "SyntaxError" {
		t.Fatalf("verify-only usages = %s, want SyntaxError", got)
	}
}
