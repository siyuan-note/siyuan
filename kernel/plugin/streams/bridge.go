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

	"github.com/dop251/goja"
)

// ConsumeReadableStream 是 Go 侧消费一个 JS ReadableStream 的入口（与 NewReadableStream 相反的桥接方向），
// 供 kernel/plugin 把插件返回的流写成 HTTP 响应等场景使用。stream 必须是本 Host 构造的 ReadableStream，
// 否则直接调用 onDone 报错。内部反复调用 reader.read()：每收到一个 chunk 就同步调用一次 onChunk（在当前
// 调用所在的 VM 线程上），onChunk 返回非 nil 错误会取消底层 reader 并以该错误结束；流正常结束或出错时调用
// 一次 onDone（nil 表示正常结束）。onChunk/onDone 的实际调用可能在本次调用返回之后才发生，取决于 read() 的
// Promise 何时落定（见包文档），不保证同步完成。
//
// 返回的 cancelOnVMThread 函数用于提前终止消费（例如客户端提前断开连接），调用方必须确保它在 runtime 所在
// 的事件循环线程上执行；多次调用是安全的，重复调用只是重复发出一次 cancel 请求。
func (h *Host) ConsumeReadableStream(stream *goja.Object, onChunk func(chunk goja.Value) error, onDone func(err error)) (cancelOnVMThread func(reason goja.Value)) {
	rt := h.rt
	if !h.IsReadableStream(stream) {
		onDone(fmt.Errorf("ConsumeReadableStream: value is not a ReadableStream"))
		return func(goja.Value) {}
	}

	getReader, ok := goja.AssertFunction(stream.Get("getReader"))
	if !ok {
		onDone(fmt.Errorf("ConsumeReadableStream: getReader is not a function"))
		return func(goja.Value) {}
	}
	readerValue, err := getReader(stream)
	if err != nil {
		onDone(err)
		return func(goja.Value) {}
	}
	reader := readerValue.ToObject(rt)
	read, ok := goja.AssertFunction(reader.Get("read"))
	if !ok {
		onDone(fmt.Errorf("ConsumeReadableStream: reader.read is not a function"))
		return func(goja.Value) {}
	}
	cancelFn, _ := goja.AssertFunction(reader.Get("cancel"))

	finished := false
	finish := func(err error) {
		if finished {
			return
		}
		finished = true
		onDone(err)
	}

	var pump func()
	pump = func() {
		if finished {
			return
		}
		result, callErr := read(reader)
		if callErr != nil {
			finish(callErr)
			return
		}
		awaitResult(rt, result, func(value goja.Value) {
			if finished {
				return
			}
			object := value.ToObject(rt)
			if done := object.Get("done"); done != nil && done.ToBoolean() {
				finish(nil)
				return
			}
			if chunkErr := onChunk(object.Get("value")); chunkErr != nil {
				if cancelFn != nil {
					if _, err := cancelFn(reader, rt.NewGoError(chunkErr)); err != nil {
						panic(err)
					}
				}
				finish(chunkErr)
				return
			}
			pump()
		}, func(reason goja.Value) {
			finish(fmt.Errorf("%s", reason))
		})
	}
	pump()

	return func(reason goja.Value) {
		if finished || cancelFn == nil {
			return
		}
		if _, err := cancelFn(reader, reason); err != nil {
			panic(err)
		}
	}
}
