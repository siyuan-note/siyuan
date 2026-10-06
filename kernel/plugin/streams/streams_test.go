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

package streams

import (
	"testing"

	"github.com/dop251/goja"
)

// newTestRuntime 创建已启用本包的 goja runtime：按 kernel/plugin 的实际配置设置字段名映射（本包的实现不依赖
// 它，但与生产环境一致，便于发现潜在的隐藏耦合）。
func newTestRuntime(t *testing.T) (*goja.Runtime, *Host) {
	t.Helper()
	rt := goja.New()
	rt.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
	h := Enable(rt)
	return rt, h
}

// run 执行脚本，脚本出错时直接 Fatal；不涉及 Promise 的测试直接用它取返回值。
func run(t *testing.T, rt *goja.Runtime, script string) goja.Value {
	t.Helper()
	v, err := rt.RunString(script)
	if err != nil {
		t.Fatalf("script error: %v\nscript: %s", err, script)
	}
	return v
}

// runAsync 把 script 包进一个立即执行的 async 函数并运行，返回其落定结果的 JSON 字符串。
//
// goja（本包固定的版本）里 Promise 的反应不是在触发它们的那次调用中同步跑完，而是作为 job 排进 runtime
// 内部队列，只在"最外层脚本调用整体返回、控制权交还给 Go"的那一刻才循环排空（runtime.go 的 leave()）。
// 所以不能在同一次 RunString 里"触发 then 链之后立刻读取结果"——这是本文件最初的写法，看起来会同步生效，
// 实际是因为之前验证用的探针在 RunString 返回之后才读取结果，而不是 Promise 反应真的同步触发。只要整条
// 链不依赖"稍后才会发生的新一轮 Go 回调"（定时器、另一次 RunOnLoop 等），leave() 会循环排空到链路跑完，
// 所以把需要观察的值放进 async 函数的返回值，在 RunString 返回之后读这个已经落定的 Promise 即可，不需要
// 事件循环。
func runAsync(t *testing.T, rt *goja.Runtime, script string) string {
	t.Helper()
	got := run(t, rt, "(async () => {\n"+script+"\n})()")
	promise, ok := got.Export().(*goja.Promise)
	if !ok {
		t.Fatalf("script did not return a Promise: %v", got)
	}
	switch promise.State() {
	case goja.PromiseStateFulfilled:
		return promise.Result().String()
	case goja.PromiseStateRejected:
		t.Fatalf("script's promise rejected: %v", promise.Result())
	default:
		t.Fatalf("script's promise is still pending after the script returned (likely waiting on something that " +
			"never settles synchronously, such as a real timer)")
	}
	return ""
}

func TestReadableStreamBasicReadAndClose(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const rs = new ReadableStream({
			start(controller) {
				controller.enqueue("a");
				controller.enqueue("b");
				controller.close();
			}
		});
		const reader = rs.getReader();
		const results = [await reader.read(), await reader.read(), await reader.read()];
		return JSON.stringify(results);
	`)
	want := `[{"value":"a","done":false},{"value":"b","done":false},{"done":true}]`
	if got != want {
		t.Fatalf("read results = %s, want %s", got, want)
	}
}

func TestReadableStreamLockedAndDoubleGetReaderThrows(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := run(t, rt, `(() => {
		const rs = new ReadableStream();
		const before = rs.locked;
		const reader = rs.getReader();
		const after = rs.locked;
		let threw = false;
		try { rs.getReader(); } catch (e) { threw = e instanceof TypeError; }
		return JSON.stringify([before, after, threw]);
	})()`)
	if want := `[false,true,true]`; got.String() != want {
		t.Fatalf("locked/double getReader = %s, want %s", got.String(), want)
	}
}

func TestReadableStreamCancelCallsCancelAlgorithm(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const log = [];
		const rs = new ReadableStream({
			cancel(reason) { log.push("cancel:" + reason); }
		});
		const settled = await rs.cancel("bye");
		return JSON.stringify([log, settled === undefined]);
	`)
	if want := `[["cancel:bye"],true]`; got != want {
		t.Fatalf("cancel = %s, want %s", got, want)
	}
}

func TestReadableStreamErrorRejectsPendingReads(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		let controllerRef;
		const rs = new ReadableStream({ start(c) { controllerRef = c; } });
		const reader = rs.getReader();
		const pending = reader.read();
		controllerRef.error(new Error("boom"));
		let caught = null;
		await pending.catch(e => { caught = String(e); });
		return JSON.stringify(caught);
	`)
	if want := `"Error: boom"`; got != want {
		t.Fatalf("error propagation = %s, want %s", got, want)
	}
}

func TestReadableStreamDesiredSizeAndBackpressure(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := run(t, rt, `(() => {
		let controllerRef;
		const rs = new ReadableStream({ start(c) { controllerRef = c; } }, { highWaterMark: 2 });
		const before = controllerRef.desiredSize;
		controllerRef.enqueue(1);
		const afterOne = controllerRef.desiredSize;
		controllerRef.enqueue(2);
		const afterTwo = controllerRef.desiredSize;
		return JSON.stringify([before, afterOne, afterTwo]);
	})()`)
	if want := `[2,1,0]`; got.String() != want {
		t.Fatalf("desiredSize sequence = %s, want %s", got.String(), want)
	}
}

func TestWritableStreamWriteCloseAndDesiredSize(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const chunks = [];
		const ws = new WritableStream({
			write(chunk) { chunks.push(chunk); },
		});
		const writer = ws.getWriter();
		const sizeBefore = writer.desiredSize;
		await writer.write("a");
		await writer.close();
		return JSON.stringify([sizeBefore, chunks]);
	`)
	if want := `[1,["a"]]`; got != want {
		t.Fatalf("writable write/close = %s, want %s", got, want)
	}
}

func TestWritableStreamWriteAfterCloseRejects(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const ws = new WritableStream();
		const writer = ws.getWriter();
		await writer.close();
		let reason = null;
		await writer.write("x").catch(e => { reason = e instanceof TypeError; });
		return JSON.stringify(reason);
	`)
	if want := `true`; got != want {
		t.Fatalf("write after close = %s, want %s", got, want)
	}
}

func TestWritableStreamAbortRejectsPendingWrite(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		let rejectWrite;
		const ws = new WritableStream({
			write(chunk) { return new Promise((_, reject) => { rejectWrite = reject; }); },
		});
		const writer = ws.getWriter();
		let writeErr = null;
		const writePromise = writer.write("x").catch(e => { writeErr = String(e); });
		const abortPromise = writer.abort("stop");
		rejectWrite(new Error("underlying failure"));
		await writePromise;
		let abortOk = null;
		await abortPromise.then(() => { abortOk = true; });
		return JSON.stringify([writeErr, abortOk]);
	`)
	if want := `["Error: underlying failure",true]`; got != want {
		t.Fatalf("abort pending write = %s, want %s", got, want)
	}
}

func TestTransformStreamIdentityDefault(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const ts = new TransformStream();
		const writer = ts.writable.getWriter();
		const reader = ts.readable.getReader();
		writer.write("x");
		writer.close();
		const results = [await reader.read(), await reader.read()];
		return JSON.stringify(results);
	`)
	if want := `[{"value":"x","done":false},{"done":true}]`; got != want {
		t.Fatalf("transform identity = %s, want %s", got, want)
	}
}

func TestTransformStreamCustomTransformAndFlush(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const ts = new TransformStream({
			transform(chunk, controller) { controller.enqueue(chunk.toUpperCase()); },
			flush(controller) { controller.enqueue("END"); },
		});
		const writer = ts.writable.getWriter();
		const reader = ts.readable.getReader();
		writer.write("a");
		writer.close();
		const results = [await reader.read(), await reader.read(), await reader.read()];
		return JSON.stringify(results);
	`)
	want := `[{"value":"A","done":false},{"value":"END","done":false},{"done":true}]`
	if got != want {
		t.Fatalf("transform custom = %s, want %s", got, want)
	}
}

// 按规范，取消 TransformStream 的 readable 侧不会调用 transformer 的 cancel 选项（那是 writable 侧 abort 时
// 才用的算法）；取消 readable 侧只应把 writable 侧也一并错误化，使后续写入失败。
func TestTransformStreamReadableCancelErrorsWritableWithoutInvokingTransformerCancel(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const log = [];
		const ts = new TransformStream({ cancel(reason) { log.push("cancel:" + reason); } });
		const reader = ts.readable.getReader();
		await reader.cancel("nope");
		let writeErr = null;
		// cancel 的 reason 可以是任意值，不要求是 Error：这里直接比较拒绝原因本身，而不是检查其类型。
		await ts.writable.getWriter().write("x").catch(e => { writeErr = e; });
		return JSON.stringify([log, writeErr]);
	`)
	if want := `[[],"nope"]`; got != want {
		t.Fatalf("transform readable cancel = %s, want %s", got, want)
	}
}

// transformer 的 cancel 选项由 writable 侧的 abort() 触发（内部走 TransformStreamDefaultSinkAbortAlgorithm）。
func TestTransformStreamWritableAbortInvokesTransformerCancel(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const log = [];
		const ts = new TransformStream({ cancel(reason) { log.push("cancel:" + reason); } });
		await ts.writable.getWriter().abort("nope");
		return JSON.stringify(log);
	`)
	if want := `["cancel:nope"]`; got != want {
		t.Fatalf("transform writable abort = %s, want %s", got, want)
	}
}

func TestPipeToCopiesChunksAndCloses(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const rs = new ReadableStream({
			start(c) { c.enqueue(1); c.enqueue(2); c.close(); }
		});
		const chunks = [];
		let closed = false;
		const ws = new WritableStream({
			write(chunk) { chunks.push(chunk); },
			close() { closed = true; },
		});
		await rs.pipeTo(ws);
		return JSON.stringify([chunks, closed]);
	`)
	if want := `[[1,2],true]`; got != want {
		t.Fatalf("pipeTo = %s, want %s", got, want)
	}
}

func TestPipeToPreventCloseLeavesDestOpen(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const rs = new ReadableStream({ start(c) { c.enqueue(1); c.close(); } });
		let closed = false;
		const ws = new WritableStream({ close() { closed = true; } });
		await rs.pipeTo(ws, { preventClose: true });
		return JSON.stringify([closed, ws.locked]);
	`)
	if want := `[false,false]`; got != want {
		t.Fatalf("pipeTo preventClose = %s, want %s", got, want)
	}
}

func TestPipeToPropagatesSourceErrorAndAbortsDest(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		let controllerRef;
		const rs = new ReadableStream({ start(c) { controllerRef = c; } });
		let abortReason = null;
		const ws = new WritableStream({ abort(r) { abortReason = String(r); } });
		const pending = rs.pipeTo(ws);
		controllerRef.error(new Error("source failed"));
		let caught = null;
		await pending.catch(e => { caught = String(e); });
		return JSON.stringify([caught, abortReason]);
	`)
	want := `["Error: source failed","Error: source failed"]`
	if got != want {
		t.Fatalf("pipeTo error propagation = %s, want %s", got, want)
	}
}

// 目的地在 pipeTo 等待源数据期间出错：管道必须以目的地的错误拒绝并释放两端的锁；未设置 preventCancel 时以同一
// 错误取消源流，设置时源流保持可读，之后的数据交给新的 reader 而不是被管道遗留的读取请求截走。源流的
// highWaterMark 为 0，pull 只在有挂起的读取请求时调用，日志里的 "pull" 证明出错时管道正在等待源数据。
func TestPipeToPropagatesDestinationErrorWhileWaitingForSource(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const run = async (options) => {
			const log = [];
			let source, dest;
			const rs = new ReadableStream({
				start(c) { source = c; },
				pull() { log.push("pull"); },
				cancel(reason) { log.push("cancel:" + reason.message); },
			}, { highWaterMark: 0 });
			const ws = new WritableStream({ start(c) { dest = c; } });
			const piping = rs.pipeTo(ws, options);
			await null;
			await null;
			dest.error(new Error("dest failed"));
			log.push(await piping.then(() => "resolved", (e) => "rejected:" + e.message));
			log.push("locked:" + rs.locked + "," + ws.locked);
			const reading = rs.getReader().read();
			if (options) source.enqueue("later");
			log.push("read:" + JSON.stringify(await reading));
			return log;
		};
		return JSON.stringify([await run(), await run({ preventCancel: true })]);
	`)
	want := `[["pull","cancel:dest failed","rejected:dest failed","locked:false,false","read:{\"done\":true}"],` +
		`["pull","rejected:dest failed","locked:false,false","pull","read:{\"value\":\"later\",\"done\":false}"]]`
	if got != want {
		t.Fatalf("pipeTo destination error = %s, want %s", got, want)
	}
}

// 目的地在 pipeTo 开始前已经关闭：即使源流没有任何数据，管道也要以 TypeError 拒绝、取消源流并释放两端的锁，
// 不能一直等待源数据。
func TestPipeToDestinationClosedBeforePipe(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const log = [];
		const rs = new ReadableStream({
			cancel(reason) { log.push("cancel:" + (reason instanceof TypeError)); },
		}, { highWaterMark: 0 });
		const ws = new WritableStream();
		const writer = ws.getWriter();
		await writer.close();
		writer.releaseLock();
		log.push(await rs.pipeTo(ws).then(() => "resolved", (e) => "rejected:" + (e instanceof TypeError)));
		log.push("locked:" + rs.locked + "," + ws.locked);
		return JSON.stringify(log);
	`)
	if want := `["cancel:true","rejected:true","locked:false,false"]`; got != want {
		t.Fatalf("pipeTo closed destination = %s, want %s", got, want)
	}
}

// getReader 的选项字典缺少 mode 成员（或为 undefined/null）时按缺省值返回默认 reader；无法转换为字典的值与不支持
// 的 mode 抛出 TypeError。
func TestReadableStreamGetReaderOptionDefaults(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const results = [];
		for (const options of [undefined, null, {}, { mode: undefined }]) {
			const rs = new ReadableStream({ start(c) { c.enqueue("x"); c.close(); } });
			results.push((await rs.getReader(options).read()).value);
		}
		for (const options of [{ mode: "byob" }, { mode: "other" }, 1]) {
			try {
				new ReadableStream().getReader(options);
				results.push("no error");
			} catch (e) {
				results.push(e instanceof TypeError);
			}
		}
		return JSON.stringify(results);
	`)
	if want := `["x","x","x","x",true,true,true]`; got != want {
		t.Fatalf("getReader options = %s, want %s", got, want)
	}
}

// ReadableStream.from 的迭代结果缺少 value 成员时按 undefined 入队；结果不是对象时流以 TypeError 出错。
func TestReadableStreamFromIteratorResultMembers(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const iterable = (next) => ({ [Symbol.iterator]() { return { next }; } });
		let count = 0;
		const missing = ReadableStream.from(iterable(() => (count++ ? { done: true } : { done: false })));
		const first = await missing.getReader().read();
		const results = ["value" in first, first.value === undefined, first.done];
		for (const result of [1, undefined]) {
			try {
				await ReadableStream.from(iterable(() => result)).getReader().read();
				results.push("no error");
			} catch (e) {
				results.push(e instanceof TypeError);
			}
		}
		return JSON.stringify(results);
	`)
	if want := `[true,true,false,true,true]`; got != want {
		t.Fatalf("ReadableStream.from iterator results = %s, want %s", got, want)
	}
}

func TestTeeBothBranchesReceiveSameChunks(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const rs = new ReadableStream({ start(c) { c.enqueue(1); c.enqueue(2); c.close(); } });
		const [a, b] = rs.tee();
		const readAll = async (stream) => {
			const reader = stream.getReader();
			const out = [];
			for (;;) {
				const r = await reader.read();
				if (r.done) break;
				out.push(r.value);
			}
			return out;
		};
		const [resultA, resultB] = await Promise.all([readAll(a), readAll(b)]);
		return JSON.stringify([resultA, resultB]);
	`)
	if want := `[[1,2],[1,2]]`; got != want {
		t.Fatalf("tee = %s, want %s", got, want)
	}
}

func TestTeeCancelOnlyTakesEffectWhenBothBranchesCancel(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const log = [];
		const rs = new ReadableStream({
			start(c) { c.enqueue(1); },
			cancel(reason) { log.push("source-cancel:" + JSON.stringify(reason)); },
		});
		const [a, b] = rs.tee();
		// 不能 await a.cancel(...)：它返回的 Promise 要等两条分支都 cancel 之后才会落定，在此之前 await 会卡死。
		const pendingA = a.cancel("a-reason");
		const afterOnlyOne = log.length;
		await b.cancel("b-reason");
		await pendingA;
		return JSON.stringify([afterOnlyOne, log]);
	`)
	if want := `[0,["source-cancel:[\"a-reason\",\"b-reason\"]"]]`; got != want {
		t.Fatalf("tee cancel = %s, want %s", got, want)
	}
}

func TestReadableStreamFromSyncAndAsyncIterable(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := runAsync(t, rt, `
		const readAll = async (stream) => {
			const reader = stream.getReader();
			const out = [];
			for (;;) {
				const r = await reader.read();
				if (r.done) break;
				out.push(r.value);
			}
			return out;
		};
		const fromArray = await readAll(ReadableStream.from([1, 2, 3]));
		const fromAsyncIterator = await readAll(ReadableStream.from(ReadableStream.from(["a", "b"]).values()));
		return JSON.stringify([fromArray, fromAsyncIterator]);
	`)
	if want := `[[1,2,3],["a","b"]]`; got != want {
		t.Fatalf("ReadableStream.from = %s, want %s", got, want)
	}
}

func TestCountAndByteLengthQueuingStrategy(t *testing.T) {
	rt, _ := newTestRuntime(t)
	got := run(t, rt, `(() => {
		const count = new CountQueuingStrategy({ highWaterMark: 3 });
		const byteLength = new ByteLengthQueuingStrategy({ highWaterMark: 10 });
		return JSON.stringify([
			count.highWaterMark, count.size("anything"),
			byteLength.highWaterMark, byteLength.size({ byteLength: 7 }),
		]);
	})()`)
	if want := `[3,1,10,7]`; got.String() != want {
		t.Fatalf("queuing strategies = %s, want %s", got.String(), want)
	}
}

func TestNewReadableStreamFromGoBridgePushesChunks(t *testing.T) {
	rt, h := newTestRuntime(t)
	stream := h.NewReadableStream(nil, func(controller goja.Value) goja.Value {
		c, _ := readableControllerOf(controller)
		readableControllerEnqueue(h, c, rt.ToValue("from-go"))
		readableControllerClose(h, c)
		return nil
	}, nil, 1, nil)
	must(rt.Set("rs", stream))

	got := runAsync(t, rt, `
		const reader = rs.getReader();
		const results = [await reader.read(), await reader.read()];
		return JSON.stringify(results);
	`)
	want := `[{"value":"from-go","done":false},{"done":true}]`
	if got != want {
		t.Fatalf("Go bridge readable = %s, want %s", got, want)
	}
}

func TestIsReadableAndWritableStreamIdentity(t *testing.T) {
	rt, h := newTestRuntime(t)
	run(t, rt, `globalThis.rs = new ReadableStream(); globalThis.ws = new WritableStream(); globalThis.plain = {};`)
	if !h.IsReadableStream(rt.Get("rs")) {
		t.Fatal("IsReadableStream(rs) = false, want true")
	}
	if h.IsReadableStream(rt.Get("ws")) {
		t.Fatal("IsReadableStream(ws) = true, want false")
	}
	if !h.IsWritableStream(rt.Get("ws")) {
		t.Fatal("IsWritableStream(ws) = false, want true")
	}
	if h.IsReadableStream(rt.Get("plain")) || h.IsWritableStream(rt.Get("plain")) {
		t.Fatal("plain object misidentified as a stream")
	}
}
