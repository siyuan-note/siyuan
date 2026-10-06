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

// newWritableControllerPrototype 构造 WritableStreamDefaultController.prototype：error 方法。本包不暴露
// controller.signal（见 setUpWritableStreamDefaultController 的注释）。
func newWritableControllerPrototype(h *Host) *goja.Object {
	rt := h.rt
	prototype := rt.NewObject()

	self := func(call goja.FunctionCall, method string) *writableController {
		c, ok := writableControllerOf(call.This)
		if !ok {
			panic(typeErrorf(rt, "WritableStreamDefaultController.prototype.%s called on an incompatible receiver", method))
		}
		return c
	}

	defineMethod(rt, prototype, "error", 1, func(call goja.FunctionCall) goja.Value {
		c := self(call, "error")
		writableControllerErrorIfNeeded(h, c, call.Argument(0))
		return goja.Undefined()
	})
	defineToStringTag(rt, prototype, "WritableStreamDefaultController")
	return prototype
}

// newWritableWriterPrototype 构造 WritableStreamDefaultWriter.prototype：closed/desiredSize/ready 访问器，
// abort/close/releaseLock/write 方法。
func newWritableWriterPrototype(h *Host) *goja.Object {
	rt := h.rt
	prototype := rt.NewObject()

	self := func(call goja.FunctionCall, method string) *writableWriterState {
		w, ok := writableWriterOf(call.This)
		if !ok {
			panic(typeErrorf(rt, "WritableStreamDefaultWriter.prototype.%s called on an incompatible receiver", method))
		}
		return w
	}

	defineGetter(rt, prototype, "closed", func(call goja.FunctionCall) goja.Value {
		return self(call, "closed").closed.value(rt)
	})
	defineGetter(rt, prototype, "desiredSize", func(call goja.FunctionCall) goja.Value {
		return writableWriterDesiredSize(h, self(call, "desiredSize"))
	})
	defineGetter(rt, prototype, "ready", func(call goja.FunctionCall) goja.Value {
		return self(call, "ready").ready.value(rt)
	})
	defineMethod(rt, prototype, "abort", 1, func(call goja.FunctionCall) goja.Value {
		return writableWriterAbort(h, self(call, "abort"), call.Argument(0))
	})
	defineMethod(rt, prototype, "close", 0, func(call goja.FunctionCall) goja.Value {
		return writableWriterClose(h, self(call, "close"))
	})
	defineMethod(rt, prototype, "releaseLock", 0, func(call goja.FunctionCall) goja.Value {
		writableWriterRelease(self(call, "releaseLock"))
		return goja.Undefined()
	})
	defineMethod(rt, prototype, "write", 1, func(call goja.FunctionCall) goja.Value {
		return writableWriterWrite(h, self(call, "write"), call.Argument(0))
	})
	defineToStringTag(rt, prototype, "WritableStreamDefaultWriter")
	return prototype
}

// newWritableStreamPrototype 构造 WritableStream.prototype：locked 访问器，abort/close/getWriter 方法。
func newWritableStreamPrototype(h *Host) *goja.Object {
	rt := h.rt
	prototype := rt.NewObject()

	self := func(call goja.FunctionCall, method string) *writableState {
		s, ok := writableStateOf(call.This)
		if !ok {
			panic(typeErrorf(rt, "WritableStream.prototype.%s called on an incompatible receiver", method))
		}
		return s
	}

	defineGetter(rt, prototype, "locked", func(call goja.FunctionCall) goja.Value {
		return rt.ToValue(isWritableStreamLocked(self(call, "locked")))
	})
	defineMethod(rt, prototype, "abort", 1, func(call goja.FunctionCall) goja.Value {
		stream := self(call, "abort")
		if isWritableStreamLocked(stream) {
			return newRejectedPromise(rt, typeErrorf(rt, "Cannot abort a stream that already has a writer"))
		}
		return writableStreamAbort(h, stream, call.Argument(0))
	})
	defineMethod(rt, prototype, "close", 0, func(call goja.FunctionCall) goja.Value {
		stream := self(call, "close")
		if isWritableStreamLocked(stream) {
			return newRejectedPromise(rt, typeErrorf(rt, "Cannot close a stream that already has a writer"))
		}
		if writableCloseQueuedOrInFlight(stream) {
			return newRejectedPromise(rt, typeErrorf(rt, "Cannot close an already-closing stream"))
		}
		return writableStreamClose(h, stream)
	})
	defineMethod(rt, prototype, "getWriter", 0, func(call goja.FunctionCall) goja.Value {
		return acquireWritableStreamDefaultWriter(h, self(call, "getWriter")).jsValue()
	})
	defineToStringTag(rt, prototype, "WritableStream")
	return prototype
}

// newWritableStreamConstructor 构造 WritableStream 全局构造函数：new WritableStream(underlyingSink, strategy)。
func (h *Host) newWritableStreamConstructor() *goja.Object {
	rt := h.rt
	return newInterfaceConstructor(rt, "WritableStream", 0, h.writableStreamPrototype, func(call goja.ConstructorCall) *goja.Object {
		sink := call.Argument(0)
		var sinkObj *goja.Object
		if isJsValueNotNull(sink) {
			var ok bool
			sinkObj, ok = sink.(*goja.Object)
			if !ok {
				panic(typeErrorf(rt, "WritableStream: Argument 1 can't be converted to a dictionary"))
			}
		}

		stream := &writableState{host: h, status: writableWritable}
		object := h.rt.NewDynamicObject(stream)
		must(object.SetPrototype(call.This.Prototype()))
		stream.self = object

		highWaterMark := extractHighWaterMark(rt, call.Argument(1), 1)
		sizeAlgorithm := extractSizeAlgorithm(rt, call.Argument(1))
		start := wrapUnderlyingMethod(rt, sinkObj, "start")
		write := wrapUnderlyingMethod(rt, sinkObj, "write")
		cls := wrapUnderlyingNoArgMethod(rt, sinkObj, "close")
		abort := wrapUnderlyingMethod(rt, sinkObj, "abort")
		setUpWritableStreamDefaultController(h, stream, orNoOp(start), orNoOp(write), cls, orNoOp(abort), highWaterMark, sizeAlgorithm)
		return object
	})
}

// wrapUnderlyingNoArgMethod 与 wrapUnderlyingMethod 类似，但包装的是不接收参数的方法（如 close）。
func wrapUnderlyingNoArgMethod(rt *goja.Runtime, source *goja.Object, name string) func() goja.Value {
	fn := wrapUnderlyingMethod(rt, source, name)
	if fn == nil {
		return nil
	}
	return func() goja.Value { return fn(goja.Undefined()) }
}
