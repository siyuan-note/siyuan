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

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/siyuan-note/siyuan/kernel/model"
)

// cryptoTestRuntime 启动一个注入了 siyuan.crypto 的事件循环，
// 并提供在循环上执行脚本、等待异步结果的辅助方法。
type cryptoTestRuntime struct {
	t      *testing.T
	plugin *KernelPlugin
	loop   *eventloop.EventLoop
	done   chan string
}

func newCryptoTestRuntime(t *testing.T) *cryptoTestRuntime {
	t.Helper()

	ctx, cancel := context.WithCancel(context.Background())
	p := &KernelPlugin{Petal: &model.Petal{Name: "test-crypto"}, context: ctx, cancel: cancel}
	loop := eventloop.NewEventLoop()
	p.worker.Start(loop)
	loop.Start()
	t.Cleanup(func() {
		cancel()
		loop.Stop()
	})

	ret := &cryptoTestRuntime{t: t, plugin: p, loop: loop, done: make(chan string, 8)}

	if _, err := p.worker.RunSync(func(rt *goja.Runtime) (any, error) {
		siyuan := rt.NewObject()
		if err := injectCrypto(p, rt, siyuan); err != nil {
			return nil, err
		}
		if err := rt.Set("siyuan", siyuan); err != nil {
			return nil, err
		}
		// report 供脚本回传结果，done 供等待异步完成。
		if err := rt.Set("report", func(call goja.FunctionCall) goja.Value {
			ret.done <- call.Argument(0).String()
			return goja.Undefined()
		}); err != nil {
			return nil, err
		}
		// 这里只注入 siyuan.crypto，没有启用 TextEncoder，测试脚本用它把 ASCII 字符串转为 Uint8Array。
		if _, err := rt.RunString(`function TextEncoderLike(text) {
			const bytes = new Uint8Array(text.length);
			for (let i = 0; i < text.length; i++) {
				bytes[i] = text.charCodeAt(i);
			}
			return bytes;
		}`); err != nil {
			return nil, err
		}
		return nil, nil
	}); err != nil {
		t.Fatalf("inject siyuan.crypto: %v", err)
	}
	return ret
}

// run 在事件循环上同步执行脚本并返回结果值。
func (r *cryptoTestRuntime) run(script string) goja.Value {
	r.t.Helper()

	var value goja.Value
	if _, err := r.plugin.worker.RunSync(func(rt *goja.Runtime) (any, error) {
		result, err := rt.RunString(script)
		value = result
		return nil, err
	}); err != nil {
		r.t.Fatalf("script failed: %v\n%s", err, script)
	}
	return value
}

// runError 在事件循环上执行脚本并返回抛出的异常文本。
func (r *cryptoTestRuntime) runError(script string) string {
	r.t.Helper()

	var message string
	if _, err := r.plugin.worker.RunSync(func(rt *goja.Runtime) (any, error) {
		if _, runErr := rt.RunString(script); runErr != nil {
			message = runErr.Error()
		}
		return nil, nil
	}); err != nil {
		r.t.Fatalf("worker run: %v", err)
	}
	if message == "" {
		r.t.Fatalf("script did not throw:\n%s", script)
	}
	return message
}

// await 执行一段以 report() 回传结果的异步脚本，并等待结果。
func (r *cryptoTestRuntime) await(script string) string {
	r.t.Helper()
	r.run(script)

	select {
	case result := <-r.done:
		return result
	case <-time.After(10 * time.Second):
		r.t.Fatalf("timed out waiting for:\n%s", script)
		return ""
	}
}

func TestCryptoGetRandomValues(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// 返回值必须是传入的同一个数组，且已被填充。
	got := rt.run(`(() => {
		const array = new Uint8Array(32);
		const returned = siyuan.crypto.getRandomValues(array);
		const filled = array.some((v) => v !== 0);
		return [returned === array, filled].join(",");
	})()`)
	if got.String() != "true,true" {
		t.Fatalf("getRandomValues = %s, want true,true", got.String())
	}

	// 各种整数类型数组都应接受。
	accepted := rt.run(`(() => {
		const types = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
			Int32Array, Uint32Array, BigInt64Array, BigUint64Array];
		return types.every((T) => {
			siyuan.crypto.getRandomValues(new T(4));
			return true;
		});
	})()`)
	if !accepted.ToBoolean() {
		t.Fatal("getRandomValues rejected an integer TypedArray")
	}

	// 浮点数组与 DataView 应报 TypeMismatchError。
	for _, expr := range []string{
		"new Float32Array(4)", "new Float64Array(4)",
		"new DataView(new ArrayBuffer(4))", "new ArrayBuffer(4)", "[1,2,3]", "null",
	} {
		message := rt.runError("siyuan.crypto.getRandomValues(" + expr + ")")
		if !strings.Contains(message, "TypeMismatchError") {
			t.Errorf("getRandomValues(%s) threw %q, want TypeMismatchError", expr, message)
		}
	}

	// 超过 65536 字节应报 QuotaExceededError。
	message := rt.runError("siyuan.crypto.getRandomValues(new Uint8Array(65537))")
	if !strings.Contains(message, "QuotaExceededError") {
		t.Fatalf("threw %q, want QuotaExceededError", message)
	}

	// 边界值 65536 字节应当接受。
	rt.run("siyuan.crypto.getRandomValues(new Uint8Array(65536))")
}

func TestCryptoRandomUUID(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	got := rt.run(`(() => {
		const uuid = siyuan.crypto.randomUUID();
		const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
		return [uuid.length, pattern.test(uuid), uuid !== siyuan.crypto.randomUUID()].join(",");
	})()`)
	if got.String() != "36,true,true" {
		t.Fatalf("randomUUID = %s, want 36,true,true", got.String())
	}
}

func TestCryptoIsInstalledAsGlobal(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// globalThis.crypto 与 siyuan.crypto 是同一个对象，按标准全局名访问的代码可直接使用。
	got := rt.run(`(() => {
		const random = crypto.getRandomValues(new Uint8Array(4));
		return [globalThis.crypto === siyuan.crypto, random.length, typeof crypto.subtle.digest].join(",");
	})()`)
	if got.String() != "true,4,function" {
		t.Fatalf("globalThis.crypto = %s, want true,4,function", got.String())
	}
}

func TestCryptoDigest(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// 摘要结果以 ArrayBuffer 返回，内容与已知向量一致。
	got := rt.await(`(async () => {
		const data = new Uint8Array([0x61, 0x62, 0x63]);
		const digest = await siyuan.crypto.subtle.digest("SHA-256", data);
		const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
		report([digest instanceof ArrayBuffer, hex].join(","));
	})()`)
	want := "true,ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	if got != want {
		t.Fatalf("digest = %s, want %s", got, want)
	}

	// 算法名称大小写不敏感，且接受 {name} 形式。
	got = rt.await(`(async () => {
		const data = new Uint8Array(0);
		const a = await siyuan.crypto.subtle.digest("sha-1", data);
		const b = await siyuan.crypto.subtle.digest({name: "SHA-1"}, data);
		report([a.byteLength, b.byteLength].join(","));
	})()`)
	if got != "20,20" {
		t.Fatalf("digest lengths = %s, want 20,20", got)
	}

	// 未知算法应 reject 且错误名为 NotSupportedError。
	got = rt.await(`(async () => {
		try {
			await siyuan.crypto.subtle.digest("SHA-3", new Uint8Array(1));
			report("resolved");
		} catch (e) {
			report(e.name);
		}
	})()`)
	if got != "NotSupportedError" {
		t.Fatalf("error name = %s, want NotSupportedError", got)
	}

	// 参数类型错误应 reject 为 TypeError。
	got = rt.await(`(async () => {
		try {
			await siyuan.crypto.subtle.digest("SHA-256", "not a buffer");
			report("resolved");
		} catch (e) {
			report(e.constructor.name + ":" + e.name);
		}
	})()`)
	if got != "TypeError:TypeError" {
		t.Fatalf("error = %s, want TypeError:TypeError", got)
	}
}

func TestCryptoAESGCMRoundTrip(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const key = await subtle.generateKey({name: "AES-GCM", length: 256}, true, ["encrypt", "decrypt"]);
		const iv = siyuan.crypto.getRandomValues(new Uint8Array(12));
		const plaintext = new TextEncoderLike("hello siyuan");

		const ciphertext = await subtle.encrypt({name: "AES-GCM", iv}, key, plaintext);
		const decrypted = await subtle.decrypt({name: "AES-GCM", iv}, key, ciphertext);

		const same = [...new Uint8Array(decrypted)].join(",") === [...plaintext].join(",");
		report([key.type, key.extractable, key.algorithm.name, key.algorithm.length,
			key.usages.join("|"), ciphertext.byteLength, same].join(","));
	})()`)
	want := "secret,true,AES-GCM,256,encrypt|decrypt,28,true"
	if got != want {
		t.Fatalf("AES-GCM round trip = %s, want %s", got, want)
	}
}

func TestCryptoImportIgnoresAESParameterLength(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// 同一个 AES-CTR 参数对象可以同时用于导入与加解密，其中的 length 是计数器位长，
	// 不影响导入：密钥位长取自密钥数据。
	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const params = {name: "AES-CTR", counter: new Uint8Array(16), length: 64};
		const raw = siyuan.crypto.getRandomValues(new Uint8Array(16));

		try {
			const key = await subtle.importKey("raw", raw, params, true, ["encrypt", "decrypt"]);
			const plaintext = new TextEncoderLike("reused parameters");
			const ciphertext = await subtle.encrypt(params, key, plaintext);
			const decrypted = await subtle.decrypt(params, key, ciphertext);
			const same = [...new Uint8Array(decrypted)].join(",") === [...plaintext].join(",");

			// 其他 AES 模式同样忽略导入参数中的 length。
			const gcm = await subtle.importKey("raw", raw, {name: "AES-GCM", length: 256}, true, ["encrypt"]);
			report([key.algorithm.length, same, gcm.algorithm.length].join(","));
		} catch (e) {
			report(e.name + ": " + e.message);
		}
	})()`)
	if got != "128,true,128" {
		t.Fatalf("AES import = %s, want 128,true,128", got)
	}
}

func TestCryptoKeyObjectShape(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// CryptoKey 不暴露自有属性，密钥材料不可从 JS 读取。
	got := rt.await(`(async () => {
		const key = await siyuan.crypto.subtle.generateKey({name: "AES-GCM", length: 128}, true, ["encrypt"]);
		report([
			Object.keys(key).length,
			JSON.stringify(key),
			Object.prototype.toString.call(key),
			key.secret === undefined,
			typeof key.algorithm === "object",
			Object.isFrozen(key.algorithm),
			Object.isFrozen(key.usages),
		].join(","));
	})()`)
	want := "0,{},[object CryptoKey],true,true,true,true"
	if got != want {
		t.Fatalf("CryptoKey shape = %s, want %s", got, want)
	}

	// 属性是只读访问器，赋值在严格模式下抛错。
	got = rt.await(`(async () => {
		"use strict";
		const key = await siyuan.crypto.subtle.generateKey({name: "AES-GCM", length: 128}, true, ["encrypt"]);
		try {
			key.extractable = false;
			report("assigned");
		} catch (e) {
			report(e.constructor.name);
		}
	})()`)
	if got != "TypeError" {
		t.Fatalf("assignment result = %s, want TypeError", got)
	}

	// 伪造的对象不能当作 CryptoKey 使用。
	got = rt.await(`(async () => {
		const fake = {type: "secret", extractable: true, algorithm: {name: "AES-GCM"}, usages: ["encrypt"]};
		try {
			await siyuan.crypto.subtle.encrypt({name: "AES-GCM", iv: new Uint8Array(12)}, fake, new Uint8Array(1));
			report("resolved");
		} catch (e) {
			report(e.constructor.name);
		}
	})()`)
	if got != "TypeError" {
		t.Fatalf("fake key result = %s, want TypeError", got)
	}
}

func TestCryptoHMACSignVerify(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const raw = new Uint8Array([0x4a, 0x65, 0x66, 0x65]); // "Jefe"
		const key = await subtle.importKey("raw", raw, {name: "HMAC", hash: "SHA-256"}, true, ["sign", "verify"]);
		const data = new TextEncoderLike("what do ya want for nothing?");

		const signature = await subtle.sign("HMAC", key, data);
		const hex = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
		const valid = await subtle.verify("HMAC", key, signature, data);

		const tampered = new Uint8Array(signature);
		tampered[0] ^= 0xff;
		const invalid = await subtle.verify("HMAC", key, tampered, data);

		report([hex, valid, invalid, key.algorithm.hash.name, key.algorithm.length].join(","));
	})()`)
	want := "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843,true,false,SHA-256,32"
	if got != want {
		t.Fatalf("HMAC = %s, want %s", got, want)
	}
}

func TestCryptoImportExportKey(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// raw 往返保持密钥材料不变。
	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const raw = siyuan.crypto.getRandomValues(new Uint8Array(32));
		const key = await subtle.importKey("raw", raw, "AES-CBC", true, ["encrypt", "decrypt"]);
		const exported = await subtle.exportKey("raw", key);
		const same = [...new Uint8Array(exported)].join(",") === [...raw].join(",");
		report([same, exported instanceof ArrayBuffer].join(","));
	})()`)
	if got != "true,true" {
		t.Fatalf("raw round trip = %s, want true,true", got)
	}

	// jwk 导出为普通对象，可直接再次导入。
	got = rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const key = await subtle.generateKey({name: "AES-GCM", length: 256}, true, ["encrypt", "decrypt"]);
		const jwk = await subtle.exportKey("jwk", key);
		const reimported = await subtle.importKey("jwk", jwk, "AES-GCM", true, ["encrypt", "decrypt"]);
		const again = await subtle.exportKey("jwk", reimported);
		report([jwk.kty, jwk.alg, jwk.ext, jwk.key_ops.join("|"),
			typeof jwk.k, jwk.k === again.k, jwk instanceof ArrayBuffer].join(","));
	})()`)
	want := "oct,A256GCM,true,encrypt|decrypt,string,true,false"
	if got != want {
		t.Fatalf("jwk round trip = %s, want %s", got, want)
	}

	// 不可导出的密钥不能导出。
	got = rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const key = await subtle.generateKey({name: "AES-GCM", length: 128}, false, ["encrypt"]);
		try {
			await subtle.exportKey("raw", key);
			report("resolved");
		} catch (e) {
			report(e.name);
		}
	})()`)
	if got != "InvalidAccessError" {
		t.Fatalf("error name = %s, want InvalidAccessError", got)
	}

	// 未实现的格式应报 NotSupportedError，而不是参数错误。
	got = rt.await(`(async () => {
		try {
			await siyuan.crypto.subtle.importKey("spki", new Uint8Array(8), "AES-GCM", true, ["encrypt"]);
			report("resolved");
		} catch (e) {
			report(e.name);
		}
	})()`)
	if got != "NotSupportedError" {
		t.Fatalf("error name = %s, want NotSupportedError", got)
	}

	// 非法格式名属于参数错误。
	got = rt.await(`(async () => {
		try {
			await siyuan.crypto.subtle.importKey("pem", new Uint8Array(8), "AES-GCM", true, ["encrypt"]);
			report("resolved");
		} catch (e) {
			report(e.constructor.name);
		}
	})()`)
	if got != "TypeError" {
		t.Fatalf("error = %s, want TypeError", got)
	}
}

func TestCryptoJWKKeyOpsPresence(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// key_ops 缺失时不限制用法；为空数组或含重复值时报 DataError。
	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const key = await subtle.generateKey({name: "AES-GCM", length: 128}, true, ["encrypt"]);
		const {key_ops, ...withoutKeyOps} = await subtle.exportKey("jwk", key);

		const results = [];
		for (const [label, jwk] of [
			["absent", withoutKeyOps],
			["empty", {...withoutKeyOps, key_ops: []}],
			["duplicate", {...withoutKeyOps, key_ops: ["encrypt", "encrypt"]}],
		]) {
			try {
				await subtle.importKey("jwk", jwk, "AES-GCM", true, ["encrypt"]);
				results.push(label + "=resolved");
			} catch (e) {
				results.push(label + "=" + e.name);
			}
		}

		// 没有用法的公钥导出空数组。
		const pair = await subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, true, ["deriveBits"]);
		const publicJwk = await subtle.exportKey("jwk", pair.publicKey);
		results.push("export=" + JSON.stringify(publicJwk.key_ops));
		report(results.join(","));
	})()`)
	want := "absent=resolved,empty=DataError,duplicate=DataError,export=[]"
	if got != want {
		t.Fatalf("key_ops = %s, want %s", got, want)
	}
}

func TestCryptoJWKUseOfKeyAgreement(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// ECDH 与 X25519 的私钥用于派生，use 必须是 enc，sig 报 DataError。
	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const results = [];
		for (const alg of [{name: "ECDH", namedCurve: "P-256"}, {name: "X25519"}]) {
			const pair = await subtle.generateKey(alg, true, ["deriveBits"]);
			const {key_ops, ...jwk} = await subtle.exportKey("jwk", pair.privateKey);
			for (const use of ["sig", "enc"]) {
				try {
					await subtle.importKey("jwk", {...jwk, use}, alg, true, ["deriveBits"]);
					results.push(alg.name + " " + use + "=resolved");
				} catch (e) {
					results.push(alg.name + " " + use + "=" + e.name);
				}
			}
		}
		report(results.join(","));
	})()`)
	want := "ECDH sig=DataError,ECDH enc=resolved,X25519 sig=DataError,X25519 enc=resolved"
	if got != want {
		t.Fatalf("use = %s, want %s", got, want)
	}
}

func TestCryptoDeriveKeyAndBits(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// PBKDF2 派生比特串，相同参数结果一致。
	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const password = new TextEncoderLike("password");
		const base = await subtle.importKey("raw", password, "PBKDF2", false, ["deriveBits", "deriveKey"]);
		const params = {name: "PBKDF2", hash: "SHA-1", salt: new TextEncoderLike("salt"), iterations: 2};

		const bits = await subtle.deriveBits(params, base, 160);
		const hex = [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");

		const key = await subtle.deriveKey(params, base, {name: "AES-GCM", length: 256}, true, ["encrypt"]);
		report([hex, base.extractable, key.algorithm.name, key.algorithm.length].join(","));
	})()`)
	want := "ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957,false,AES-GCM,256"
	if got != want {
		t.Fatalf("PBKDF2 = %s, want %s", got, want)
	}

	// HKDF 需要 salt 与 info 成员。
	got = rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const base = await subtle.importKey("raw", new Uint8Array(16), "HKDF", false, ["deriveBits"]);
		try {
			await subtle.deriveBits({name: "HKDF", hash: "SHA-256"}, base, 128);
			report("resolved");
		} catch (e) {
			report(e.constructor.name);
		}
	})()`)
	if got != "TypeError" {
		t.Fatalf("error = %s, want TypeError", got)
	}

	// KDF 密钥要求 extractable 为 false。
	got = rt.await(`(async () => {
		try {
			await siyuan.crypto.subtle.importKey("raw", new Uint8Array(16), "HKDF", true, ["deriveBits"]);
			report("resolved");
		} catch (e) {
			report(e.name);
		}
	})()`)
	if got != "SyntaxError" {
		t.Fatalf("error name = %s, want SyntaxError", got)
	}
}

func TestCryptoWrapUnwrapKey(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const wrapping = await subtle.generateKey({name: "AES-GCM", length: 256}, true, ["wrapKey", "unwrapKey"]);
		const target = await subtle.generateKey({name: "AES-CBC", length: 128}, true, ["encrypt", "decrypt"]);
		const iv = siyuan.crypto.getRandomValues(new Uint8Array(12));

		const wrapped = await subtle.wrapKey("raw", target, wrapping, {name: "AES-GCM", iv});
		const unwrapped = await subtle.unwrapKey("raw", wrapped, wrapping, {name: "AES-GCM", iv},
			"AES-CBC", true, ["encrypt", "decrypt"]);

		const before = await subtle.exportKey("raw", target);
		const after = await subtle.exportKey("raw", unwrapped);
		const same = [...new Uint8Array(before)].join(",") === [...new Uint8Array(after)].join(",");
		report([wrapped.byteLength, same, unwrapped.algorithm.name].join(","));
	})()`)
	want := "32,true,AES-CBC"
	if got != want {
		t.Fatalf("wrap/unwrap = %s, want %s", got, want)
	}
}

func TestCryptoUsageEnforcement(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// 未声明的用法应报 InvalidAccessError。
	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const key = await subtle.generateKey({name: "AES-GCM", length: 128}, true, ["decrypt"]);
		try {
			await subtle.encrypt({name: "AES-GCM", iv: new Uint8Array(12)}, key, new Uint8Array(1));
			report("resolved");
		} catch (e) {
			report(e.name);
		}
	})()`)
	if got != "InvalidAccessError" {
		t.Fatalf("error name = %s, want InvalidAccessError", got)
	}

	// 算法不允许的用法应报 SyntaxError。
	got = rt.await(`(async () => {
		try {
			await siyuan.crypto.subtle.generateKey({name: "AES-GCM", length: 128}, true, ["sign"]);
			report("resolved");
		} catch (e) {
			report(e.name);
		}
	})()`)
	if got != "SyntaxError" {
		t.Fatalf("error name = %s, want SyntaxError", got)
	}

	// 非法用法字符串属于参数错误。
	got = rt.await(`(async () => {
		try {
			await siyuan.crypto.subtle.generateKey({name: "AES-GCM", length: 128}, true, ["Encrypt"]);
			report("resolved");
		} catch (e) {
			report(e.constructor.name);
		}
	})()`)
	if got != "TypeError" {
		t.Fatalf("error = %s, want TypeError", got)
	}
}

func TestCryptoInputIsCopiedBeforeComputation(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// 调用后立即修改输入缓冲区，结果必须对应调用时的内容。
	got := rt.await(`(async () => {
		const data = new Uint8Array([0x61, 0x62, 0x63]);
		const promise = siyuan.crypto.subtle.digest("SHA-256", data);
		data.fill(0);

		const digest = await promise;
		const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
		report(hex);
	})()`)
	want := "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	if got != want {
		t.Fatalf("digest = %s, want the digest of \"abc\" %s", got, want)
	}
}

func TestCryptoRespectsTypedArrayViews(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// getRandomValues 只能填充视图覆盖的范围，视图之外的字节保持为零。
	got := rt.run(`(() => {
		const buffer = new ArrayBuffer(16);
		const view = new Uint8Array(buffer, 4, 8);
		siyuan.crypto.getRandomValues(view);

		const all = new Uint8Array(buffer);
		const before = all.slice(0, 4).every((v) => v === 0);
		const after = all.slice(12).every((v) => v === 0);
		const filled = all.slice(4, 12).some((v) => v !== 0);
		return [before, filled, after].join(",");
	})()`)
	if got.String() != "true,true,true" {
		t.Fatalf("getRandomValues on a view = %s, want true,true,true", got.String())
	}

	// 摘要只覆盖视图范围，结果与同内容的独立数组一致。
	result := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const buffer = new Uint8Array([0, 0, 0x61, 0x62, 0x63, 0, 0]).buffer;
		const view = new Uint8Array(buffer, 2, 3);

		const fromView = await subtle.digest("SHA-256", view);
		const fromCopy = await subtle.digest("SHA-256", new Uint8Array([0x61, 0x62, 0x63]));
		const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
		report([hex(fromView) === hex(fromCopy), hex(fromView)].join(","));
	})()`)
	want := "true,ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	if result != want {
		t.Fatalf("digest of a view = %s, want %s", result, want)
	}

	// DataView 也是合法的 BufferSource。
	result = rt.await(`(async () => {
		const buffer = new Uint8Array([0x61, 0x62, 0x63]).buffer;
		const digest = await siyuan.crypto.subtle.digest("SHA-256", new DataView(buffer));
		const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
		report(hex);
	})()`)
	if result != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Fatalf("digest of a DataView = %s", result)
	}
}

func TestCryptoAcceptsEmptyBufferSource(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// 长度为 0 的 BufferSource 是合法取值，必须与成员缺失区分开：
	// RFC 5869 允许 HKDF 的 salt 与 info 为空，浏览器同样接受。
	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const base = await subtle.importKey("raw", new TextEncoderLike("password"),
			{name: "HKDF"}, false, ["deriveBits"]);

		const results = [];
		for (const [label, params] of [
			["empty info", {name: "HKDF", hash: "SHA-256", salt: new Uint8Array(8), info: new Uint8Array(0)}],
			["empty salt", {name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new Uint8Array(4)}],
			["both empty", {name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new Uint8Array(0)}],
			["empty ArrayBuffer", {name: "HKDF", hash: "SHA-256", salt: new ArrayBuffer(0), info: new ArrayBuffer(0)}],
		]) {
			try {
				const bits = await subtle.deriveBits(params, base, 128);
				results.push(label + "=" + bits.byteLength);
			} catch (e) {
				results.push(label + "=" + e.name);
			}
		}

		// 成员缺失仍然是 TypeError，空值不等于缺失。
		try {
			await subtle.deriveBits({name: "HKDF", hash: "SHA-256", salt: new Uint8Array(8)}, base, 128);
			results.push("absent info=resolved");
		} catch (e) {
			results.push("absent info=" + e.name);
		}
		report(results.join(","));
	})()`)
	want := "empty info=16,empty salt=16,both empty=16,empty ArrayBuffer=16,absent info=TypeError"
	if got != want {
		t.Fatalf("empty BufferSource = %s, want %s", got, want)
	}

	// 空明文与空的附加认证数据同样可用。
	got = rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const key = await subtle.generateKey({name: "AES-GCM", length: 128}, true, ["encrypt", "decrypt"]);
		const iv = siyuan.crypto.getRandomValues(new Uint8Array(12));

		const ciphertext = await subtle.encrypt(
			{name: "AES-GCM", iv, additionalData: new Uint8Array(0)}, key, new Uint8Array(0));
		const plaintext = await subtle.decrypt({name: "AES-GCM", iv}, key, ciphertext);

		const digest = await subtle.digest("SHA-256", new Uint8Array(0));
		const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
		report([ciphertext.byteLength, plaintext.byteLength, hex].join(","));
	})()`)
	// 空明文的密文只有 16 字节认证标签；空输入的 SHA-256 是已知值。
	want = "16,0,e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	if got != want {
		t.Fatalf("empty input = %s, want %s", got, want)
	}
}

func TestCryptoArgumentExceptionsRejectThePromise(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// 读取参数时脚本抛出的异常不能同步抛出，而要以原值拒绝 Promise，
	// 这样调用方的 .catch(...) 才能处理。
	got := rt.await(`(async () => {
		const subtle = siyuan.crypto.subtle;
		const thrown = new Error("boom");
		const fail = () => { throw thrown; };
		const data = new Uint8Array(1);
		const usages = ["encrypt"];
		Object.defineProperty(usages, 0, {get: fail});

		const results = [];
		for (const [label, call] of [
			["name getter", () => subtle.digest({get name() { return fail(); }}, data)],
			["hash getter", () => subtle.importKey("raw", data, {name: "HMAC", get hash() { return fail(); }}, true, ["sign"])],
			["valueOf", () => subtle.generateKey({name: "AES-GCM", length: {valueOf: fail}}, true, ["encrypt"])],
			["usages element", () => subtle.generateKey({name: "AES-GCM", length: 128}, true, usages)],
			["jwk getter", () => subtle.importKey("jwk", {get kty() { return fail(); }}, "AES-GCM", true, ["encrypt"])],
		]) {
			let promise;
			try {
				promise = call();
			} catch (e) {
				results.push(label + "=threw synchronously");
				continue;
			}
			await promise.then(
				() => results.push(label + "=resolved"),
				(e) => results.push(label + "=" + (e === thrown ? "rejected with the thrown value" : "rejected with " + e)));
		}
		report(results.join("\n"));
	})()`)
	want := strings.Join([]string{
		"name getter=rejected with the thrown value",
		"hash getter=rejected with the thrown value",
		"valueOf=rejected with the thrown value",
		"usages element=rejected with the thrown value",
		"jwk getter=rejected with the thrown value",
	}, "\n")
	if got != want {
		t.Fatalf("argument exceptions =\n%s\nwant\n%s", got, want)
	}
}

func TestCryptoArgumentInterruptPropagates(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	// 插件停止时会中断运行时，参数读取期间发生的中断必须照常终止脚本，不能被当作脚本异常处理。
	var runErr error
	if _, err := rt.plugin.worker.RunSync(func(r *goja.Runtime) (any, error) {
		if err := r.Set("interruptNow", func() { r.Interrupt("stop") }); err != nil {
			return nil, err
		}
		_, runErr = r.RunString(`siyuan.crypto.subtle.digest({get name() { interruptNow(); for (;;) {} }}, new Uint8Array(1))`)
		r.ClearInterrupt()
		return nil, nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, ok := runErr.(*goja.InterruptedError); !ok {
		t.Fatalf("error = %v (%T), want *goja.InterruptedError", runErr, runErr)
	}
}

func TestCryptoSurfaceIsFrozen(t *testing.T) {
	rt := newCryptoTestRuntime(t)

	got := rt.run(`(() => {
		const results = [Object.isFrozen(siyuan.crypto), Object.isFrozen(siyuan.crypto.subtle)];
		try {
			siyuan.crypto.subtle.digest = () => {};
		} catch (e) {
			results.push("throws");
		}
		results.push(typeof siyuan.crypto.subtle.digest === "function");
		return results.join(",");
	})()`)
	if got.String() != "true,true,true" {
		t.Fatalf("frozen state = %s, want true,true,true", got.String())
	}
}
