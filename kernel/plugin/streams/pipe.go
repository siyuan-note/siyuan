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

import "github.com/dop251/goja"

// pipeOptions 对应 StreamPipeOptions：pipeTo/pipeThrough 的第二个参数。
type pipeOptions struct {
	preventClose, preventAbort, preventCancel bool
	signal                                    goja.Value // 实现 .aborted / .addEventListener("abort", ...) 的任意对象，鸭子类型
}

func pipeOptionsOf(rt *goja.Runtime, value goja.Value) pipeOptions {
	var options pipeOptions
	if !isJsValueNotNull(value) {
		return options
	}
	object, ok := value.(*goja.Object)
	if !ok {
		panic(typeErrorf(rt, "pipeTo: options can't be converted to a dictionary"))
	}
	boolMember := func(name string) bool {
		v := object.Get(name)
		return v != nil && !goja.IsUndefined(v) && v.ToBoolean()
	}
	options.preventClose = boolMember("preventClose")
	options.preventAbort = boolMember("preventAbort")
	options.preventCancel = boolMember("preventCancel")
	if signal := object.Get("signal"); isJsValueNotNull(signal) {
		options.signal = signal
	}
	return options
}

// pipeSignalAborted/pipeSignalAddAbortListener 用鸭子类型读取 signal 参数：只要求有 aborted 属性与
// addEventListener 方法，不要求是本包或 kernel/plugin/abort 的 AbortSignal 实例，这样宿主注入的任意实现都能用。
func pipeSignalAborted(signal goja.Value) bool {
	object, ok := signal.(*goja.Object)
	if !ok {
		return false
	}
	aborted := object.Get("aborted")
	return aborted != nil && aborted.ToBoolean()
}

func pipeSignalReason(rt *goja.Runtime, signal goja.Value) goja.Value {
	object, ok := signal.(*goja.Object)
	if !ok {
		return typeErrorf(rt, "The operation was aborted")
	}
	if reason := object.Get("reason"); isJsValueNotNull(reason) {
		return reason
	}
	return typeErrorf(rt, "The operation was aborted")
}

func pipeSignalOnAbort(rt *goja.Runtime, signal goja.Value, fn func()) {
	object, ok := signal.(*goja.Object)
	if !ok {
		return
	}
	addEventListener, ok := goja.AssertFunction(object.Get("addEventListener"))
	if !ok {
		return
	}
	if _, err := addEventListener(object, rt.ToValue("abort"), rt.ToValue(func(goja.FunctionCall) goja.Value {
		fn()
		return goja.Undefined()
	})); err != nil {
		panic(err)
	}
}

// readableStreamPipeTo 对应 ReadableStream.prototype.pipeTo + ReadableStreamPipeTo：把 source 的每个 chunk
// 写入 dest，直至 source 关闭/出错或 dest 关闭/出错或 signal 中止；按 preventClose/preventAbort/preventCancel
// 决定对侧是否跟随收尾。简化之处：源与目的地几乎同时失败时按"先到者生效"处理，不追加规范里针对该竞态的额外
// 分支（真实场景里两侧几乎不会在同一个微任务内同时失败）。
func readableStreamPipeTo(h *Host, source *readableState, destValue, optionsValue goja.Value) goja.Value {
	rt := h.rt
	dest, ok := writableStateOf(destValue)
	if !ok {
		return newRejectedPromise(rt, typeErrorf(rt, "ReadableStream.prototype.pipeTo's argument must be a WritableStream"))
	}
	if isReadableStreamLocked(source) || isWritableStreamLocked(dest) {
		return newRejectedPromise(rt, typeErrorf(rt, "ReadableStream.prototype.pipeTo cannot be used on a locked stream"))
	}
	options := pipeOptionsOf(rt, optionsValue)

	reader := acquireReadableStreamDefaultReader(h, source)
	writer := acquireWritableStreamDefaultWriter(h, dest)
	source.disturbed = true

	// 对应规范"If destination starts out closed or closing"：开始管道时目的地已经关闭或正在关闭，即使源流
	// 没有任何数据也要立即以 TypeError 收尾，不能一直等待源数据。
	destStartedClosed := dest.status == writableClosed || writableCloseQueuedOrInFlight(dest)

	promise, resolve, reject := rt.NewPromise()
	var shuttingDown bool
	var currentWrite goja.Value
	var reading, sourceClosed bool

	finalized := false
	finalize := func(ok bool, reason goja.Value) {
		if finalized {
			return
		}
		finalized = true
		shuttingDown = true
		writableWriterRelease(writer)
		readableStreamReaderGenericRelease(h, reader)
		if ok {
			must0(resolve(goja.Undefined()))
		} else {
			must0(reject(reason))
		}
	}

	var shutdown func(reason goja.Value, ok bool)
	shutdown = func(reason goja.Value, ok bool) {
		if shuttingDown {
			return
		}
		shuttingDown = true

		complete := func() {
			actions := []func() goja.Value{}
			if ok {
				if !options.preventClose {
					actions = append(actions, func() goja.Value { return writableStreamClose(h, dest) })
				}
			} else {
				if !options.preventAbort && dest.status == writableWritable {
					actions = append(actions, func() goja.Value { return writableStreamAbort(h, dest, reason) })
				}
				if !options.preventCancel && source.status == statusReadable {
					actions = append(actions, func() goja.Value { return readableStreamCancel(h, source, reason) })
				}
			}
			if len(actions) == 0 {
				finalize(ok, reason)
				return
			}
			remaining := len(actions)
			var firstErr goja.Value
			settleOne := func(err goja.Value) {
				remaining--
				if err != nil && firstErr == nil {
					firstErr = err
				}
				if remaining == 0 {
					if firstErr != nil {
						finalize(false, firstErr)
					} else {
						finalize(ok, reason)
					}
				}
			}
			for _, action := range actions {
				awaitResult(rt, action(), func(goja.Value) { settleOne(nil) }, func(r goja.Value) { settleOne(r) })
			}
		}

		// 写入按队列顺序完成，等待最后一次写入即可排空所有已提交的分块；收尾期间不再发起新的读取。
		// 正常结束时写入失败要传递给调用方，错误收尾时保留先触发收尾的原因。
		if currentWrite != nil && (ok || (dest.status == writableWritable && !writableCloseQueuedOrInFlight(dest))) {
			awaitResult(rt, currentWrite, func(goja.Value) { complete() }, func(writeReason goja.Value) {
				if ok {
					ok = false
					reason = writeReason
				}
				complete()
			})
		} else {
			complete()
		}
	}

	if destStartedClosed {
		shutdown(typeErrorf(rt, "Cannot pipe to a writable stream that is closed or closing"), false)
		return rt.ToValue(promise)
	}

	if options.signal != nil {
		if pipeSignalAborted(options.signal) {
			reason := pipeSignalReason(rt, options.signal)
			shutdown(reason, false)
			return rt.ToValue(promise)
		}
		pipeSignalOnAbort(rt, options.signal, func() {
			shutdown(pipeSignalReason(rt, options.signal), false)
		})
	}

	// 目的地出错必须立即触发收尾（对应规范"Errors must be propagated backward: if dest becomes errored"），
	// 不能只等当前这一次 write() 的结果——此时管道可能正卡在等待源数据（reader.read() 未落定）或等待
	// writer.ready 解除背压，这两种等待都不会主动去看 write() 的结果，若不单独监听会一直挂起。因为管道
	// 持有 dest 唯一的 writer（acquireWritableStreamDefaultWriter 要求其未被锁定），writer.closed 不会
	// 被管道之外的代码正常 resolve，所以只需处理它的拒绝分支；shutdown 本身是幂等的，重复调用是安全的。
	awaitResult(rt, writer.closed.value(rt), func(goja.Value) {}, func(reason goja.Value) {
		shutdown(reason, false)
	})

	// 源流的结束和错误独立于目的地的背压通知。最后一块出队时 closed 会先于 read() 完成，
	// 因此有挂起读取时先让读取回调提交该分块，再开始正常收尾。
	awaitResult(rt, reader.closed.value(rt), func(goja.Value) {
		sourceClosed = true
		if !reading {
			shutdown(nil, true)
		}
	}, func(reason goja.Value) {
		shutdown(reason, false)
	})

	var pump func()
	pump = func() {
		if shuttingDown {
			return
		}
		if writer.ready.isPending() {
			awaitResult(rt, writer.ready.value(rt), func(goja.Value) { pump() }, func(reason goja.Value) { shutdown(reason, false) })
			return
		}

		readPromise, readResolve, readReject := rt.NewPromise()
		reading = true
		readableStreamDefaultReaderRead(h, reader, readRequest{resolve: readResolve, reject: readReject})
		awaitResult(rt, rt.ToValue(readPromise), func(result goja.Value) {
			reading = false
			if shuttingDown {
				return
			}
			resultObj := result.ToObject(rt)
			if done := resultObj.Get("done"); done != nil && done.ToBoolean() {
				shutdown(nil, true)
				return
			}
			// 不等待这一次 write() 落定就继续循环：真正的节流由下一轮 writer.ready 的背压信号负责，
			// 与规范"读取和写入独立并行推进"的描述一致。
			currentWrite = writableWriterWrite(h, writer, resultObj.Get("value"))
			awaitResult(rt, currentWrite, func(goja.Value) {}, func(reason goja.Value) { shutdown(reason, false) })
			if sourceClosed {
				shutdown(nil, true)
			} else {
				pump()
			}
		}, func(reason goja.Value) {
			reading = false
			shutdown(reason, false)
		})
	}
	pump()

	return rt.ToValue(promise)
}

// readableStreamPipeThrough 对应 ReadableStream.prototype.pipeThrough：把 source pipeTo 到 transform.writable，
// 忽略结果 Promise（规范不把它暴露给调用方），返回 transform.readable。
func readableStreamPipeThrough(h *Host, source *readableState, transformValue, optionsValue goja.Value) goja.Value {
	rt := h.rt
	transform, ok := transformStateOf(transformValue)
	if !ok {
		panic(typeErrorf(rt, "ReadableStream.prototype.pipeThrough's argument must be a TransformStream"))
	}
	if isReadableStreamLocked(source) {
		panic(typeErrorf(rt, "ReadableStream.prototype.pipeThrough cannot be used on a locked stream"))
	}
	if isWritableStreamLocked(transform.writable) {
		panic(typeErrorf(rt, "ReadableStream.prototype.pipeThrough's argument cannot be used on a locked stream"))
	}
	readableStreamPipeTo(h, source, transform.writable.self, optionsValue)
	return transform.readable.self
}

// readableStreamTee 对应 ReadableStream.prototype.tee + ReadableStreamDefaultTee：返回两个共享同一数据源的
// 新 ReadableStream；一侧的 pull 请求同时驱动两条分支入队，一侧 cancel 时若另一侧也已 cancel 才真正取消源。
func readableStreamTee(h *Host, source *readableState) (branch1, branch2 *goja.Object) {
	rt := h.rt
	reader := acquireReadableStreamDefaultReader(h, source)

	var reading, readAgain bool
	var canceled1, canceled2 bool
	var reason1, reason2 goja.Value
	cancelPromise := newDeferred(rt)
	var branch1Controller, branch2Controller *readableController

	var pullAlgorithm func()
	pullAlgorithm = func() {
		if reading {
			readAgain = true
			return
		}
		reading = true
		readPromise, resolve, reject := rt.NewPromise()
		readableStreamDefaultReaderRead(h, reader, readRequest{resolve: resolve, reject: reject})
		awaitResult(rt, rt.ToValue(readPromise), func(result goja.Value) {
			reading = false
			if readAgain {
				readAgain = false
				pullAlgorithm()
			}
			resultObj := result.ToObject(rt)
			if done := resultObj.Get("done"); done != nil && done.ToBoolean() {
				if !canceled1 {
					readableControllerClose(h, branch1Controller)
				}
				if !canceled2 {
					readableControllerClose(h, branch2Controller)
				}
				if !canceled1 || !canceled2 {
					must0(cancelPromise.resolve(goja.Undefined()))
				}
				return
			}
			chunk := resultObj.Get("value")
			if !canceled1 {
				readableControllerEnqueue(h, branch1Controller, chunk)
			}
			if !canceled2 {
				readableControllerEnqueue(h, branch2Controller, chunk)
			}
		}, func(reason goja.Value) {
			reading = false
			if !canceled1 {
				readableControllerError(h, branch1Controller, reason)
			}
			if !canceled2 {
				readableControllerError(h, branch2Controller, reason)
			}
			if !canceled1 || !canceled2 {
				must0(cancelPromise.resolve(goja.Undefined()))
			}
		})
	}

	cancel1Algorithm := func(reason goja.Value) goja.Value {
		canceled1 = true
		reason1 = reason
		if canceled2 {
			must0(cancelPromise.resolve(readableStreamCancel(h, source, rt.NewArray(reason1, reason2))))
		}
		return cancelPromise.value(rt)
	}
	cancel2Algorithm := func(reason goja.Value) goja.Value {
		canceled2 = true
		reason2 = reason
		if canceled1 {
			must0(cancelPromise.resolve(readableStreamCancel(h, source, rt.NewArray(reason1, reason2))))
		}
		return cancelPromise.value(rt)
	}

	branch1Obj := h.NewReadableStream(nil, func(goja.Value) goja.Value { pullAlgorithm(); return nil },
		cancel1Algorithm, 1, nil)
	branch1State, _ := readableStateOf(branch1Obj)
	branch1Controller = branch1State.controller

	branch2Obj := h.NewReadableStream(nil, func(goja.Value) goja.Value { pullAlgorithm(); return nil },
		cancel2Algorithm, 1, nil)
	branch2State, _ := readableStateOf(branch2Obj)
	branch2Controller = branch2State.controller

	return branch1Obj, branch2Obj
}

// newReadableStreamAsyncIterator 对应 4.3.9 节的 Readable Stream Asynchronous Iterator：返回一个带 next()/
// return() 方法、且自身可迭代（[Symbol.for("Symbol.asyncIterator")] 返回自身）的对象。由于本沙箱固定的 goja
// 版本没有原生 Symbol.asyncIterator，这个符号键同样退化为 Symbol.for("Symbol.asyncIterator")，脚本只能手动
// 调用 next()，不能用 for-await 语法消费（该语法在这版 goja 下直接报语法错误）。
func newReadableStreamAsyncIterator(h *Host, stream *readableState, preventCancel bool) *goja.Object {
	rt := h.rt
	reader := acquireReadableStreamDefaultReader(h, stream)

	iterator := rt.NewObject()
	defineMethod(rt, iterator, "next", 0, func(call goja.FunctionCall) goja.Value {
		if reader.stream == nil {
			return newRejectedPromise(rt, typeErrorf(rt, "Cannot get the next iteration result once the reader has been released"))
		}
		promise, resolve, reject := rt.NewPromise()
		readableStreamDefaultReaderRead(h, reader, readRequest{resolve: resolve, reject: reject})
		return rt.ToValue(promise)
	})
	defineMethod(rt, iterator, "return", 1, func(call goja.FunctionCall) goja.Value {
		value := call.Argument(0)
		if reader.stream == nil {
			return newResolvedPromiseResult(rt, value, true)
		}
		if !preventCancel {
			cancelResult := readableStreamCancel(h, reader.stream, value)
			readableStreamReaderGenericRelease(h, reader)
			promise, resolve, reject := rt.NewPromise()
			awaitResult(rt, cancelResult, func(goja.Value) {
				result := rt.NewObject()
				must(result.Set("value", value))
				must(result.Set("done", rt.ToValue(true)))
				must0(resolve(result))
			}, func(reason goja.Value) { must0(reject(reason)) })
			return rt.ToValue(promise)
		}
		readableStreamReaderGenericRelease(h, reader)
		return newResolvedPromiseResult(rt, value, true)
	})
	must(iterator.DefineDataPropertySymbol(asyncIteratorSymbol(rt), rt.ToValue(func(goja.FunctionCall) goja.Value { return iterator }),
		goja.FLAG_TRUE, goja.FLAG_TRUE, goja.FLAG_FALSE))
	return iterator
}
