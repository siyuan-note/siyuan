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
	"fmt"
	"reflect"

	"github.com/dop251/goja"
)

// streamStatus 对应规范里流的 [[state]]：readable、closed 或 errored 三态（不含字节流特有的中间态）。
type streamStatus int

const (
	statusReadable streamStatus = iota
	statusClosed
	statusErrored
)

// readableState 对应 ReadableStream 的内部槛，只实现默认（非字节流）controller。
type readableState struct {
	expandoProperties

	host *Host

	status      streamStatus
	storedError goja.Value
	disturbed   bool

	reader     *readableReaderState // 非 nil 表示已被某个 reader 锁定
	controller *readableController

	self *goja.Object
}

// readableController 对应 ReadableStreamDefaultController 的内部槛。
type readableController struct {
	expandoProperties

	host   *Host
	stream *readableState
	queue  valueQueue

	started        bool
	closeRequested bool
	pullAgain      bool
	pulling        bool
	strategyHWM    float64

	sizeAlgorithm   func(chunk goja.Value) float64
	pullAlgorithm   func(controller goja.Value) goja.Value
	cancelAlgorithm func(reason goja.Value) goja.Value

	self *goja.Object
}

// readableReaderState 对应 ReadableStreamDefaultReader 的内部槛。
type readableReaderState struct {
	expandoProperties

	host         *Host
	stream       *readableState
	readRequests []readRequest
	closed       deferred

	self *goja.Object
}

// readRequest 对应规范 Read Request 记录：chunkSteps 对应 resolve，closeSteps/errorSteps 都通过 resolve/reject
// 一个 {value, done} 结构或直接 reject 来表达，分别在 resolveReadResult/reject 调用处体现。
type readRequest struct {
	resolve func(any) error
	reject  func(any) error
}

var (
	readableStateType      = reflect.TypeOf((*readableState)(nil))
	readableControllerType = reflect.TypeOf((*readableController)(nil))
	readableReaderType     = reflect.TypeOf((*readableReaderState)(nil))
)

// readableStateOf 取出 ReadableStream 的内部状态，只接受本包创建的对象。
func readableStateOf(value goja.Value) (*readableState, bool) {
	object, ok := value.(*goja.Object)
	if !ok || object.ExportType() != readableStateType {
		return nil, false
	}
	state, ok := object.Export().(*readableState)
	return state, ok
}

// readableReaderOf 取出 ReadableStreamDefaultReader 的内部状态，只接受本包创建的对象。
func readableReaderOf(value goja.Value) (*readableReaderState, bool) {
	object, ok := value.(*goja.Object)
	if !ok || object.ExportType() != readableReaderType {
		return nil, false
	}
	state, ok := object.Export().(*readableReaderState)
	return state, ok
}

// readableControllerOf 取出 ReadableStreamDefaultController 的内部状态，只接受本包创建的对象。
func readableControllerOf(value goja.Value) (*readableController, bool) {
	object, ok := value.(*goja.Object)
	if !ok || object.ExportType() != readableControllerType {
		return nil, false
	}
	state, ok := object.Export().(*readableController)
	return state, ok
}

// IsReadableStream 判断 value 是否是本 Host 构造出的 ReadableStream 实例。
func (h *Host) IsReadableStream(value goja.Value) bool {
	s, ok := readableStateOf(value)
	return ok && s != nil
}

// jsValue 返回 controller 对应的脚本可见对象，首次调用时创建并缓存。
func (c *readableController) jsValue() *goja.Object {
	if c.self == nil {
		object := c.host.rt.NewDynamicObject(c)
		must(object.SetPrototype(c.host.readableControllerProto))
		c.self = object
	}
	return c.self
}

// streamError 构造一个供内部状态使用的普通 Error（本沙箱不提供 DOMException，与既有实现一致，用普通 Error
// 覆盖 name 表达特定错误类型）。
func streamError(rt *goja.Runtime, name, message string) goja.Value {
	err := rt.NewTypeError(message)
	if name != "" && name != "TypeError" {
		must(err.Set("name", rt.ToValue(name)))
	}
	return err
}

func typeErrorf(rt *goja.Runtime, format string, args ...any) goja.Value {
	return rt.NewTypeError(fmt.Sprintf(format, args...))
}

// panicToReason 把 recover() 得到的值转换为可用作 reject reason 的 goja.Value：goja 异常原样传递，其余错误
// 包装为新的 Error，否则按字符串兜底，避免二次 panic 掩盖原始错误路径。
func panicToReason(rt *goja.Runtime, r any) (reason goja.Value) {
	if v, ok := r.(goja.Value); ok {
		return v
	}
	if err, ok := r.(error); ok {
		if ex, ok := err.(*goja.Exception); ok {
			return ex.Value()
		}
		return rt.NewGoError(err)
	}
	defer func() {
		if recover() != nil {
			reason = goja.Undefined()
		}
	}()
	return rt.ToValue(fmt.Sprint(r))
}

// ──────────────────────────── ReadableStreamDefaultController 内部算法 ────────────────────────────

// setUpReadableStreamDefaultController 对应规范 SetUpReadableStreamDefaultController：构造并挂载 controller，
// 调用 start 算法，并在其完成/出错后据此调用一次 pull-if-needed 或把流置为出错状态。
func setUpReadableStreamDefaultController(h *Host, stream *readableState,
	start, pull, cancel func(controller goja.Value) goja.Value, highWaterMark float64, sizeAlgorithm func(goja.Value) float64) {
	controller := &readableController{
		host:            h,
		stream:          stream,
		strategyHWM:     highWaterMark,
		sizeAlgorithm:   sizeAlgorithm,
		pullAlgorithm:   pull,
		cancelAlgorithm: cancel,
	}
	stream.controller = controller

	var startResult goja.Value
	settled := func() (ok bool) {
		defer func() {
			if r := recover(); r != nil {
				readableControllerError(h, controller, panicToReason(h.rt, r))
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
		readableControllerCallPullIfNeeded(h, controller)
	}, func(reason goja.Value) {
		readableControllerError(h, controller, reason)
	})
}

// readableControllerCanCloseOrEnqueue 对应 ReadableStreamDefaultControllerCanCloseOrEnqueue。
func readableControllerCanCloseOrEnqueue(c *readableController) bool {
	return !c.closeRequested && c.stream.status == statusReadable
}

// readableControllerDesiredSize 对应 ReadableStreamDefaultControllerGetDesiredSize；流出错时返回 ok=false。
func readableControllerDesiredSize(c *readableController) (size float64, ok bool) {
	switch c.stream.status {
	case statusErrored:
		return 0, false
	case statusClosed:
		return 0, true
	default:
		return c.strategyHWM - c.queue.total, true
	}
}

// readableControllerShouldCallPull 对应 ReadableStreamDefaultControllerShouldCallPull。
func readableControllerShouldCallPull(c *readableController) bool {
	if !readableControllerCanCloseOrEnqueue(c) {
		return false
	}
	if !c.started {
		return false
	}
	if c.stream.reader != nil && len(c.stream.reader.readRequests) > 0 {
		return true
	}
	desiredSize, ok := readableControllerDesiredSize(c)
	return ok && desiredSize > 0
}

// readableControllerCallPullIfNeeded 对应 ReadableStreamDefaultControllerCallPullIfNeeded。
func readableControllerCallPullIfNeeded(h *Host, c *readableController) {
	if !readableControllerShouldCallPull(c) {
		return
	}
	if c.pulling {
		c.pullAgain = true
		return
	}
	c.pulling = true

	var pullResult goja.Value
	settled := func() (ok bool) {
		defer func() {
			if r := recover(); r != nil {
				readableControllerError(h, c, panicToReason(h.rt, r))
				ok = false
			}
		}()
		pullResult = c.pullAlgorithm(c.jsValue())
		return true
	}()
	if !settled {
		return
	}

	awaitResult(h.rt, orUndefined(pullResult), func(goja.Value) {
		c.pulling = false
		if c.pullAgain {
			c.pullAgain = false
			readableControllerCallPullIfNeeded(h, c)
		}
	}, func(reason goja.Value) {
		readableControllerError(h, c, reason)
	})
}

// readableControllerClearAlgorithms 对应 ReadableStreamDefaultControllerClearAlgorithms：置空算法引用，
// 避免结束后仍持有闭包。
func readableControllerClearAlgorithms(c *readableController) {
	c.pullAlgorithm = nil
	c.cancelAlgorithm = nil
	c.sizeAlgorithm = nil
}

// readableControllerClose 对应 ReadableStreamDefaultControllerClose。
func readableControllerClose(h *Host, c *readableController) {
	if !readableControllerCanCloseOrEnqueue(c) {
		return
	}
	stream := c.stream
	c.closeRequested = true
	if c.queue.len() == 0 {
		readableControllerClearAlgorithms(c)
		readableStreamClose(h, stream)
	}
}

// readableControllerEnqueue 对应 ReadableStreamDefaultControllerEnqueue。
func readableControllerEnqueue(h *Host, c *readableController, chunk goja.Value) {
	if !readableControllerCanCloseOrEnqueue(c) {
		return
	}
	stream := c.stream
	if stream.reader != nil && len(stream.reader.readRequests) > 0 {
		readableStreamFulfillReadRequest(h, stream, chunk, false)
	} else {
		var size float64
		ok := func() (ok bool) {
			defer func() {
				if r := recover(); r != nil {
					readableControllerError(h, c, panicToReason(h.rt, r))
					panic(r) // 按规范，size 算法抛出的异常同时要向调用 enqueue() 的脚本重新抛出
				}
			}()
			size = c.sizeAlgorithm(chunk)
			return true
		}()
		if !ok {
			return
		}
		c.queue.enqueue(chunk, size)
	}
	readableControllerCallPullIfNeeded(h, c)
}

// readableControllerError 对应 ReadableStreamDefaultControllerError。
func readableControllerError(h *Host, c *readableController, reason goja.Value) {
	stream := c.stream
	if stream.status != statusReadable {
		return
	}
	c.queue.reset()
	readableControllerClearAlgorithms(c)
	readableStreamError(h, stream, reason)
}

// readableControllerCancelSteps 对应 [[CancelSteps]]。
func readableControllerCancelSteps(h *Host, c *readableController, reason goja.Value) goja.Value {
	c.queue.reset()
	cancel := c.cancelAlgorithm
	var result goja.Value
	func() {
		defer func() {
			if r := recover(); r != nil {
				result = newRejectedPromise(h.rt, panicToReason(h.rt, r))
			}
		}()
		if cancel != nil {
			result = cancel(reason)
		} else {
			result = newResolvedPromise(h.rt, goja.Undefined())
		}
	}()
	readableControllerClearAlgorithms(c)
	return result
}

// readableControllerPullSteps 对应 [[PullSteps]]：队列有数据直接满足请求，否则登记等待并尝试拉取更多数据。
func readableControllerPullSteps(h *Host, c *readableController, request readRequest) {
	stream := c.stream
	if c.queue.len() > 0 {
		chunk := c.queue.dequeue()
		if c.closeRequested && c.queue.len() == 0 {
			readableControllerClearAlgorithms(c)
			readableStreamClose(h, stream)
		} else {
			readableControllerCallPullIfNeeded(h, c)
		}
		resolveReadResult(h.rt, request, chunk, false)
		return
	}
	stream.reader.readRequests = append(stream.reader.readRequests, request)
	readableControllerCallPullIfNeeded(h, c)
}

// resolveReadResult 用 {value, done} 兑定一次 read() 请求。
func resolveReadResult(rt *goja.Runtime, request readRequest, value goja.Value, done bool) {
	result := rt.NewObject()
	if value == nil {
		value = goja.Undefined()
	}
	must(result.Set("value", value))
	must(result.Set("done", rt.ToValue(done)))
	if err := request.resolve(result); err != nil {
		panic(err)
	}
}

// ──────────────────────────── ReadableStream 内部算法 ────────────────────────────

// readableStreamClose 对应 ReadableStreamClose：置为 closed，兑定 reader 的 closed Promise，并把所有挂起的
// read() 请求以 {value: undefined, done: true} 兑定。
func readableStreamClose(h *Host, stream *readableState) {
	stream.status = statusClosed
	reader := stream.reader
	if reader == nil {
		return
	}
	if err := reader.closed.resolve(goja.Undefined()); err != nil {
		panic(err)
	}
	for _, request := range reader.readRequests {
		resolveReadResult(h.rt, request, goja.Undefined(), true)
	}
	reader.readRequests = nil
}

// readableStreamError 对应 ReadableStreamError：置为 errored，拒绝 reader 的 closed Promise，并以同一 reason
// 拒绝所有挂起的 read() 请求。
func readableStreamError(h *Host, stream *readableState, reason goja.Value) {
	stream.status = statusErrored
	stream.storedError = reason
	reader := stream.reader
	if reader == nil {
		return
	}
	if err := reader.closed.reject(reason); err != nil {
		panic(err)
	}
	for _, request := range reader.readRequests {
		if err := request.reject(reason); err != nil {
			panic(err)
		}
	}
	reader.readRequests = nil
}

// readableStreamFulfillReadRequest 对应 ReadableStreamFulfillReadRequest：取出最早挂起的 read() 请求并兑定。
func readableStreamFulfillReadRequest(h *Host, stream *readableState, chunk goja.Value, done bool) {
	reader := stream.reader
	request := reader.readRequests[0]
	reader.readRequests = reader.readRequests[1:]
	resolveReadResult(h.rt, request, chunk, done)
}

// readableStreamDefaultReaderRead 对应 ReadableStreamDefaultReaderRead：标记已扰动，流已关闭/出错时直接按
// {done: true}/拒绝原因兑定 request，否则才委派给 controller 的 [[PullSteps]]。所有驱动读取的代码路径
// （reader.read()、pipeTo 的拉取循环、tee 的共享拉取、异步迭代器的 next()）都必须经过这个函数，不能直接调用
// readableControllerPullSteps：一旦跳过这个短路检查，流关闭后队列已空时的读取请求会被当成"等待更多数据"
// 一直挂起，永远不会被满足。
func readableStreamDefaultReaderRead(h *Host, reader *readableReaderState, request readRequest) {
	stream := reader.stream
	stream.disturbed = true
	switch stream.status {
	case statusClosed:
		resolveReadResult(h.rt, request, goja.Undefined(), true)
	case statusErrored:
		if err := request.reject(stream.storedError); err != nil {
			panic(err)
		}
	default:
		readableControllerPullSteps(h, stream.controller, request)
	}
}

// readableStreamCancel 对应 ReadableStreamCancel：标记已扰动、按当前状态短路，否则关闭流并调用 controller 的
// 取消算法；返回的 Promise 的拒绝原样传播，兑定值统一替换为 undefined。
func readableStreamCancel(h *Host, stream *readableState, reason goja.Value) goja.Value {
	stream.disturbed = true
	switch stream.status {
	case statusClosed:
		return newResolvedPromise(h.rt, goja.Undefined())
	case statusErrored:
		return newRejectedPromise(h.rt, stream.storedError)
	}
	readableStreamClose(h, stream)

	sourceCancelResult := readableControllerCancelSteps(h, stream.controller, reason)
	result, resolve, reject := h.rt.NewPromise()
	awaitResult(h.rt, sourceCancelResult, func(goja.Value) {
		if err := resolve(goja.Undefined()); err != nil {
			panic(err)
		}
	}, func(innerReason goja.Value) {
		if err := reject(innerReason); err != nil {
			panic(err)
		}
	})
	return h.rt.ToValue(result)
}

// ──────────────────────────── ReadableStreamDefaultReader 内部算法 ────────────────────────────

// isReadableStreamLocked 对应 IsReadableStreamLocked。
func isReadableStreamLocked(stream *readableState) bool { return stream.reader != nil }

// acquireReadableStreamDefaultReader 对应 AcquireReadableStreamDefaultReader + SetUpReadableStreamDefaultReader：
// 流已被锁定时抛出 TypeError。
func acquireReadableStreamDefaultReader(h *Host, stream *readableState) *readableReaderState {
	if isReadableStreamLocked(stream) {
		panic(typeErrorf(h.rt, "ReadableStreamDefaultReader constructor can only accept readable streams that are not yet locked to a reader"))
	}
	reader := &readableReaderState{host: h, stream: stream}
	readableStreamReaderGenericInitialize(h, reader, stream)
	return reader
}

// readableStreamReaderGenericInitialize 对应 ReadableStreamReaderGenericInitialize。
func readableStreamReaderGenericInitialize(h *Host, reader *readableReaderState, stream *readableState) {
	reader.stream = stream
	stream.reader = reader
	switch stream.status {
	case statusReadable:
		reader.closed = newDeferred(h.rt)
	case statusClosed:
		reader.closed = newDeferred(h.rt)
		must0(reader.closed.resolve(goja.Undefined()))
	default:
		reader.closed = newDeferred(h.rt)
		must0(reader.closed.reject(stream.storedError))
	}
}

// readableStreamReaderGenericRelease 对应 ReadableStreamReaderGenericRelease：解除锁定，并把 closed Promise
// 替换为一个新的、已拒绝的 Promise（流仍 readable 时拒绝原有的，否则直接换新的），均用 TypeError 表达
// "锁已释放"。
func readableStreamReaderGenericRelease(h *Host, reader *readableReaderState) {
	stream := reader.stream
	releaseErr := typeErrorf(h.rt, "Reader was released")
	if stream.status == statusReadable {
		must0(reader.closed.reject(releaseErr))
	} else {
		reader.closed = newDeferred(h.rt)
		must0(reader.closed.reject(releaseErr))
	}
	stream.reader = nil
	reader.stream = nil
}

// readableStreamDefaultReaderErrorReadRequests 对应 ReadableStreamDefaultReaderErrorReadRequests。
func readableStreamDefaultReaderErrorReadRequests(reader *readableReaderState, reason goja.Value) {
	for _, request := range reader.readRequests {
		if err := request.reject(reason); err != nil {
			panic(err)
		}
	}
	reader.readRequests = nil
}

// must0 丢弃返回值地调用 must，便于在表达式语境中复用。
func must0(err error) { must(err) }

// jsValue 返回 reader 对应的脚本可见对象，首次调用时创建并缓存。
func (reader *readableReaderState) jsValue() *goja.Object {
	if reader.self == nil {
		object := reader.host.rt.NewDynamicObject(reader)
		must(object.SetPrototype(reader.host.readableReaderProto))
		reader.self = object
	}
	return reader.self
}

// newReadableStreamObject 创建包装 state 的 ReadableStream 对象并绑定到共享原型。
func (h *Host) newReadableStreamObject(state *readableState) *goja.Object {
	object := h.rt.NewDynamicObject(state)
	must(object.SetPrototype(h.readableStreamPrototype))
	state.self = object
	return object
}

// NewReadableStream 是 Go 侧构造默认（非字节流）ReadableStream 的入口，供 kernel/plugin 的 Go 桥接代码使用
// （如把 fetch 的响应体包装为流）。start/pull/cancel 对应规范同名算法，均可为 nil（视为未提供）；返回值可以
// 是任意值或一个 Promise（经 awaitResult 等待），仅用其 settle 状态驱动 controller 的内部状态机，不作为
// 流本身的数据。sizeAlgorithm 为 nil 时使用默认的"每个 chunk 大小为 1"算法。调用方必须已经在 runtime 所在
// 的事件循环线程上。
func (h *Host) NewReadableStream(start, pull, cancel func(controller goja.Value) goja.Value, highWaterMark float64,
	sizeAlgorithm func(goja.Value) float64) *goja.Object {
	if sizeAlgorithm == nil {
		sizeAlgorithm = defaultSizeAlgorithm
	}
	stream := &readableState{host: h, status: statusReadable}
	object := h.newReadableStreamObject(stream)
	setUpReadableStreamDefaultController(h, stream, orNoOp(start), orNoOp(pull), orNoOp(cancel), highWaterMark, sizeAlgorithm)
	return object
}

// orNoOp 把可能为 nil 的算法函数替换为返回 undefined 的空操作，匹配规范里"算法未提供"时的默认行为：该返回值会被
// awaitResult 当作已经就绪的普通值处理，同步进入 onFulfilled 分支，驱动状态机继续往前走。
func orNoOp(fn func(goja.Value) goja.Value) func(goja.Value) goja.Value {
	if fn != nil {
		return fn
	}
	return func(goja.Value) goja.Value { return goja.Undefined() }
}

// orUndefined 把 nil 规范化为 goja.Undefined()，防止算法实现疏漏返回值时 awaitResult 收到裸 nil。
func orUndefined(v goja.Value) goja.Value {
	if v == nil {
		return goja.Undefined()
	}
	return v
}

func defaultSizeAlgorithm(goja.Value) float64 { return 1 }
