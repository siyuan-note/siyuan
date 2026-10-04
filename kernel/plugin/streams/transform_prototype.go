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

// newTransformControllerPrototype 构造 TransformStreamDefaultController.prototype：desiredSize 访问器，
// enqueue/error/terminate 方法。
func newTransformControllerPrototype(h *Host) *goja.Object {
	rt := h.rt
	prototype := rt.NewObject()

	self := func(call goja.FunctionCall, method string) *transformController {
		c, ok := transformControllerOf(call.This)
		if !ok {
			panic(typeErrorf(rt, "TransformStreamDefaultController.prototype.%s called on an incompatible receiver", method))
		}
		return c
	}

	defineGetter(rt, prototype, "desiredSize", func(call goja.FunctionCall) goja.Value {
		size, ok := transformControllerDesiredSize(self(call, "desiredSize"))
		if !ok {
			return goja.Null()
		}
		return rt.ToValue(size)
	})
	defineMethod(rt, prototype, "enqueue", 1, func(call goja.FunctionCall) goja.Value {
		transformControllerEnqueue(h, self(call, "enqueue"), call.Argument(0))
		return goja.Undefined()
	})
	defineMethod(rt, prototype, "error", 1, func(call goja.FunctionCall) goja.Value {
		c := self(call, "error")
		transformStreamError(h, c.stream, call.Argument(0))
		return goja.Undefined()
	})
	defineMethod(rt, prototype, "terminate", 0, func(call goja.FunctionCall) goja.Value {
		transformControllerTerminate(h, self(call, "terminate"))
		return goja.Undefined()
	})
	defineToStringTag(rt, prototype, "TransformStreamDefaultController")
	return prototype
}

// newTransformStreamPrototype 构造 TransformStream.prototype：readable/writable 访问器。
func newTransformStreamPrototype(h *Host) *goja.Object {
	rt := h.rt
	prototype := rt.NewObject()

	self := func(call goja.FunctionCall, method string) *transformState {
		s, ok := transformStateOf(call.This)
		if !ok {
			panic(typeErrorf(rt, "TransformStream.prototype.%s called on an incompatible receiver", method))
		}
		return s
	}
	defineGetter(rt, prototype, "readable", func(call goja.FunctionCall) goja.Value {
		return self(call, "readable").readable.self
	})
	defineGetter(rt, prototype, "writable", func(call goja.FunctionCall) goja.Value {
		return self(call, "writable").writable.self
	})
	defineToStringTag(rt, prototype, "TransformStream")
	return prototype
}

// newTransformStreamObject 按规范 InitializeTransformStream + SetUpTransformStreamDefaultController 构造一个
// TransformStream 实例：先建好 readable/writable 两侧（其算法通过 stream.controller 延迟查找，不要求
// controller 提前存在），再建 controller 并包装 transform/flush/cancel（可直接引用 controller，构造顺序上
// controller 已经存在），最后用 controller 调用 start（如果提供）。
func (h *Host) newTransformStreamObject(
	transform func(chunk, controller goja.Value) goja.Value,
	flush func(controller goja.Value) goja.Value,
	cancel func(reason goja.Value) goja.Value,
	writableHWM, readableHWM float64,
	writableSizeAlgorithm, readableSizeAlgorithm func(goja.Value) float64,
	start func(controller goja.Value) goja.Value,
) *goja.Object {
	stream := &transformState{host: h}

	// readable 与 writable 两侧的 start 算法共用同一个 Promise：在 transformer 自己的 start()（如果提供）
	// 落定前，两侧的 controller.started 都保持 false，与规范 InitializeTransformStream 一致。
	startShared := newDeferred(h.rt)
	sharedStart := func(goja.Value) goja.Value { return startShared.value(h.rt) }

	stream.writable = &writableState{host: h, status: writableWritable}
	h.newWritableStreamObject(stream.writable)
	setUpWritableStreamDefaultController(h, stream.writable,
		sharedStart,
		func(chunk goja.Value) goja.Value { return transformStreamDefaultSinkWriteAlgorithm(h, stream, chunk) },
		func() goja.Value { return transformStreamDefaultSinkCloseAlgorithm(h, stream) },
		func(reason goja.Value) goja.Value { return transformStreamDefaultSinkAbortAlgorithm(h, stream, reason) },
		writableHWM, writableSizeAlgorithm)

	stream.readable = &readableState{host: h, status: statusReadable}
	h.newReadableStreamObject(stream.readable)
	setUpReadableStreamDefaultController(h, stream.readable,
		sharedStart,
		func(goja.Value) goja.Value { return transformStreamDefaultSourcePullAlgorithm(stream) },
		func(reason goja.Value) goja.Value {
			transformStreamErrorWritableAndUnblockWrite(h, stream, reason)
			return nil
		},
		readableHWM, readableSizeAlgorithm)

	transformStreamSetBackpressure(stream, true)

	controller := &transformController{host: h, stream: stream}
	controller.transformAlgorithm = func(chunk goja.Value) goja.Value {
		if transform != nil {
			return transform(chunk, controller.jsValue())
		}
		// 缺省为恒等转换：直接把 chunk 原样 enqueue 到 readable 侧。
		transformControllerEnqueue(h, controller, chunk)
		return nil
	}
	if flush != nil {
		controller.flushAlgorithm = func() goja.Value { return flush(controller.jsValue()) }
	}
	controller.cancelAlgorithm = cancel
	stream.controller = controller

	object := h.rt.NewDynamicObject(stream)
	must(object.SetPrototype(h.transformStreamPrototype))
	stream.self = object

	// 调用 transformer 自己的 start（如果提供），用其结果落定两侧共用的 startShared：readable/writable
	// controller 的 CallPullIfNeeded/AdvanceQueueIfNeeded 都要等它落定才会真正开始工作。
	var startResult goja.Value
	settled := func() (ok bool) {
		defer func() {
			if r := recover(); r != nil {
				reason := panicToReason(h.rt, r)
				transformStreamError(h, stream, reason)
				must0(startShared.reject(reason))
				ok = false
			}
		}()
		if start != nil {
			startResult = start(controller.jsValue())
		}
		return true
	}()
	if settled {
		awaitResult(h.rt, orUndefined(startResult), func(goja.Value) {
			must0(startShared.resolve(goja.Undefined()))
		}, func(reason goja.Value) {
			transformStreamError(h, stream, reason)
			must0(startShared.reject(reason))
		})
	}
	return object
}

// newTransformStreamConstructor 构造 TransformStream 全局构造函数：
// new TransformStream(transformer, writableStrategy, readableStrategy)。不支持
// transformer.readableType/writableType（字节流变体），遇到会抛错。
func (h *Host) newTransformStreamConstructor() *goja.Object {
	rt := h.rt
	return newInterfaceConstructor(rt, "TransformStream", 0, h.transformStreamPrototype, func(call goja.ConstructorCall) *goja.Object {
		transformer := call.Argument(0)
		var transformerObj *goja.Object
		if isJsValueNotNull(transformer) {
			var ok bool
			transformerObj, ok = transformer.(*goja.Object)
			if !ok {
				panic(typeErrorf(rt, "TransformStream: Argument 1 can't be converted to a dictionary"))
			}
			if t := transformerObj.Get("readableType"); isJsValueNotNull(t) {
				panic(typeErrorf(rt, "TransformStream: readableType is not supported"))
			}
			if t := transformerObj.Get("writableType"); isJsValueNotNull(t) {
				panic(typeErrorf(rt, "TransformStream: writableType is not supported"))
			}
		}

		writableHWM := extractHighWaterMark(rt, call.Argument(1), 1)
		writableSizeAlgorithm := extractSizeAlgorithm(rt, call.Argument(1))
		readableHWM := extractHighWaterMark(rt, call.Argument(2), 0)
		readableSizeAlgorithm := extractSizeAlgorithm(rt, call.Argument(2))

		transform := wrapTransformerTransform(rt, transformerObj)
		flush := wrapUnderlyingMethod(rt, transformerObj, "flush")
		cancel := wrapUnderlyingMethod(rt, transformerObj, "cancel")
		start := wrapUnderlyingMethod(rt, transformerObj, "start")

		object := h.newTransformStreamObject(transform, flush, cancel, writableHWM, readableHWM,
			writableSizeAlgorithm, readableSizeAlgorithm, start)
		must(object.SetPrototype(call.This.Prototype()))
		return object
	})
}

// wrapTransformerTransform 包装 transformer.transform(chunk, controller)：以 transformer 为 this 调用，缺省
// （未提供 transform 成员）返回 nil，交由调用方套用恒等转换。
func wrapTransformerTransform(rt *goja.Runtime, transformer *goja.Object) func(chunk, controller goja.Value) goja.Value {
	if transformer == nil {
		return nil
	}
	method := transformer.Get("transform")
	if method == nil || goja.IsUndefined(method) {
		return nil
	}
	fn, ok := goja.AssertFunction(method)
	if !ok {
		panic(typeErrorf(rt, "transform member of transformer must be a function"))
	}
	return func(chunk, controller goja.Value) goja.Value {
		result, err := fn(transformer, chunk, controller)
		if err != nil {
			panic(err)
		}
		return result
	}
}
