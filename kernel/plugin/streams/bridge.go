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

// StreamConsumer 是 Go 侧消费一个 JS ReadableStream 的句柄（与 NewReadableStream 相反的桥接方向），
// 由 OpenReadableStreamConsumer 创建，供 kernel/plugin 把插件返回的流写成 HTTP 响应等场景使用。调用方按
// 自己的节奏（例如每写完一块、Flush 之后）调用 PullOnVMThread 请求下一块，而不是由本包自行连续调用
// reader.read()：这是实现背压的关键——如果本包在 onChunk 回调返回后立即发起下一次 read()，底层 pull
// 算法会在没有人真正消费数据的情况下被反复调用，使插件远远跑在 Go 侧消费进度之前。PullOnVMThread 与
// CancelOnVMThread 都必须在 runtime 所在的事件循环线程上调用。
type StreamConsumer struct {
	rt       *goja.Runtime
	reader   *goja.Object
	read     goja.Callable
	cancelFn goja.Callable
	finished bool
}

// OpenReadableStreamConsumer 获取 stream 的 reader，不发起任何读取；返回的 consumer 由调用方通过
// PullOnVMThread 按需驱动。stream 必须是本 Host 构造的 ReadableStream，否则返回错误。
func (h *Host) OpenReadableStreamConsumer(stream *goja.Object) (*StreamConsumer, error) {
	rt := h.rt
	if !h.IsReadableStream(stream) {
		return nil, fmt.Errorf("OpenReadableStreamConsumer: value is not a ReadableStream")
	}

	getReader, ok := goja.AssertFunction(stream.Get("getReader"))
	if !ok {
		return nil, fmt.Errorf("OpenReadableStreamConsumer: getReader is not a function")
	}
	readerValue, err := getReader(stream)
	if err != nil {
		return nil, err
	}
	reader := readerValue.ToObject(rt)
	read, ok := goja.AssertFunction(reader.Get("read"))
	if !ok {
		return nil, fmt.Errorf("OpenReadableStreamConsumer: reader.read is not a function")
	}
	cancelFn, _ := goja.AssertFunction(reader.Get("cancel"))

	return &StreamConsumer{rt: rt, reader: reader, read: read, cancelFn: cancelFn}, nil
}

// PullOnVMThread 请求下一块数据：调用一次 reader.read()，并在其 Promise 落定后调用一次 onChunk（有数据时）
// 或 onDone（流结束/出错，或本次 read() 调用本身失败时，nil 表示正常结束）。已经调用过 onDone 之后再调用
// PullOnVMThread 是空操作。onChunk 返回非 nil 错误会取消底层 reader 并以该错误调用 onDone，不再继续读取；
// 调用方必须等 onChunk/onDone 被调用之后才能再次调用 PullOnVMThread，不能提前发起下一次拉取，这正是背压
// 得以生效的地方。onChunk/onDone 的实际调用可能在本次调用返回之后才发生，取决于 read() 的 Promise 何时
// 落定（见包文档），不保证同步完成。
func (c *StreamConsumer) PullOnVMThread(onChunk func(chunk goja.Value) error, onDone func(err error)) {
	if c.finished {
		return
	}
	result, callErr := c.read(c.reader)
	if callErr != nil {
		c.finished = true
		onDone(callErr)
		return
	}
	awaitResult(c.rt, result, func(value goja.Value) {
		if c.finished {
			return
		}
		object := value.ToObject(c.rt)
		if done := object.Get("done"); done != nil && done.ToBoolean() {
			c.finished = true
			onDone(nil)
			return
		}
		if chunkErr := onChunk(object.Get("value")); chunkErr != nil {
			c.cancel(c.rt.NewGoError(chunkErr))
			c.finished = true
			onDone(chunkErr)
			return
		}
	}, func(reason goja.Value) {
		if c.finished {
			return
		}
		c.finished = true
		onDone(fmt.Errorf("%s", reason))
	})
}

// CancelOnVMThread 提前终止消费（例如客户端提前断开连接）；多次调用是安全的，流已经结束/出错之后调用是空操作。
func (c *StreamConsumer) CancelOnVMThread(reason goja.Value) {
	if c.finished {
		return
	}
	c.cancel(reason)
}

func (c *StreamConsumer) cancel(reason goja.Value) {
	if c.cancelFn == nil {
		return
	}
	if _, err := c.cancelFn(c.reader, reason); err != nil {
		panic(err)
	}
}
