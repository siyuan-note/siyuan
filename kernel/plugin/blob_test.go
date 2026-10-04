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
	"fmt"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/dop251/goja_nodejs/url"
)

// formDataTestRuntime 启动注入了 Blob、File、FormData 与 URLSearchParams 的事件循环，提供运行脚本的辅助方法。
type formDataTestRuntime struct {
	t    *testing.T
	loop *eventloop.EventLoop
}

func newFormDataTestRuntime(t *testing.T) *formDataTestRuntime {
	t.Helper()

	loop := eventloop.NewEventLoop(eventloop.EnableConsole(true))
	loop.Start()
	t.Cleanup(func() { loop.Stop() })

	r := &formDataTestRuntime{t: t, loop: loop}
	r.withRuntime(func(rt *goja.Runtime) {
		url.Enable(rt)
		EnableFormDataAPI(rt)
	})
	return r
}

// withRuntime 在事件循环上同步执行 fn。fn 运行在事件循环的 goroutine 上，不能调用 t.Fatal。
func (r *formDataTestRuntime) withRuntime(fn func(rt *goja.Runtime)) {
	r.t.Helper()

	done := make(chan struct{})
	r.loop.RunOnLoop(func(rt *goja.Runtime) {
		defer close(done)
		fn(rt)
	})
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		r.t.Fatal("timed out waiting for the event loop")
	}
}

// run 在事件循环上同步执行脚本并返回结果的字符串形式，脚本抛出异常时 Fatal。
func (r *formDataTestRuntime) run(script string) string {
	r.t.Helper()

	var result string
	var err error
	r.withRuntime(func(rt *goja.Runtime) {
		var value goja.Value
		if value, err = rt.RunString(script); err == nil {
			result = value.String()
		}
	})
	if err != nil {
		r.t.Fatalf("script failed: %v\n%s", err, script)
	}
	return result
}

// await 执行一段返回 Promise 的脚本，等待其完成后返回结果的字符串形式；被拒绝时以 "rejected:" 开头。
func (r *formDataTestRuntime) await(script string) string {
	r.t.Helper()

	result := make(chan string, 1)
	var err error
	r.withRuntime(func(rt *goja.Runtime) {
		var value goja.Value
		if value, err = rt.RunString(script); err != nil {
			return
		}
		promise := value.ToObject(rt)
		then, ok := goja.AssertFunction(promise.Get("then"))
		if !ok {
			err = fmt.Errorf("script did not return a promise")
			return
		}
		_, err = then(promise, rt.ToValue(func(call goja.FunctionCall) goja.Value {
			result <- call.Argument(0).String()
			return goja.Undefined()
		}), rt.ToValue(func(call goja.FunctionCall) goja.Value {
			result <- "rejected:" + call.Argument(0).String()
			return goja.Undefined()
		}))
	})
	if err != nil {
		r.t.Fatalf("script failed: %v\n%s", err, script)
	}

	select {
	case got := <-result:
		return got
	case <-time.After(5 * time.Second):
		r.t.Fatalf("timed out waiting for:\n%s", script)
		return ""
	}
}

func TestBlobConstructorConcatenatesParts(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.await(`(async () => {
		const buffer = new Uint8Array([0x41, 0x42, 0x43, 0x44]).buffer;
		const blob = new Blob([
			"a\u00e9\ud83d\ude00", // 1、2、4 字节的 UTF-8 字符
			"\ud800",              // 未配对的代理项替换为 U+FFFD
			buffer,
			new Uint8Array(buffer, 1, 2),
			new DataView(buffer, 3, 1),
			new Blob(["<", ">"], {type: "text/ignored"}),
			12, null, undefined, {toString() { return "!"; }},
		]);
		const bytes = new Uint8Array(await blob.arrayBuffer());
		return [blob.size, blob.type, Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")].join("|");
	})()`)
	want := "35||" + "61" + "c3a9" + "f09f9880" + "efbfbd" + "41424344" + "4243" + "44" + "3c3e" + "3132" +
		"6e756c6c" + "756e646566696e6564" + "21"
	if got != want {
		t.Fatalf("blob = %s, want %s", got, want)
	}
}

func TestBlobCopiesBufferSourcesAndReturnsCopies(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.await(`(async () => {
		const source = new Uint8Array([1, 2, 3]);
		const blob = new Blob([source]);
		source[0] = 9;
		const first = new Uint8Array(await blob.arrayBuffer());
		first[1] = 9;
		const second = await blob.bytes();
		second[2] = 9;
		return Array.from(new Uint8Array(await blob.arrayBuffer())).join(",");
	})()`)
	if got != "1,2,3" {
		t.Fatalf("blob content after mutating the source and the read results = %s, want 1,2,3", got)
	}
}

func TestBlobTreatsDetachedBuffersAsEmpty(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	// 沙箱脚本目前无法分离 ArrayBuffer，这里由宿主分离，覆盖将来引入 transfer 等能力后的情形：
	// goja 导出已分离缓冲区上的视图会触发 Go 运行时 panic，实现必须先判断缓冲区是否已分离。
	var setErr error
	rt.withRuntime(func(rt *goja.Runtime) {
		setErr = rt.Set("detach", func(call goja.FunctionCall) goja.Value {
			call.Argument(0).Export().(goja.ArrayBuffer).Detach()
			return goja.Undefined()
		})
	})
	if setErr != nil {
		t.Fatal(setErr)
	}

	got := rt.await(`(async () => {
		const parts = [];
		for (const view of [
			(buffer) => buffer,
			(buffer) => new Uint8Array(buffer),
			(buffer) => new Uint16Array(buffer, 2, 1),
			(buffer) => new DataView(buffer, 1, 2),
		]) {
			const buffer = new Uint8Array([0x41, 0x42, 0x43, 0x44]).buffer;
			parts.push(view(buffer));
			detach(buffer);
		}
		return new Blob([...parts, "ok"]).text();
	})()`)
	if got != "ok" {
		t.Fatalf("blob from detached buffers = %q, want only the string part", got)
	}
}

func TestBlobTypeNormalization(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.run(`[
		new Blob([], {type: "Text/HTML; Charset=UTF-8"}).type,
		new Blob([], {type: "a\u00e9"}).type,
		new Blob([], {type: "a\nb"}).type,
		new Blob([]).type,
		new Blob([], {type: 5}).type,
		new Blob([], null).type,
	].join("|")`)
	if want := "text/html; charset=utf-8||||5|"; got != want {
		t.Fatalf("types = %q, want %q", got, want)
	}
}

func TestBlobEndings(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.await(`(async () => JSON.stringify([
		await new Blob(["a\r\nb\rc\nd"], {endings: "native"}).text(),
		await new Blob(["a\r\nb\rc\nd"], {endings: "transparent"}).text(),
		await new Blob(["a\r\nb"]).text(),
		Array.from(await new Blob([new Uint8Array([13, 10, 13])], {endings: "native"}).bytes()),
	]))()`)
	native := `\n`
	if runtime.GOOS == "windows" {
		native = `\r\n`
	}
	want := `["a` + native + `b` + native + `c` + native + `d","a\r\nb\rc\nd","a\r\nb",[13,10,13]]`
	if got != want {
		t.Fatalf("endings = %s, want %s", got, want)
	}

	if got := rt.run(`(() => {
		try {
			new Blob([], {endings: "NATIVE"});
			return "no throw";
		} catch (e) {
			return e.constructor.name;
		}
	})()`); got != "TypeError" {
		t.Fatalf("invalid endings = %s, want TypeError", got)
	}
}

func TestBlobSlice(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.await(`(async () => {
		const blob = new File(["0123456789"], "digits.txt", {type: "text/plain"});
		const slices = [
			blob.slice(),
			blob.slice(2),
			blob.slice(2, 5),
			blob.slice(-3),
			blob.slice(-3, -1),
			blob.slice(5, 2),
			blob.slice(-20, 20),
			blob.slice(2.5, 4.5), // [Clamp] 就近取整，恰在中间时取偶数：2.5 -> 2，4.5 -> 4
			blob.slice(NaN, "4"),
			blob.slice(0, Infinity),
			blob.slice(1, 3, "Text/X"),
			blob.slice(1, 3, "\u00e9"),
			blob.slice(undefined, undefined, undefined),
			blob.slice(2, 8).slice(1, -1),
		];
		const texts = await Promise.all(slices.map((s) => s.text()));
		return JSON.stringify([
			texts,
			slices.map((s) => s.type),
			slices.every((s) => s instanceof Blob && !(s instanceof File)),
		]);
	})()`)
	want := `[["0123456789","23456789","234","789","78","","0123456789","23","0123","0123456789","12","12",` +
		`"0123456789","3456"],["","","","","","","","","","","text/x","","",""],true]`
	if got != want {
		t.Fatalf("slices = %s, want %s", got, want)
	}
}

func TestBlobTextDecodesUTF8LikeTextDecoder(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	// 开头的 BOM 被去掉；被截断的多字节序列（E2 82）整体替换为一个 U+FFFD，单独的无效字节（FF）也替换为 U+FFFD。
	got := rt.await(`(async () => {
		const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF, 0x61, 0xE2, 0x82, 0x62, 0xFF, 0x63])]);
		return JSON.stringify(await blob.text());
	})()`)
	if want := "\"a\uFFFDb\uFFFDc\""; got != want {
		t.Fatalf("text() = %s, want %s", got, want)
	}
}

func TestBlobEmptyReads(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.await(`(async () => {
		const blob = new Blob();
		const bytes = await blob.bytes();
		return JSON.stringify([
			blob.size,
			await blob.text(),
			(await blob.arrayBuffer()).byteLength,
			bytes instanceof Uint8Array,
			bytes.length,
		]);
	})()`)
	if want := `[0,"",0,true,0]`; got != want {
		t.Fatalf("empty blob = %s, want %s", got, want)
	}
}

func TestBlobRejectsInvalidArguments(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.run(`(() => {
		const results = [];
		for (const fn of [
			() => new Blob("string"),
			() => new Blob(1),
			() => new Blob(null),
			() => new Blob({}),
			() => new Blob({0: "x", length: 1}),
			() => new Blob(new Date()),
			() => new Blob([Symbol("part")]),
			() => new Blob([], 1),
			() => new Blob([], "text/plain"),
			() => new Blob([], {type: Symbol("type")}),
			() => new File([]),
			() => new File(undefined, "name"),
		]) {
			try {
				fn();
				results.push("no throw");
			} catch (e) {
				results.push(e.constructor.name);
			}
		}
		return results.join(",");
	})()`)
	if want := strings.TrimSuffix(strings.Repeat("TypeError,", 12), ","); got != want {
		t.Fatalf("invalid arguments = %s, want %s", got, want)
	}
}

func TestBlobConvertsArgumentsInOrder(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	// Symbol.iterator 只读取一次，各项取值后立即转换，出错时停止（与 WPT 的 Blob-constructor 用例一致）。
	got := rt.run(`(() => {
		const received = [];
		const parts = {
			get [Symbol.iterator]() {
				received.push("Symbol.iterator");
				return Array.prototype[Symbol.iterator];
			},
			get length() {
				received.push("length getter");
				return {valueOf() { received.push("length valueOf"); return 3; }};
			},
			get 0() {
				received.push("0 getter");
				return {toString() { received.push("0 toString"); return "a"; }};
			},
			get 1() {
				received.push("1 getter");
				throw new Error("stop");
			},
			get 2() {
				received.push("2 getter");
				return "unreachable";
			},
		};
		try {
			new Blob(parts);
		} catch (e) {
			received.push(e.message);
		}
		return received.join(",");
	})()`)
	if want := "Symbol.iterator,length getter,length valueOf,0 getter,0 toString,length getter,length valueOf,1 getter,stop"; got != want {
		t.Fatalf("conversion order = %s, want %s", got, want)
	}

	// 选项在各部分之后转换，字典成员按字典序读取；File 先读取继承自 BlobPropertyBag 的成员，再读取 lastModified。
	got = rt.run(`(() => {
		const order = [];
		const part = {toString() { order.push("part"); return ""; }};
		const options = {
			get type() { order.push("type"); return ""; },
			get endings() { order.push("endings"); return "transparent"; },
			get lastModified() { order.push("lastModified"); return 0; },
		};
		new Blob([part], options);
		order.push("|");
		new File([part], {toString() { order.push("name"); return "name"; }}, options);
		return order.join(",");
	})()`)
	if want := "part,endings,type,|,part,name,endings,type,lastModified"; got != want {
		t.Fatalf("option order = %s, want %s", got, want)
	}
}

func TestFileConstructor(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.run(`(() => {
		const file = new File(["abc"], "dir/name.txt", {type: "Text/Plain", lastModified: 123.9});
		const before = Date.now();
		const defaulted = new File([], "now");
		const after = Date.now();
		return JSON.stringify([
			file.name, file.type, file.size, file.lastModified,
			new File([], "date", {lastModified: new Date(42)}).lastModified,
			new File([], "negative", {lastModified: -1.5}).lastModified,
			new File([], "nan", {lastModified: NaN}).lastModified,
			defaulted.lastModified >= before && defaulted.lastModified <= after,
			new File([], "\ud800").name,
			file instanceof File && file instanceof Blob,
			Object.prototype.toString.call(file),
		]);
	})()`)
	want := "[\"dir/name.txt\",\"text/plain\",3,123,42,-1,0,true,\"\uFFFD\",true,\"[object File]\"]"
	if got != want {
		t.Fatalf("file = %s, want %s", got, want)
	}
}

func TestBlobInterfaceShape(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.run(`JSON.stringify([
		Blob.name, Blob.length, File.name, File.length, FormData.name, FormData.length,
		Object.getPrototypeOf(File) === Blob,
		Object.getPrototypeOf(File.prototype) === Blob.prototype,
		Blob.prototype.constructor === Blob,
		Object.getOwnPropertyDescriptor(Blob, "prototype").writable,
		Object.getOwnPropertyDescriptor(Blob.prototype, "constructor").enumerable,
		Blob.prototype.slice.name, Blob.prototype.slice.length,
		Object.getOwnPropertyDescriptor(Blob.prototype, "size").get.name,
		Object.keys(Blob.prototype),
		typeof Blob.prototype.stream,
		Object.keys(new Blob(["x"])),
		JSON.stringify(new Blob(["x"])),
		Object.prototype.toString.call(new Blob()),
		Object.prototype.toString.call(Blob.prototype),
	])`)
	want := `["Blob",0,"File",2,"FormData",0,true,true,true,false,false,"slice",0,"get size",` +
		`["size","type","slice","text","arrayBuffer","bytes"],"undefined",[],"{}","[object Blob]","[object Blob]"]`
	if got != want {
		t.Fatalf("interface shape = %s, want %s", got, want)
	}
}

func TestBlobRejectsIncompatibleReceivers(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.await(`(async () => {
		const results = [];
		for (const fn of [
			() => Blob.prototype.size,
			() => Object.getOwnPropertyDescriptor(Blob.prototype, "type").get.call({}),
			() => Blob.prototype.slice.call({}),
			() => Object.getOwnPropertyDescriptor(File.prototype, "name").get.call(new Blob()),
		]) {
			try {
				fn();
				results.push("no throw");
			} catch (e) {
				results.push(e.constructor.name);
			}
		}
		// 返回 Promise 的方法以被拒绝的 Promise 报告错误，而不是同步抛出。
		const promise = Blob.prototype.text.call({});
		results.push(await promise.then(() => "resolved", (e) => "rejected " + e.constructor.name));
		return results.join(",");
	})()`)
	if want := "TypeError,TypeError,TypeError,TypeError,rejected TypeError"; got != want {
		t.Fatalf("incompatible receivers = %s, want %s", got, want)
	}
}

func TestBlobSupportsSubclassesAndExpandoProperties(t *testing.T) {
	rt := newFormDataTestRuntime(t)

	got := rt.run(`(() => {
		class LabeledBlob extends Blob {
			label = "default";
			constructor(parts, label) {
				super(parts);
				this.label = label;
			}
			describe() {
				return this.label + ":" + this.size;
			}
		}
		const blob = new LabeledBlob(["abc"], "custom");
		blob.extra = 1;
		const keys = Object.keys(blob);
		delete blob.extra;
		const assignToGetter = (() => {
			"use strict";
			try {
				blob.size = 5;
				return "no throw";
			} catch (e) {
				return e.constructor.name;
			}
		})();
		return JSON.stringify([
			blob instanceof LabeledBlob, blob instanceof Blob, blob.describe(), keys, "extra" in blob,
			assignToGetter, blob.size,
		]);
	})()`)
	if want := `[true,true,"custom:3",["label","extra"],false,"TypeError",3]`; got != want {
		t.Fatalf("subclass = %s, want %s", got, want)
	}
}
