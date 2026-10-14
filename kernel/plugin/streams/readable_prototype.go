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
	"github.com/dop251/goja"
)

// newReadableControllerPrototype 构造 ReadableStreamDefaultController.prototype：desiredSize 访问器，
// enqueue/close/error 方法。
func newReadableControllerPrototype(h *Host) *goja.Object {
	rt := h.rt
	prototype := rt.NewObject()

	self := func(call goja.FunctionCall, method string) *readableController {
		c, ok := readableControllerOf(call.This)
		if !ok {
			panic(typeErrorf(rt, "ReadableStreamDefaultController.prototype.%s called on an incompatible receiver", method))
		}
		return c
	}

	defineGetter(rt, prototype, "desiredSize", func(call goja.FunctionCall) goja.Value {
		size, ok := readableControllerDesiredSize(self(call, "desiredSize"))
		if !ok {
			return goja.Null()
		}
		return rt.ToValue(size)
	})
	defineMethod(rt, prototype, "enqueue", 1, func(call goja.FunctionCall) goja.Value {
		c := self(call, "enqueue")
		if !readableControllerCanCloseOrEnqueue(c) {
			panic(typeErrorf(rt, "Cannot enqueue a chunk into a readable stream that is closed or has been requested to be closed"))
		}
		readableControllerEnqueue(h, c, call.Argument(0))
		return goja.Undefined()
	})
	defineMethod(rt, prototype, "close", 0, func(call goja.FunctionCall) goja.Value {
		c := self(call, "close")
		if !readableControllerCanCloseOrEnqueue(c) {
			panic(typeErrorf(rt, "Cannot close a readable stream that has already been requested to be closed"))
		}
		readableControllerClose(h, c)
		return goja.Undefined()
	})
	defineMethod(rt, prototype, "error", 1, func(call goja.FunctionCall) goja.Value {
		c := self(call, "error")
		readableControllerError(h, c, call.Argument(0))
		return goja.Undefined()
	})
	defineToStringTag(rt, prototype, "ReadableStreamDefaultController")
	return prototype
}

// newReadableReaderPrototype 构造 ReadableStreamDefaultReader.prototype：closed 访问器，cancel/read/
// releaseLock 方法。
func newReadableReaderPrototype(h *Host) *goja.Object {
	rt := h.rt
	prototype := rt.NewObject()

	self := func(call goja.FunctionCall, method string) *readableReaderState {
		r, ok := readableReaderOf(call.This)
		if !ok {
			panic(typeErrorf(rt, "ReadableStreamDefaultReader.prototype.%s called on an incompatible receiver", method))
		}
		return r
	}

	defineGetter(rt, prototype, "closed", func(call goja.FunctionCall) goja.Value {
		return self(call, "closed").closed.value(rt)
	})
	defineMethod(rt, prototype, "cancel", 1, func(call goja.FunctionCall) goja.Value {
		reader := self(call, "cancel")
		if reader.stream == nil {
			return newRejectedPromise(rt, typeErrorf(rt, "Cannot cancel a readable stream reader that has no owner stream"))
		}
		return h.rt.ToValue(readableStreamCancel(h, reader.stream, call.Argument(0)))
	})
	defineMethod(rt, prototype, "read", 0, func(call goja.FunctionCall) goja.Value {
		reader := self(call, "read")
		if reader.stream == nil {
			return newRejectedPromise(rt, typeErrorf(rt, "Cannot read from a reader released from its owner stream"))
		}

		promise, resolve, reject := rt.NewPromise()
		readableStreamDefaultReaderRead(h, reader, readRequest{resolve: resolve, reject: reject})
		return rt.ToValue(promise)
	})
	defineMethod(rt, prototype, "releaseLock", 0, func(call goja.FunctionCall) goja.Value {
		reader := self(call, "releaseLock")
		if reader.stream == nil {
			return goja.Undefined()
		}
		if len(reader.readRequests) > 0 {
			readableStreamDefaultReaderErrorReadRequests(reader,
				typeErrorf(rt, "Reader was released and can no longer be used to monitor the stream's closedness"))
		}
		readableStreamReaderGenericRelease(h, reader)
		return goja.Undefined()
	})
	defineToStringTag(rt, prototype, "ReadableStreamDefaultReader")
	return prototype
}

// newResolvedPromiseResult 返回一个以 {value, done} 兑定的 Promise。
func newResolvedPromiseResult(rt *goja.Runtime, value goja.Value, done bool) goja.Value {
	result := rt.NewObject()
	must(result.Set("value", value))
	must(result.Set("done", rt.ToValue(done)))
	return newResolvedPromise(rt, result)
}

// newReadableStreamPrototype 构造 ReadableStream.prototype：locked 访问器，cancel/getReader/pipeTo/
// pipeThrough/tee/values 方法与 Symbol.asyncIterator 别名。
func newReadableStreamPrototype(h *Host) *goja.Object {
	rt := h.rt
	prototype := rt.NewObject()

	self := func(call goja.FunctionCall, method string) *readableState {
		s, ok := readableStateOf(call.This)
		if !ok {
			panic(typeErrorf(rt, "ReadableStream.prototype.%s called on an incompatible receiver", method))
		}
		return s
	}

	defineGetter(rt, prototype, "locked", func(call goja.FunctionCall) goja.Value {
		return rt.ToValue(isReadableStreamLocked(self(call, "locked")))
	})
	defineMethod(rt, prototype, "cancel", 1, func(call goja.FunctionCall) goja.Value {
		stream := self(call, "cancel")
		if isReadableStreamLocked(stream) {
			return newRejectedPromise(rt, typeErrorf(rt, "Cannot cancel a stream that already has a reader"))
		}
		return readableStreamCancel(h, stream, call.Argument(0))
	})
	defineMethod(rt, prototype, "getReader", 0, func(call goja.FunctionCall) goja.Value {
		stream := self(call, "getReader")
		if options := call.Argument(0); isJsValueNotNull(options) {
			optionsObj, ok := options.(*goja.Object)
			if !ok {
				panic(typeErrorf(rt, "ReadableStream.prototype.getReader: Argument 1 can't be converted to a dictionary"))
			}
			if mode := dictMember(optionsObj, "mode"); mode != nil {
				modeStr := mode.String()
				if modeStr == "byob" {
					panic(typeErrorf(rt, "ReadableStream.prototype.getReader: byte stream readers (mode: \"byob\") are not supported"))
				}
				panic(typeErrorf(rt, "ReadableStream.prototype.getReader: '%s' (value of 'mode' member of ReadableGetReaderOptions) is not a valid value for enumeration ReadableStreamReaderMode", modeStr))
			}
		}
		return acquireReadableStreamDefaultReader(h, stream).jsValue()
	})
	defineMethod(rt, prototype, "pipeTo", 2, func(call goja.FunctionCall) goja.Value {
		stream := self(call, "pipeTo")
		return readableStreamPipeTo(h, stream, call.Argument(0), call.Argument(1))
	})
	defineMethod(rt, prototype, "pipeThrough", 2, func(call goja.FunctionCall) goja.Value {
		stream := self(call, "pipeThrough")
		return readableStreamPipeThrough(h, stream, call.Argument(0), call.Argument(1))
	})
	defineMethod(rt, prototype, "tee", 0, func(call goja.FunctionCall) goja.Value {
		stream := self(call, "tee")
		a, b := readableStreamTee(h, stream)
		return rt.NewArray(a, b)
	})
	defineMethod(rt, prototype, "values", 1, func(call goja.FunctionCall) goja.Value {
		stream := self(call, "values")
		return newReadableStreamAsyncIterator(h, stream, readableIteratorOptionPreventCancel(rt, call.Argument(0)))
	})
	// goja（本沙箱固定的版本）没有原生 Symbol.asyncIterator，与 web-streams-polyfill 遇到同一问题时的做法一致，
	// 退化为 Symbol.for("Symbol.asyncIterator")：脚本写 stream[Symbol.for("Symbol.asyncIterator")]() 可以拿到
	// 这个方法，但 `for await (const chunk of stream)` 语法本身在这版 goja 下不被解析，不受此影响。
	must(prototype.DefineDataPropertySymbol(asyncIteratorSymbol(rt), prototype.Get("values"), goja.FLAG_TRUE, goja.FLAG_TRUE, goja.FLAG_FALSE))
	defineToStringTag(rt, prototype, "ReadableStream")
	return prototype
}

// asyncIteratorSymbol 返回与脚本里 Symbol.for("Symbol.asyncIterator") 同一个全局注册表条目的 Symbol，
// 而不是用 goja.NewSymbol 另造一个无法被脚本按名字查到的符号。
func asyncIteratorSymbol(rt *goja.Runtime) *goja.Symbol {
	symbolCtor := rt.Get("Symbol").ToObject(rt)
	forFn, ok := goja.AssertFunction(symbolCtor.Get("for"))
	if !ok {
		panic(typeErrorf(rt, "globalThis.Symbol.for is not a function"))
	}
	result, err := forFn(symbolCtor, rt.ToValue("Symbol.asyncIterator"))
	if err != nil {
		panic(err)
	}
	sym, ok := result.(*goja.Symbol)
	if !ok {
		panic(typeErrorf(rt, "Symbol.for did not return a Symbol"))
	}
	return sym
}

// readableIteratorOptionPreventCancel 读取 values()/[Symbol.asyncIterator] 的 {preventCancel} 选项；
// undefined/null 视为缺省（false），与 WebIDL 字典参数的习惯一致。
func readableIteratorOptionPreventCancel(rt *goja.Runtime, options goja.Value) bool {
	if !isJsValueNotNull(options) {
		return false
	}
	object, ok := options.(*goja.Object)
	if !ok {
		panic(typeErrorf(rt, "values: options can't be converted to a dictionary"))
	}
	preventCancel := object.Get("preventCancel")
	return preventCancel != nil && !goja.IsUndefined(preventCancel) && preventCancel.ToBoolean()
}

// newReadableStreamConstructor 构造 ReadableStream 全局构造函数：new ReadableStream(underlyingSource, strategy)。
// 不支持 underlyingSource.type === "bytes"（字节流），遇到会抛错，是本包对规范的已知、文档化的裁剪。
func (h *Host) newReadableStreamConstructor() *goja.Object {
	rt := h.rt
	return newInterfaceConstructor(rt, "ReadableStream", 0, h.readableStreamPrototype, func(call goja.ConstructorCall) *goja.Object {
		source := call.Argument(0)
		var sourceObj *goja.Object
		if isJsValueNotNull(source) {
			var ok bool
			sourceObj, ok = source.(*goja.Object)
			if !ok {
				panic(typeErrorf(rt, "ReadableStream: Argument 1 can't be converted to a dictionary"))
			}
			if typ := sourceObj.Get("type"); isJsValueNotNull(typ) {
				panic(typeErrorf(rt, "ReadableStream: byte streams (type: \"bytes\") are not supported"))
			}
		}

		stream := &readableState{host: h, status: statusReadable}
		object := h.rt.NewDynamicObject(stream)
		must(object.SetPrototype(call.This.Prototype()))
		stream.self = object

		highWaterMark := extractHighWaterMark(rt, call.Argument(1), 1)
		sizeAlgorithm := extractSizeAlgorithm(rt, call.Argument(1))
		start := wrapUnderlyingMethod(rt, sourceObj, "start")
		pull := wrapUnderlyingMethod(rt, sourceObj, "pull")
		cancel := wrapUnderlyingMethod(rt, sourceObj, "cancel")
		setUpReadableStreamDefaultController(h, stream, orNoOp(start), orNoOp(pull), orNoOp(cancel), highWaterMark, sizeAlgorithm)
		return object
	})
}

// readableStreamFrom 对应 ReadableStream.from(asyncIterable)：把一个同步或异步可迭代对象包装成
// ReadableStream。优先用 Symbol.for("Symbol.asyncIterator")（与本包自己 values() 的输出互通），
// 否则退回 Symbol.iterator；sync 迭代器的 next() 直接返回 {value, done}，async 版本返回 Promise，
// awaitResult 对两者一视同仁。cancel() 时若迭代器有 return 方法会调用一次（忽略其返回值）。
func (h *Host) readableStreamFrom(iterable goja.Value) *goja.Object {
	rt := h.rt
	iterator := iteratorOf(rt, iterable)
	next, ok := goja.AssertFunction(iterator.Get("next"))
	if !ok {
		panic(typeErrorf(rt, "ReadableStream.from: the iterator's next method is not callable"))
	}

	return h.NewReadableStream(nil, func(controller goja.Value) goja.Value {
		c, _ := readableControllerOf(controller)
		result, err := next(iterator)
		if err != nil {
			panic(err)
		}
		promise, resolve, reject := rt.NewPromise()
		awaitResult(rt, result, func(value goja.Value) {
			// 对应规范 IteratorNext：next() 的返回值必须是对象，否则抛 TypeError。只用 ToObject 转换会把
			// 数字、字符串等原始值自动装箱成临时对象、悄悄放过本该报错的输入（object.Get("done") 在装箱
			// 对象上读不到值返回裸 nil，没有命中下面的 close 分支，而是把 undefined 当成 chunk 入队），
			// 所以要先显式检查 value 本身是不是对象。
			object, ok := value.(*goja.Object)
			if !ok {
				err := typeErrorf(rt, "ReadableStream.from: the iterator result is not an object")
				readableControllerError(h, c, err)
				must0(reject(err))
				return
			}
			if done := object.Get("done"); done != nil && done.ToBoolean() {
				readableControllerClose(h, c)
			} else {
				readableControllerEnqueue(h, c, object.Get("value"))
			}
			must0(resolve(goja.Undefined()))
		}, func(reason goja.Value) {
			readableControllerError(h, c, reason)
			must0(reject(reason))
		})
		return rt.ToValue(promise)
	}, func(reason goja.Value) goja.Value {
		if returnFn, ok := goja.AssertFunction(iterator.Get("return")); ok {
			if _, err := returnFn(iterator, reason); err != nil {
				panic(err)
			}
		}
		return nil
	}, 0, nil)
}

// iteratorOf 取出 iterable 的迭代器：先找 Symbol.for("Symbol.asyncIterator")，再退回 Symbol.iterator，
// 两者都没有则抛错。
func iteratorOf(rt *goja.Runtime, iterable goja.Value) *goja.Object {
	object, ok := iterable.(*goja.Object)
	if !ok {
		panic(typeErrorf(rt, "ReadableStream.from: Argument 1 is not an object"))
	}
	getIterator, ok := goja.AssertFunction(object.GetSymbol(asyncIteratorSymbol(rt)))
	if !ok {
		getIterator, ok = goja.AssertFunction(object.GetSymbol(goja.SymIterator))
	}
	if !ok {
		panic(typeErrorf(rt, "ReadableStream.from: Argument 1 is not async-iterable or iterable"))
	}
	iteratorValue, err := getIterator(object)
	if err != nil {
		panic(err)
	}
	iterator, ok := iteratorValue.(*goja.Object)
	if !ok {
		panic(typeErrorf(rt, "ReadableStream.from: the iterator method did not return an object"))
	}
	return iterator
}

// wrapUnderlyingMethod 把 underlyingSource/underlyingSink/transformer 字典上名为 name 的可选方法包装为
// Go 函数：以 source 为 this 调用，传入单个参数（controller 或 reason），异常原样 panic 向上传播。source
// 为 nil 或方法缺省时返回 nil（调用方据此套用默认算法）。
func wrapUnderlyingMethod(rt *goja.Runtime, source *goja.Object, name string) func(arg goja.Value) goja.Value {
	if source == nil {
		return nil
	}
	method := source.Get(name)
	if method == nil || goja.IsUndefined(method) {
		return nil
	}
	fn, ok := goja.AssertFunction(method)
	if !ok {
		panic(typeErrorf(rt, "%s member of underlying source must be a function", name))
	}
	return func(arg goja.Value) goja.Value {
		result, err := fn(source, arg)
		if err != nil {
			panic(err)
		}
		return result
	}
}

// isJsValueNotNull 判断值既非 nil，也非 undefined/null。
func isJsValueNotNull(value goja.Value) bool {
	return value != nil && !goja.IsUndefined(value) && !goja.IsNull(value)
}
