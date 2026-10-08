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
	"reflect"

	"github.com/dop251/goja"
)

// transformState 对应 TransformStream 的内部槛：readable 与 writable 一对流，由 controller 的 enqueue/
// terminate/error 操作桥接。
type transformState struct {
	expandoProperties

	host *Host

	readable *readableState
	writable *writableState

	backpressure       bool
	backpressureChange deferred

	controller *transformController

	self *goja.Object
}

// transformController 对应 TransformStreamDefaultController 的内部槛。
type transformController struct {
	expandoProperties

	host   *Host
	stream *transformState

	transformAlgorithm func(chunk goja.Value) goja.Value
	flushAlgorithm     func() goja.Value
	cancelAlgorithm    func(reason goja.Value) goja.Value

	finishPromise *deferred // 非 nil 表示 abort/close 已经在排空，避免重复触发

	self *goja.Object
}

var (
	transformStateType      = reflect.TypeOf((*transformState)(nil))
	transformControllerType = reflect.TypeOf((*transformController)(nil))
)

func transformStateOf(value goja.Value) (*transformState, bool) {
	object, ok := value.(*goja.Object)
	if !ok || object.ExportType() != transformStateType {
		return nil, false
	}
	state, ok := object.Export().(*transformState)
	return state, ok
}

func transformControllerOf(value goja.Value) (*transformController, bool) {
	object, ok := value.(*goja.Object)
	if !ok || object.ExportType() != transformControllerType {
		return nil, false
	}
	state, ok := object.Export().(*transformController)
	return state, ok
}

func (c *transformController) jsValue() *goja.Object {
	if c.self == nil {
		object := c.host.rt.NewDynamicObject(c)
		must(object.SetPrototype(c.host.transformControllerProto))
		c.self = object
	}
	return c.self
}

// transformStreamSetBackpressure 对应 TransformStreamSetBackpressure：兑定旧的 backpressureChange Promise
// 并换上一个新的 pending Promise。
func transformStreamSetBackpressure(stream *transformState, backpressure bool) {
	if stream.backpressureChange.promise != nil {
		must0(stream.backpressureChange.resolve(goja.Undefined()))
	}
	stream.backpressureChange = newDeferred(stream.host.rt)
	stream.backpressure = backpressure
}

// transformStreamErrorWritableAndUnblockWrite 对应 TransformStreamErrorWritableAndUnblockWrite。
func transformStreamErrorWritableAndUnblockWrite(h *Host, stream *transformState, reason goja.Value) {
	transformControllerClearAlgorithms(stream.controller)
	writableControllerErrorIfNeeded(h, stream.writable.controller, reason)
	if stream.backpressure {
		transformStreamSetBackpressure(stream, false)
	}
}

// transformStreamError 对应 TransformStreamError。
func transformStreamError(h *Host, stream *transformState, reason goja.Value) {
	readableControllerError(h, stream.readable.controller, reason)
	transformStreamErrorWritableAndUnblockWrite(h, stream, reason)
}

func transformControllerClearAlgorithms(c *transformController) {
	c.transformAlgorithm = nil
	c.flushAlgorithm = nil
	c.cancelAlgorithm = nil
}

// transformStreamDefaultSinkWriteAlgorithm 对应 TransformStreamDefaultSinkWriteAlgorithm：writable 侧的
// write() 落到这里，若当前存在背压需要等待 readable 侧消费后才能继续转换。
func transformStreamDefaultSinkWriteAlgorithm(h *Host, stream *transformState, chunk goja.Value) goja.Value {
	if !stream.backpressure {
		return transformControllerPerformTransform(h, stream.controller, chunk)
	}

	wait := stream.backpressureChange
	promise, resolve, reject := h.rt.NewPromise()
	awaitResult(h.rt, wait.value(h.rt), func(goja.Value) {
		if stream.writable.status == writableErroring {
			must0(reject(stream.writable.storedError))
			return
		}
		result := transformControllerPerformTransform(h, stream.controller, chunk)
		awaitResult(h.rt, result, func(v goja.Value) { must0(resolve(v)) }, func(r goja.Value) { must0(reject(r)) })
	}, func(reason goja.Value) { must0(reject(reason)) })
	return h.rt.ToValue(promise)
}

// transformControllerPerformTransform 对应 TransformStreamDefaultControllerPerformTransform：转换算法出错时
// 把错误同时灌给整条 TransformStream。
func transformControllerPerformTransform(h *Host, c *transformController, chunk goja.Value) goja.Value {
	var result goja.Value
	settled := func() (ok bool) {
		defer func() {
			if r := recover(); r != nil {
				reason := panicToReason(h.rt, r)
				transformStreamError(h, c.stream, reason)
				result = newRejectedPromise(h.rt, reason)
				ok = true
			}
		}()
		result = c.transformAlgorithm(chunk)
		return true
	}()
	if !settled {
		return newRejectedPromise(h.rt, goja.Undefined())
	}

	promise, resolve, reject := h.rt.NewPromise()
	awaitResult(h.rt, orUndefined(result), func(v goja.Value) {
		must0(resolve(v))
	}, func(reason goja.Value) {
		transformStreamError(h, c.stream, reason)
		must0(reject(reason))
	})
	return h.rt.ToValue(promise)
}

// transformStreamDefaultSinkAbortAlgorithm 对应 TransformStreamDefaultSinkAbortAlgorithm。
func transformStreamDefaultSinkAbortAlgorithm(h *Host, stream *transformState, reason goja.Value) goja.Value {
	c := stream.controller
	if c.finishPromise != nil {
		return c.finishPromise.value(h.rt)
	}
	finish := newDeferred(h.rt)
	c.finishPromise = &finish

	cancel := c.cancelAlgorithm
	var cancelResult goja.Value
	settled := func() (ok bool) {
		defer func() {
			if r := recover(); r != nil {
				cancelResult = newRejectedPromise(h.rt, panicToReason(h.rt, r))
				ok = true
			}
		}()
		if cancel != nil {
			cancelResult = cancel(reason)
		} else {
			cancelResult = newResolvedPromise(h.rt, goja.Undefined())
		}
		return true
	}()
	transformControllerClearAlgorithms(c)
	if !settled {
		return finish.value(h.rt)
	}

	readable := stream.readable
	awaitResult(h.rt, orUndefined(cancelResult), func(goja.Value) {
		if readable.status == statusErrored {
			must0(finish.reject(readable.storedError))
		} else {
			readableControllerError(h, readable.controller, reason)
			must0(finish.resolve(goja.Undefined()))
		}
	}, func(r goja.Value) {
		readableControllerError(h, readable.controller, r)
		must0(finish.reject(r))
	})
	return finish.value(h.rt)
}

// transformStreamDefaultSinkCloseAlgorithm 对应 TransformStreamDefaultSinkCloseAlgorithm。
func transformStreamDefaultSinkCloseAlgorithm(h *Host, stream *transformState) goja.Value {
	c := stream.controller
	if c.finishPromise != nil {
		return c.finishPromise.value(h.rt)
	}
	finish := newDeferred(h.rt)
	c.finishPromise = &finish

	flush := c.flushAlgorithm
	var flushResult goja.Value
	settled := func() (ok bool) {
		defer func() {
			if r := recover(); r != nil {
				flushResult = newRejectedPromise(h.rt, panicToReason(h.rt, r))
				ok = true
			}
		}()
		if flush != nil {
			flushResult = flush()
		} else {
			flushResult = newResolvedPromise(h.rt, goja.Undefined())
		}
		return true
	}()
	transformControllerClearAlgorithms(c)
	if !settled {
		return finish.value(h.rt)
	}

	readable := stream.readable
	awaitResult(h.rt, orUndefined(flushResult), func(goja.Value) {
		if readable.status == statusErrored {
			must0(finish.reject(readable.storedError))
		} else {
			readableControllerClose(h, readable.controller)
			must0(finish.resolve(goja.Undefined()))
		}
	}, func(r goja.Value) {
		readableControllerError(h, readable.controller, r)
		must0(finish.reject(r))
	})
	return finish.value(h.rt)
}

// transformStreamDefaultSourcePullAlgorithm 对应 TransformStreamDefaultSourcePullAlgorithm：解除背压以放行
// 被阻塞的 write()，返回的 Promise 在下一次背压重新建立（或流结束）时兑定。
func transformStreamDefaultSourcePullAlgorithm(stream *transformState) goja.Value {
	transformStreamSetBackpressure(stream, false)
	return stream.backpressureChange.value(stream.host.rt)
}

// transformControllerDesiredSize 对应 controller.desiredSize：转发到 readable 侧 controller。
func transformControllerDesiredSize(c *transformController) (float64, bool) {
	return readableControllerDesiredSize(c.stream.readable.controller)
}

// transformControllerEnqueue 对应 TransformStreamDefaultControllerEnqueue。
func transformControllerEnqueue(h *Host, c *transformController, chunk goja.Value) {
	stream := c.stream
	readableController := stream.readable.controller
	if !readableControllerCanCloseOrEnqueue(readableController) {
		panic(typeErrorf(h.rt, "TransformStream's readable side is not in a state that permits enqueue"))
	}

	settled := func() (ok bool) {
		defer func() {
			if r := recover(); r != nil {
				reason := panicToReason(h.rt, r)
				transformStreamErrorWritableAndUnblockWrite(h, stream, reason)
				panic(reason)
			}
		}()
		readableControllerEnqueue(h, readableController, chunk)
		return true
	}()
	if !settled {
		return
	}

	backpressure := !readableControllerShouldCallPull(readableController)
	if backpressure != stream.backpressure {
		transformStreamSetBackpressure(stream, true)
	}
}

// transformControllerTerminate 对应 TransformStreamDefaultControllerTerminate。
func transformControllerTerminate(h *Host, c *transformController) {
	stream := c.stream
	readableControllerClose(h, stream.readable.controller)
	transformStreamErrorWritableAndUnblockWrite(h, stream, typeErrorf(h.rt, "TransformStream terminated"))
}
