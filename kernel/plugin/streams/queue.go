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

// queueEntry 是内部队列中的一项：value 是入队的 chunk，size 是调用 size 算法后得到的大小（出队时累计扣减）。
// isClose 为 true 表示这一项是 WritableStream 的关闭请求哨兵（size 恒为 0，value 不使用），用来和常规写入
// 共用同一条队列、按入队顺序保持写入与关闭的相对次序；比用某个特殊 goja.Value 当哨兵更直接，不依赖 goja 对
// 任意 Go 值的包装/还原是否保持指针恒等。
type queueEntry struct {
	value   goja.Value
	size    float64
	isClose bool
}

// valueQueue 对应规范里 controller 的 [[queue]] 与 [[queueTotalSize]] 两个内部槛：一个先进先出队列，以及
// 按 size 算法累计的总大小。规范用一个双字段元组列表 + 独立总量变量实现，这里直接用切片 + 累计值。
type valueQueue struct {
	entries []queueEntry
	total   float64
}

// enqueue 把 value 以给定 size 加入队尾，并把 size 累加进总量。
func (q *valueQueue) enqueue(value goja.Value, size float64) {
	q.entries = append(q.entries, queueEntry{value: value, size: size})
	q.total += size
}

// enqueueClose 把一个关闭请求哨兵加入队尾（size 为 0，不占用队列容量）。
func (q *valueQueue) enqueueClose() {
	q.entries = append(q.entries, queueEntry{isClose: true})
}

// peekIsClose 返回队首项是否是关闭请求哨兵；调用方必须先确认队列非空。
func (q *valueQueue) peekIsClose() bool {
	return q.entries[0].isClose
}

// dequeue 取出并移除队首项，返回其 value；调用方必须先确认队列非空。
func (q *valueQueue) dequeue() goja.Value {
	entry := q.entries[0]
	q.entries = q.entries[1:]
	// 累计量按浮点减法可能产生微小负数误差，钳制为 0 与规范的处理意图一致（总量不应为负）。
	q.total -= entry.size
	if q.total < 0 {
		q.total = 0
	}
	return entry.value
}

// peek 返回队首项的 value，不移除；调用方必须先确认队列非空。
func (q *valueQueue) peek() goja.Value {
	return q.entries[0].value
}

// len 返回队列中的项数。
func (q *valueQueue) len() int {
	return len(q.entries)
}

// reset 清空队列与总量。
func (q *valueQueue) reset() {
	q.entries = nil
	q.total = 0
}
