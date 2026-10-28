// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package streams

import (
	"fmt"

	"github.com/dop251/goja"
)

// Host 捕获 Enable 构造出的全部构造函数、原型，供同一 runtime 内后续创建实例、识别实例类型，以及 kernel/plugin
// 的 Go 桥接代码（bridge.go）使用。调用方必须在同一个 runtime 上保留并复用 Enable 返回的 Host，不要重复调用
// Enable。
type Host struct {
	rt *goja.Runtime

	readableStreamPrototype *goja.Object
	readableReaderProto     *goja.Object
	readableControllerProto *goja.Object

	writableStreamPrototype *goja.Object
	writableWriterProto     *goja.Object
	writableControllerProto *goja.Object

	transformStreamPrototype *goja.Object
	transformControllerProto *goja.Object
}

// Enable 把 ReadableStream、WritableStream、TransformStream 及其默认 controller/reader/writer，以及
// CountQueuingStrategy、ByteLengthQueuingStrategy 挂到 runtime 的 globalThis，调用方式与本沙箱其他 Web API
// 一致，失败时 panic。返回的 Host 供同一 runtime 内的 Go 桥接代码使用（见 bridge.go），调用方应保留它。
func Enable(rt *goja.Runtime) (h *Host) {
	defer func() {
		if r := recover(); r != nil {
			panic(fmt.Errorf("streams.Enable: %v", r))
		}
	}()

	h = &Host{rt: rt}
	h.readableControllerProto = newReadableControllerPrototype(h)
	h.readableReaderProto = newReadableReaderPrototype(h)
	h.readableStreamPrototype = newReadableStreamPrototype(h)
	readableStreamCtor := h.newReadableStreamConstructor()
	must(readableStreamCtor.Set("from", rt.ToValue(func(call goja.FunctionCall) goja.Value {
		return h.readableStreamFrom(call.Argument(0))
	})))
	must(rt.Set("ReadableStream", readableStreamCtor))

	h.writableControllerProto = newWritableControllerPrototype(h)
	h.writableWriterProto = newWritableWriterPrototype(h)
	h.writableStreamPrototype = newWritableStreamPrototype(h)
	must(rt.Set("WritableStream", h.newWritableStreamConstructor()))

	h.transformControllerProto = newTransformControllerPrototype(h)
	h.transformStreamPrototype = newTransformStreamPrototype(h)
	must(rt.Set("TransformStream", h.newTransformStreamConstructor()))

	must(rt.Set("CountQueuingStrategy", newCountQueuingStrategyConstructor(h)))
	must(rt.Set("ByteLengthQueuingStrategy", newByteLengthQueuingStrategyConstructor(h)))
	return
}
