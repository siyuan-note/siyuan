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
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
)

// abortTestRuntime 启动注入了 AbortController/AbortSignal 的事件循环，提供运行脚本的辅助方法。
type abortTestRuntime struct {
	t    *testing.T
	loop *eventloop.EventLoop
}

func newAbortTestRuntime(t *testing.T) *abortTestRuntime {
	t.Helper()

	loop := eventloop.NewEventLoop(eventloop.EnableConsole(true))
	loop.Start()
	t.Cleanup(func() { loop.Stop() })

	done := make(chan struct{})
	loop.RunOnLoop(func(rt *goja.Runtime) {
		defer close(done)
		rt.SetFieldNameMapper(goja.TagFieldNameMapper("json", true))
		EnableAbortAPI(rt)
	})
	<-done

	return &abortTestRuntime{t: t, loop: loop}
}

// run 在事件循环上同步执行脚本并返回结果，脚本出错时直接 Fatal。
func (r *abortTestRuntime) run(script string) goja.Value {
	r.t.Helper()

	var value goja.Value
	var runErr error
	done := make(chan struct{})
	r.loop.RunOnLoop(func(rt *goja.Runtime) {
		defer close(done)
		value, runErr = rt.RunString(script)
	})
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		r.t.Fatalf("timed out running script:\n%s", script)
	}
	if runErr != nil {
		r.t.Fatalf("script failed: %v\n%s", runErr, script)
	}
	return value
}

func TestAbortControllerAbort(t *testing.T) {
	rt := newAbortTestRuntime(t)

	got := rt.run(`(() => {
		const controller = new AbortController();
		const signal = controller.signal;
		const events = [];
		signal.onabort = () => events.push("onabort");
		signal.addEventListener("abort", (e) => events.push("listener:" + e.type + ":" + (e.target === signal)));

		const before = [signal.aborted, signal.reason];
		controller.abort("custom reason");
		const after = [signal.aborted, signal.reason, signal === controller.signal];

		// 二次调用是幂等的，不会重复触发监听器或覆盖 reason。
		controller.abort("ignored");

		return JSON.stringify([before, after, events, signal.reason]);
	})()`)
	want := `[[false,null],[true,"custom reason",true],["listener:abort:true","onabort"],"custom reason"]`
	if got.String() != want {
		t.Fatalf("abort = %s, want %s", got.String(), want)
	}
}

func TestAbortSignalDefaultReasonIsAbortError(t *testing.T) {
	rt := newAbortTestRuntime(t)

	got := rt.run(`(() => {
		const controller = new AbortController();
		controller.abort();
		return [controller.signal.reason.name, typeof controller.signal.reason.message].join(",");
	})()`)
	if got.String() != "AbortError,string" {
		t.Fatalf("default reason = %s, want AbortError,string", got.String())
	}
}

func TestAbortSignalThrowIfAborted(t *testing.T) {
	rt := newAbortTestRuntime(t)

	got := rt.run(`(() => {
		const controller = new AbortController();
		const results = [];
		try {
			controller.signal.throwIfAborted();
			results.push("no throw before abort");
		} catch (e) {
			results.push("unexpected throw: " + e);
		}

		controller.abort("stop");
		try {
			controller.signal.throwIfAborted();
			results.push("no throw after abort");
		} catch (e) {
			results.push(e);
		}
		return results.join(",");
	})()`)
	if got.String() != "no throw before abort,stop" {
		t.Fatalf("throwIfAborted = %s, want %q", got.String(), "no throw before abort,stop")
	}
}

func TestAbortSignalStaticAbort(t *testing.T) {
	rt := newAbortTestRuntime(t)

	got := rt.run(`(() => {
		const withReason = AbortSignal.abort("boom");
		const withoutReason = AbortSignal.abort();
		return [withReason.aborted, withReason.reason, withoutReason.reason.name].join(",");
	})()`)
	if got.String() != "true,boom,AbortError" {
		t.Fatalf("AbortSignal.abort = %s, want true,boom,AbortError", got.String())
	}
}

func TestAbortSignalTimeout(t *testing.T) {
	rt := newAbortTestRuntime(t)

	got := rt.await(`(async () => {
		const signal = AbortSignal.timeout(10);
		const before = signal.aborted;
		await new Promise((resolve) => setTimeout(resolve, 50));
		return [before, signal.aborted, signal.reason.name].join(",");
	})()`)
	if got != "false,true,TimeoutError" {
		t.Fatalf("AbortSignal.timeout = %s, want false,true,TimeoutError", got)
	}
}

func TestAbortSignalAny(t *testing.T) {
	rt := newAbortTestRuntime(t)

	got := rt.run(`(() => {
		const a = new AbortController();
		const b = new AbortController();
		const combined = AbortSignal.any([a.signal, b.signal]);
		const before = combined.aborted;

		b.abort("b aborted");
		const after = [combined.aborted, combined.reason];

		// 源信号已中止时，any() 立即返回已中止的信号。
		const alreadyAborted = AbortSignal.any([a.signal, b.signal]).aborted;

		return JSON.stringify([before, after, alreadyAborted]);
	})()`)
	want := `[false,[true,"b aborted"],true]`
	if got.String() != want {
		t.Fatalf("AbortSignal.any = %s, want %s", got.String(), want)
	}
}

func TestAbortSignalRemoveEventListenerAndOnce(t *testing.T) {
	rt := newAbortTestRuntime(t)

	got := rt.run(`(() => {
		const controller = new AbortController();
		const calls = [];
		const onAbort = () => calls.push("normal");
		const onceAbort = () => calls.push("once");
		const removed = () => calls.push("removed");

		controller.signal.addEventListener("abort", onAbort);
		controller.signal.addEventListener("abort", onceAbort, {once: true});
		controller.signal.addEventListener("abort", removed);
		controller.signal.removeEventListener("abort", removed);
		// 重复添加同一个监听器是幂等的。
		controller.signal.addEventListener("abort", onAbort);

		controller.abort();
		controller.signal.dispatchEvent({type: "abort"});

		return calls.join(",");
	})()`)
	// 第一次 abort() 触发一次（once 监听器随之移除），之后手动 dispatchEvent 只剩普通监听器再触发一次。
	if want := "normal,once,normal"; got.String() != want {
		t.Fatalf("listeners = %s, want %s", got.String(), want)
	}
}

func TestAbortSignalRejectsIncompatibleReceiver(t *testing.T) {
	rt := newAbortTestRuntime(t)

	got := rt.run(`(() => {
		const results = [];
		for (const fn of [
			() => AbortSignal.prototype.aborted,
			() => Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted").get.call({}),
			() => AbortController.prototype.abort.call({}),
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
	if want := "TypeError,TypeError,TypeError"; got.String() != want {
		t.Fatalf("incompatible receiver = %s, want %s", got.String(), want)
	}
}

func TestAbortSignalInstanceofAndIllegalConstructor(t *testing.T) {
	rt := newAbortTestRuntime(t)

	got := rt.run(`(() => {
		const controller = new AbortController();
		const results = [
			controller.signal instanceof AbortSignal,
			controller instanceof AbortController,
			Object.prototype.toString.call(controller.signal),
			Object.prototype.toString.call(controller),
		];
		try {
			new AbortSignal();
			results.push("no throw");
		} catch (e) {
			results.push(e.constructor.name + ":" + e.message);
		}
		return JSON.stringify(results);
	})()`)
	want := `[true,true,"[object AbortSignal]","[object AbortController]","TypeError:Illegal constructor"]`
	if got.String() != want {
		t.Fatalf("instanceof/illegal constructor = %s, want %s", got.String(), want)
	}
}

// await 执行一段返回 Promise 的异步脚本，等待其完成后返回结果的字符串形式；被拒绝时以 "rejected:" 开头。
func (r *abortTestRuntime) await(script string) string {
	r.t.Helper()

	result := make(chan string, 1)
	r.loop.RunOnLoop(func(rt *goja.Runtime) {
		value, err := rt.RunString(script)
		if err != nil {
			r.t.Fatalf("script failed: %v\n%s", err, script)
			return
		}
		promiseObj := value.ToObject(rt)
		then, ok := goja.AssertFunction(promiseObj.Get("then"))
		if !ok {
			r.t.Fatalf("script did not return a promise:\n%s", script)
			return
		}
		if _, err := then(promiseObj, rt.ToValue(func(call goja.FunctionCall) goja.Value {
			result <- call.Argument(0).String()
			return goja.Undefined()
		}), rt.ToValue(func(call goja.FunctionCall) goja.Value {
			result <- "rejected:" + call.Argument(0).String()
			return goja.Undefined()
		})); err != nil {
			r.t.Fatalf("promise.then: %v", err)
		}
	})

	select {
	case got := <-result:
		return got
	case <-time.After(5 * time.Second):
		r.t.Fatalf("timed out waiting for:\n%s", script)
		return ""
	}
}
