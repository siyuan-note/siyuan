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

// writableStatus 对应规范里流的 [[state]]：writable、erroring、closed 或 errored。
type writableStatus int

const (
	writableWritable writableStatus = iota
	writableErroring
	writableClosed
	writableErrored
)

// writePromiseCapability 是一次 write() 调用或 close 请求对应的 Promise 三元组。
type writePromiseCapability struct {
	resolve func(any) error
	reject  func(any) error
}

func (c *writePromiseCapability) settle(ok bool, value goja.Value) {
	if c == nil {
		return
	}
	var err error
	if ok {
		err = c.resolve(value)
	} else {
		err = c.reject(value)
	}
	if err != nil {
		panic(err)
	}
}

// pendingAbortRequest 对应规范 [[pendingAbortRequest]]。
type pendingAbortRequest struct {
	promise            deferred
	reason             goja.Value
	wasAlreadyErroring bool
}

// writableState 对应 WritableStream 的内部槛。
type writableState struct {
	expandoProperties

	host *Host

	status       writableStatus
	storedError  goja.Value
	backpressure bool

	writer     *writableWriterState
	controller *writableController

	writeRequests        []*writePromiseCapability
	inFlightWriteRequest *writePromiseCapability
	closeRequest         *writePromiseCapability
	inFlightCloseRequest *writePromiseCapability
	pendingAbort         *pendingAbortRequest

	self *goja.Object
}

// writableController 对应 WritableStreamDefaultController 的内部槛。
type writableController struct {
	expandoProperties

	host   *Host
	stream *writableState
	queue  valueQueue

	started     bool
	strategyHWM float64

	sizeAlgorithm  func(chunk goja.Value) float64
	writeAlgorithm func(chunk goja.Value) goja.Value
	closeAlgorithm func() goja.Value
	abortAlgorithm func(reason goja.Value) goja.Value

	self *goja.Object
}

// writableWriterState 对应 WritableStreamDefaultWriter 的内部槛。
type writableWriterState struct {
	expandoProperties

	host   *Host
	stream *writableState
	ready  deferred
	closed deferred

	self *goja.Object
}

var (
	writableStateType      = reflect.TypeOf((*writableState)(nil))
	writableControllerType = reflect.TypeOf((*writableController)(nil))
	writableWriterType     = reflect.TypeOf((*writableWriterState)(nil))
)

func writableStateOf(value goja.Value) (*writableState, bool) {
	object, ok := value.(*goja.Object)
	if !ok || object.ExportType() != writableStateType {
		return nil, false
	}
	state, ok := object.Export().(*writableState)
	return state, ok
}

func writableControllerOf(value goja.Value) (*writableController, bool) {
	object, ok := value.(*goja.Object)
	if !ok || object.ExportType() != writableControllerType {
		return nil, false
	}
	state, ok := object.Export().(*writableController)
	return state, ok
}

func writableWriterOf(value goja.Value) (*writableWriterState, bool) {
	object, ok := value.(*goja.Object)
	if !ok || object.ExportType() != writableWriterType {
		return nil, false
	}
	state, ok := object.Export().(*writableWriterState)
	return state, ok
}

// IsWritableStream 判断 value 是否是本 Host 构造出的 WritableStream 实例。
func (h *Host) IsWritableStream(value goja.Value) bool {
	s, ok := writableStateOf(value)
	return ok && s != nil
}

func isWritableStreamLocked(stream *writableState) bool { return stream.writer != nil }

func writableCloseQueuedOrInFlight(stream *writableState) bool {
	return stream.closeRequest != nil || stream.inFlightCloseRequest != nil
}

func (c *writableController) jsValue() *goja.Object {
	if c.self == nil {
		object := c.host.rt.NewDynamicObject(c)
		must(object.SetPrototype(c.host.writableControllerProto))
		c.self = object
	}
	return c.self
}

func (w *writableWriterState) jsValue() *goja.Object {
	if w.self == nil {
		object := w.host.rt.NewDynamicObject(w)
		must(object.SetPrototype(w.host.writableWriterProto))
		w.self = object
	}
	return w.self
}

func (h *Host) newWritableStreamObject(state *writableState) *goja.Object {
	object := h.rt.NewDynamicObject(state)
	must(object.SetPrototype(h.writableStreamPrototype))
	state.self = object
	return object
}

// writableControllerGetChunkSize 对应 WritableStreamDefaultControllerGetChunkSize：size 算法抛错时按规范吞掉
// 异常、退化为大小 1，让调用方随后按流的当前状态给出恰当的拒绝原因（通常是"流已关闭"这类更贴切的错误），
// 而不是把 size 算法本身的异常（或者流已关闭后 sizeAlgorithm 已被清空导致的调用失败）直接抛给调用方。
func writableControllerGetChunkSize(h *Host, c *writableController, chunk goja.Value) (size float64) {
	defer func() {
		if r := recover(); r != nil {
			writableControllerErrorIfNeeded(h, c, panicToReason(h.rt, r))
			size = 1
		}
	}()
	return c.sizeAlgorithm(chunk)
}

// NewWritableStream 是 Go 侧构造默认 WritableStream 的入口，供 kernel/plugin 的 Go 桥接代码使用。start/write/
// close/abort 对应规范同名算法，均可为 nil（视为未提供）；返回值可以是任意值或一个 Promise（经 awaitResult
// 等待）。sizeAlgorithm 为 nil 时使用默认的"每个 chunk 大小为 1"算法。调用方必须已经在 runtime 所在的事件
// 循环线程上。
func (h *Host) NewWritableStream(start, write func(arg goja.Value) goja.Value, close func() goja.Value,
	abort func(reason goja.Value) goja.Value, highWaterMark float64, sizeAlgorithm func(goja.Value) float64) *goja.Object {
	if sizeAlgorithm == nil {
		sizeAlgorithm = defaultSizeAlgorithm
	}
	stream := &writableState{host: h, status: writableWritable}
	object := h.newWritableStreamObject(stream)
	setUpWritableStreamDefaultController(h, stream, orNoOp(start), orNoOp(write), close, orNoOp(abort), highWaterMark, sizeAlgorithm)
	return object
}

// ──────────────────────────── WritableStreamDefaultController 内部算法 ────────────────────────────

// setUpWritableStreamDefaultController 对应 SetUpWritableStreamDefaultController：本包不暴露 controller.signal
// （规范允许的底层 sink 通过 AbortSignal 感知中止的途径），sink 只能通过 abort 算法的 reason 参数感知中止，
// 是对规范的已知裁剪。
func setUpWritableStreamDefaultController(h *Host, stream *writableState,
	start func(controller goja.Value) goja.Value, write func(chunk goja.Value) goja.Value,
	close func() goja.Value, abort func(reason goja.Value) goja.Value,
	highWaterMark float64, sizeAlgorithm func(goja.Value) float64) {
	controller := &writableController{
		host: h, stream: stream, strategyHWM: highWaterMark, sizeAlgorithm: sizeAlgorithm,
		writeAlgorithm: write, closeAlgorithm: close, abortAlgorithm: abort,
	}
	stream.controller = controller

	backpressure := writableControllerBackpressure(controller)
	writableStreamUpdateBackpressure(stream, backpressure)

	var startResult goja.Value
	settled := func() (ok bool) {
		defer func() {
			if r := recover(); r != nil {
				controller.started = true
				writableStreamDealWithRejection(h, stream, panicToReason(h.rt, r))
				ok = false
			}
		}()
		startResult = start(controller.jsValue())
		return true
	}()
	if !settled {
		return
	}
	awaitResult(h.rt, orUndefined(startResult), func(goja.Value) {
		controller.started = true
		writableControllerAdvanceQueueIfNeeded(h, controller)
	}, func(reason goja.Value) {
		controller.started = true
		writableStreamDealWithRejection(h, stream, reason)
	})
}

func writableControllerDesiredSize(c *writableController) float64 {
	return c.strategyHWM - c.queue.total
}

func writableControllerBackpressure(c *writableController) bool {
	return writableControllerDesiredSize(c) <= 0
}

func writableControllerClearAlgorithms(c *writableController) {
	c.writeAlgorithm = nil
	c.closeAlgorithm = nil
	c.abortAlgorithm = nil
	c.sizeAlgorithm = nil
}

// writableControllerErrorIfNeeded 对应 WritableStreamDefaultControllerErrorIfNeeded。
func writableControllerErrorIfNeeded(h *Host, c *writableController, reason goja.Value) {
	if c.stream.status == writableWritable {
		writableControllerError(h, c, reason)
	}
}

// writableControllerError 对应 WritableStreamDefaultControllerError。
func writableControllerError(h *Host, c *writableController, reason goja.Value) {
	writableControllerClearAlgorithms(c)
	writableStreamStartErroring(h, c.stream, reason)
}

// writableControllerWrite 对应 WritableStreamDefaultControllerWrite。
func writableControllerWrite(h *Host, c *writableController, chunk goja.Value, size float64) {
	c.queue.enqueue(chunk, size)
	stream := c.stream
	if !writableCloseQueuedOrInFlight(stream) && stream.status == writableWritable {
		writableStreamUpdateBackpressure(stream, writableControllerBackpressure(c))
	}
	writableControllerAdvanceQueueIfNeeded(h, c)
}

// writableControllerClose 对应 WritableStreamDefaultControllerClose：入队关闭哨兵，与常规写入保持顺序。
func writableControllerClose(h *Host, c *writableController) {
	c.queue.enqueueClose()
	writableControllerAdvanceQueueIfNeeded(h, c)
}

// writableControllerAdvanceQueueIfNeeded 对应 WritableStreamDefaultControllerAdvanceQueueIfNeeded。
func writableControllerAdvanceQueueIfNeeded(h *Host, c *writableController) {
	stream := c.stream
	if !c.started || stream.inFlightWriteRequest != nil {
		return
	}
	if stream.status == writableErroring {
		writableStreamFinishErroring(h, stream)
		return
	}
	if c.queue.len() == 0 {
		return
	}
	if c.queue.peekIsClose() {
		writableControllerProcessClose(h, c)
	} else {
		writableControllerProcessWrite(h, c, c.queue.peek())
	}
}

// writableControllerProcessWrite 对应 WritableStreamDefaultControllerProcessWrite。
func writableControllerProcessWrite(h *Host, c *writableController, chunk goja.Value) {
	stream := c.stream
	stream.inFlightWriteRequest = stream.writeRequests[0]
	stream.writeRequests = stream.writeRequests[1:]

	var result goja.Value
	settled := func() (ok bool) {
		defer func() {
			if r := recover(); r != nil {
				result = newRejectedPromise(h.rt, panicToReason(h.rt, r))
				ok = true
			}
		}()
		result = c.writeAlgorithm(chunk)
		return true
	}()
	if !settled {
		return
	}

	awaitResult(h.rt, orUndefined(result), func(goja.Value) {
		writableStreamFinishInFlightWrite(stream)
		c.queue.dequeue()
		if !writableCloseQueuedOrInFlight(stream) && stream.status == writableWritable {
			writableStreamUpdateBackpressure(stream, writableControllerBackpressure(c))
		}
		writableControllerAdvanceQueueIfNeeded(h, c)
	}, func(reason goja.Value) {
		if stream.status == writableWritable {
			writableControllerClearAlgorithms(c)
		}
		writableStreamFinishInFlightWriteWithError(h, stream, reason)
	})
}

// writableControllerProcessClose 对应 WritableStreamDefaultControllerProcessClose。
func writableControllerProcessClose(h *Host, c *writableController) {
	stream := c.stream
	stream.inFlightCloseRequest = stream.closeRequest
	stream.closeRequest = nil
	c.queue.dequeue()

	var result goja.Value
	settled := func() (ok bool) {
		defer func() {
			if r := recover(); r != nil {
				result = newRejectedPromise(h.rt, panicToReason(h.rt, r))
				ok = true
			}
		}()
		if c.closeAlgorithm != nil {
			result = c.closeAlgorithm()
		} else {
			result = newResolvedPromise(h.rt, goja.Undefined())
		}
		return true
	}()
	writableControllerClearAlgorithms(c)
	if !settled {
		return
	}

	awaitResult(h.rt, orUndefined(result), func(goja.Value) {
		writableStreamFinishInFlightClose(h, stream)
	}, func(reason goja.Value) {
		writableStreamFinishInFlightCloseWithError(h, stream, reason)
	})
}

// ──────────────────────────── WritableStream 内部算法 ────────────────────────────

// writableStreamUpdateBackpressure 对应 WritableStreamUpdateBackpressure：backpressure 发生变化时相应地
// 重置或兑定 writer 的 ready Promise。
func writableStreamUpdateBackpressure(stream *writableState, backpressure bool) {
	if writer := stream.writer; writer != nil && backpressure != stream.backpressure {
		if backpressure {
			writer.ready = newDeferred(writer.host.rt)
		} else {
			must0(writer.ready.resolve(goja.Undefined()))
		}
	}
	stream.backpressure = backpressure
}

// writableStreamFinishInFlightWrite 对应 WritableStreamFinishInFlightWrite。
func writableStreamFinishInFlightWrite(stream *writableState) {
	stream.inFlightWriteRequest.settle(true, goja.Undefined())
	stream.inFlightWriteRequest = nil
}

// writableStreamFinishInFlightWriteWithError 对应 WritableStreamFinishInFlightWriteWithError。
func writableStreamFinishInFlightWriteWithError(h *Host, stream *writableState, reason goja.Value) {
	stream.inFlightWriteRequest.settle(false, reason)
	stream.inFlightWriteRequest = nil
	writableStreamDealWithRejection(h, stream, reason)
}

// writableStreamFinishInFlightClose 对应 WritableStreamFinishInFlightClose。
func writableStreamFinishInFlightClose(h *Host, stream *writableState) {
	stream.inFlightCloseRequest.settle(true, goja.Undefined())
	stream.inFlightCloseRequest = nil

	if stream.status == writableErroring {
		stream.storedError = nil
		if stream.pendingAbort != nil {
			must0(stream.pendingAbort.promise.resolve(goja.Undefined()))
			stream.pendingAbort = nil
		}
	}
	stream.status = writableClosed
	if writer := stream.writer; writer != nil {
		must0(writer.closed.resolve(goja.Undefined()))
	}
}

// writableStreamFinishInFlightCloseWithError 对应 WritableStreamFinishInFlightCloseWithError。
func writableStreamFinishInFlightCloseWithError(h *Host, stream *writableState, reason goja.Value) {
	stream.inFlightCloseRequest.settle(false, reason)
	stream.inFlightCloseRequest = nil
	if stream.pendingAbort != nil {
		must0(stream.pendingAbort.promise.reject(reason))
		stream.pendingAbort = nil
	}
	writableStreamDealWithRejection(h, stream, reason)
}

// writableStreamDealWithRejection 对应 WritableStreamDealWithRejection。
func writableStreamDealWithRejection(h *Host, stream *writableState, reason goja.Value) {
	if stream.status == writableWritable {
		writableStreamStartErroring(h, stream, reason)
		return
	}
	writableStreamFinishErroring(h, stream)
}

// writableStreamStartErroring 对应 WritableStreamStartErroring。
func writableStreamStartErroring(h *Host, stream *writableState, reason goja.Value) {
	controller := stream.controller
	stream.status = writableErroring
	stream.storedError = reason
	if writer := stream.writer; writer != nil {
		writableWriterEnsureReadyPromiseRejected(writer, reason)
	}
	if !writableStreamHasOperationMarkedInFlight(stream) && controller.started {
		writableStreamFinishErroring(h, stream)
	}
}

// writableStreamHasOperationMarkedInFlight 对应 WritableStreamHasOperationMarkedInFlight。
func writableStreamHasOperationMarkedInFlight(stream *writableState) bool {
	return stream.inFlightWriteRequest != nil || stream.inFlightCloseRequest != nil
}

// writableStreamFinishErroring 对应 WritableStreamFinishErroring。
func writableStreamFinishErroring(h *Host, stream *writableState) {
	stream.status = writableErrored
	stream.controller.queue.reset() // [[ErrorSteps]]：清空队列
	storedError := stream.storedError
	for _, request := range stream.writeRequests {
		request.settle(false, storedError)
	}
	stream.writeRequests = nil

	if stream.pendingAbort == nil {
		writableStreamRejectCloseAndClosedPromiseIfNeeded(stream)
		return
	}
	abortRequest := stream.pendingAbort
	stream.pendingAbort = nil
	if abortRequest.wasAlreadyErroring {
		must0(abortRequest.promise.reject(storedError))
		writableStreamRejectCloseAndClosedPromiseIfNeeded(stream)
		return
	}

	controller := stream.controller
	abortAlgorithm := controller.abortAlgorithm
	controller.writeAlgorithm, controller.closeAlgorithm, controller.sizeAlgorithm = nil, nil, nil
	var result goja.Value
	settled := func() (ok bool) {
		defer func() {
			if r := recover(); r != nil {
				result = newRejectedPromise(h.rt, panicToReason(h.rt, r))
				ok = true
			}
		}()
		if abortAlgorithm != nil {
			result = abortAlgorithm(abortRequest.reason)
		} else {
			result = newResolvedPromise(h.rt, goja.Undefined())
		}
		return true
	}()
	controller.abortAlgorithm = nil
	if !settled {
		return
	}

	awaitResult(h.rt, orUndefined(result), func(goja.Value) {
		must0(abortRequest.promise.resolve(goja.Undefined()))
		writableStreamRejectCloseAndClosedPromiseIfNeeded(stream)
	}, func(reason goja.Value) {
		must0(abortRequest.promise.reject(reason))
		writableStreamRejectCloseAndClosedPromiseIfNeeded(stream)
	})
}

// writableStreamRejectCloseAndClosedPromiseIfNeeded 对应 WritableStreamRejectCloseAndClosedPromiseIfNeeded。
func writableStreamRejectCloseAndClosedPromiseIfNeeded(stream *writableState) {
	if stream.closeRequest != nil {
		stream.closeRequest.settle(false, stream.storedError)
		stream.closeRequest = nil
	}
	if writer := stream.writer; writer != nil {
		must0(writer.closed.reject(stream.storedError))
	}
}

// writableStreamAbort 对应 WritableStreamAbort。
func writableStreamAbort(h *Host, stream *writableState, reason goja.Value) goja.Value {
	if stream.status == writableClosed || stream.status == writableErrored {
		return newResolvedPromise(h.rt, goja.Undefined())
	}
	if stream.pendingAbort != nil {
		return stream.pendingAbort.promise.value(h.rt)
	}
	wasAlreadyErroring := stream.status == writableErroring
	if wasAlreadyErroring {
		reason = nil
	}
	request := &pendingAbortRequest{promise: newDeferred(h.rt), reason: reason, wasAlreadyErroring: wasAlreadyErroring}
	stream.pendingAbort = request
	if !wasAlreadyErroring {
		writableStreamStartErroring(h, stream, reason)
	}
	return request.promise.value(h.rt)
}

// writableStreamClose 对应 WritableStreamClose。
func writableStreamClose(h *Host, stream *writableState) goja.Value {
	if stream.status == writableClosed || stream.status == writableErrored {
		return newRejectedPromise(h.rt, typeErrorf(h.rt, "Cannot close an already-closed stream"))
	}
	capability := &writePromiseCapability{}
	promise, resolve, reject := h.rt.NewPromise()
	capability.resolve, capability.reject = resolve, reject
	stream.closeRequest = capability

	if writer := stream.writer; writer != nil && stream.backpressure && stream.status == writableWritable {
		must0(writer.ready.resolve(goja.Undefined()))
	}
	writableControllerClose(h, stream.controller)
	return h.rt.ToValue(promise)
}

// ──────────────────────────── WritableStreamDefaultWriter 内部算法 ────────────────────────────

// acquireWritableStreamDefaultWriter 对应 AcquireWritableStreamDefaultWriter + SetUpWritableStreamDefaultWriter：
// 流已被锁定时抛出 TypeError。
func acquireWritableStreamDefaultWriter(h *Host, stream *writableState) *writableWriterState {
	if isWritableStreamLocked(stream) {
		panic(typeErrorf(h.rt, "WritableStreamDefaultWriter constructor can only accept writable streams that are not yet locked to a writer"))
	}
	writer := &writableWriterState{host: h, stream: stream}
	stream.writer = writer

	switch stream.status {
	case writableWritable:
		if !writableCloseQueuedOrInFlight(stream) && stream.backpressure {
			writer.ready = newDeferred(h.rt)
		} else {
			writer.ready = newDeferred(h.rt)
			must0(writer.ready.resolve(goja.Undefined()))
		}
		writer.closed = newDeferred(h.rt)
	case writableErroring:
		writer.ready = newDeferred(h.rt)
		must0(writer.ready.reject(stream.storedError))
		writer.closed = newDeferred(h.rt)
	case writableClosed:
		writer.ready = newDeferred(h.rt)
		must0(writer.ready.resolve(goja.Undefined()))
		writer.closed = newDeferred(h.rt)
		must0(writer.closed.resolve(goja.Undefined()))
	default: // writableErrored
		writer.ready = newDeferred(h.rt)
		must0(writer.ready.reject(stream.storedError))
		writer.closed = newDeferred(h.rt)
		must0(writer.closed.reject(stream.storedError))
	}
	return writer
}

// writableWriterEnsureReadyPromiseRejected 对应 WritableStreamDefaultWriterEnsureReadyPromiseRejected。
func writableWriterEnsureReadyPromiseRejected(writer *writableWriterState, reason goja.Value) {
	if writer.ready.isPending() {
		must0(writer.ready.reject(reason))
	} else {
		writer.ready = newDeferred(writer.host.rt)
		must0(writer.ready.reject(reason))
	}
}

// writableWriterEnsureClosedPromiseRejected 对应 WritableStreamDefaultWriterEnsureClosedPromiseRejected。
func writableWriterEnsureClosedPromiseRejected(writer *writableWriterState, reason goja.Value) {
	if writer.closed.isPending() {
		must0(writer.closed.reject(reason))
	} else {
		writer.closed = newDeferred(writer.host.rt)
		must0(writer.closed.reject(reason))
	}
}

// writableWriterDesiredSize 返回 writer 的 desiredSize：writer 已释放时 panic TypeError；流已出错/正在出错时
// 为 null；已关闭时为 0。
func writableWriterDesiredSize(h *Host, writer *writableWriterState) goja.Value {
	if writer.stream == nil {
		panic(writerReleasedError(h.rt))
	}
	switch writer.stream.status {
	case writableErroring, writableErrored:
		return goja.Null()
	case writableClosed:
		return h.rt.ToValue(0)
	default:
		return h.rt.ToValue(writableControllerDesiredSize(writer.stream.controller))
	}
}

func writerReleasedError(rt *goja.Runtime) goja.Value {
	return typeErrorf(rt, "Writer was released and can no longer be used to monitor the stream's closedness")
}

// writableWriterWrite 对应 WritableStreamDefaultWriterWrite。
func writableWriterWrite(h *Host, writer *writableWriterState, chunk goja.Value) goja.Value {
	stream := writer.stream
	controller := stream.controller
	size := writableControllerGetChunkSize(h, controller, chunk)

	switch stream.status {
	case writableErrored:
		return newRejectedPromise(h.rt, stream.storedError)
	case writableErroring:
		return newRejectedPromise(h.rt, stream.storedError)
	}
	if writableCloseQueuedOrInFlight(stream) || stream.status == writableClosed {
		return newRejectedPromise(h.rt, typeErrorf(h.rt, "The stream is closing or closed and cannot be written to"))
	}

	promise, resolve, reject := h.rt.NewPromise()
	stream.writeRequests = append(stream.writeRequests, &writePromiseCapability{resolve: resolve, reject: reject})
	writableControllerWrite(h, controller, chunk, size)
	return h.rt.ToValue(promise)
}

// writableWriterClose 对应 WritableStreamDefaultWriterClose。
func writableWriterClose(h *Host, writer *writableWriterState) goja.Value {
	stream := writer.stream
	if stream == nil {
		return newRejectedPromise(h.rt, writerReleasedError(h.rt))
	}
	if writableCloseQueuedOrInFlight(stream) {
		return newRejectedPromise(h.rt, typeErrorf(h.rt, "Cannot close an already-closing stream"))
	}
	return writableStreamClose(h, stream)
}

// writableWriterAbort 对应 WritableStreamDefaultWriterAbort。
func writableWriterAbort(h *Host, writer *writableWriterState, reason goja.Value) goja.Value {
	if writer.stream == nil {
		return newRejectedPromise(h.rt, writerReleasedError(h.rt))
	}
	return writableStreamAbort(h, writer.stream, reason)
}

// writableWriterRelease 对应 WritableStreamDefaultWriterRelease。
func writableWriterRelease(writer *writableWriterState) {
	stream := writer.stream
	if stream == nil {
		return
	}
	released := writerReleasedError(writer.host.rt)
	writableWriterEnsureReadyPromiseRejected(writer, released)
	writableWriterEnsureClosedPromiseRejected(writer, released)
	stream.writer = nil
	writer.stream = nil
}
