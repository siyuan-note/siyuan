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
	"math"

	"github.com/dop251/goja"
)

// extractHighWaterMark 对应规范 ExtractHighWaterMark：strategy.highWaterMark 缺省时取 defaultHWM；否则转换为
// 数值并要求非 NaN、非负，否则抛 RangeError。
func extractHighWaterMark(rt *goja.Runtime, strategy goja.Value, defaultHWM float64) float64 {
	object, ok := strategyObjectOf(strategy)
	if !ok {
		return defaultHWM
	}
	hwm := object.Get("highWaterMark")
	if hwm == nil || goja.IsUndefined(hwm) {
		return defaultHWM
	}
	value := hwm.ToFloat()
	if math.IsNaN(value) || value < 0 {
		panic(rangeErrorf(rt, "Invalid highWaterMark"))
	}
	return value
}

// rangeErrorf 构造一个 name 为 RangeError 的普通 Error（本沙箱沿用 streamError 的做法，不提供原生 RangeError
// 包装）。
func rangeErrorf(rt *goja.Runtime, message string) goja.Value {
	return streamError(rt, "RangeError", message)
}

// strategyObjectOf 把 QueuingStrategy 字典参数转换为对象：undefined/null 视为空字典，其余非对象值抛错由
// 调用方按需处理（这里简单返回 ok=false 让调用方套用缺省值，与"空字典"等价，和规范对 undefined/null 的处理
// 一致；真正传入非对象、非 nullish 值时 WebIDL 本应抛错，但 strategy 参数在本包内只有宿主自己构造的调用点，
// 不会传入这类值，因此未做严格校验）。
func strategyObjectOf(strategy goja.Value) (*goja.Object, bool) {
	if strategy == nil || goja.IsUndefined(strategy) || goja.IsNull(strategy) {
		return nil, false
	}
	object, ok := strategy.(*goja.Object)
	return object, ok
}

// extractSizeAlgorithm 对应规范 ExtractSizeAlgorithm：strategy.size 缺省时返回"任意 chunk 大小为 1"的算法，
// 否则返回调用该函数的算法（异常原样向上抛出）。
func extractSizeAlgorithm(rt *goja.Runtime, strategy goja.Value) func(goja.Value) float64 {
	object, ok := strategyObjectOf(strategy)
	if !ok {
		return defaultSizeAlgorithm
	}
	size := object.Get("size")
	if size == nil || goja.IsUndefined(size) {
		return defaultSizeAlgorithm
	}
	fn, ok := goja.AssertFunction(size)
	if !ok {
		panic(typeErrorf(rt, "size member of QueuingStrategy must be a function"))
	}
	return func(chunk goja.Value) float64 {
		result, err := fn(goja.Undefined(), chunk)
		if err != nil {
			panic(err)
		}
		return result.ToFloat()
	}
}

// newCountQueuingStrategyConstructor 构造 CountQueuingStrategy：{highWaterMark} -> 对象，size() 恒定为 1，
// highWaterMark 为构造时传入的值。
func newCountQueuingStrategyConstructor(h *Host) *goja.Object {
	rt := h.rt
	prototype := rt.NewObject()
	defineMethod(rt, prototype, "size", 0, func(call goja.FunctionCall) goja.Value { return rt.ToValue(1) })
	defineToStringTag(rt, prototype, "CountQueuingStrategy")

	return newInterfaceConstructor(rt, "CountQueuingStrategy", 1, prototype, func(call goja.ConstructorCall) *goja.Object {
		instance := rt.NewObject()
		must(instance.SetPrototype(call.This.Prototype()))
		must(instance.DefineDataProperty("highWaterMark", rt.ToValue(highWaterMarkMemberOf(rt, call.Argument(0))),
			goja.FLAG_TRUE, goja.FLAG_TRUE, goja.FLAG_FALSE))
		return instance
	})
}

// newByteLengthQueuingStrategyConstructor 构造 ByteLengthQueuingStrategy：{highWaterMark} -> 对象，
// size(chunk) 返回 chunk.byteLength，highWaterMark 为构造时传入的值。
func newByteLengthQueuingStrategyConstructor(h *Host) *goja.Object {
	rt := h.rt
	prototype := rt.NewObject()
	defineMethod(rt, prototype, "size", 1, func(call goja.FunctionCall) goja.Value {
		chunk := call.Argument(0)
		if chunkObj, ok := chunk.(*goja.Object); ok {
			if byteLength := chunkObj.Get("byteLength"); byteLength != nil {
				return byteLength
			}
		}
		return rt.ToValue(0)
	})
	defineToStringTag(rt, prototype, "ByteLengthQueuingStrategy")

	return newInterfaceConstructor(rt, "ByteLengthQueuingStrategy", 1, prototype, func(call goja.ConstructorCall) *goja.Object {
		instance := rt.NewObject()
		must(instance.SetPrototype(call.This.Prototype()))
		must(instance.DefineDataProperty("highWaterMark", rt.ToValue(highWaterMarkMemberOf(rt, call.Argument(0))),
			goja.FLAG_TRUE, goja.FLAG_TRUE, goja.FLAG_FALSE))
		return instance
	})
}

// highWaterMarkMemberOf 读取 QueuingStrategyInit 字典的必填 highWaterMark 成员（无默认值，必须显式提供）。
func highWaterMarkMemberOf(rt *goja.Runtime, init goja.Value) float64 {
	object, ok := init.(*goja.Object)
	if !ok {
		panic(typeErrorf(rt, "QueuingStrategyInit: can't be converted to a dictionary"))
	}
	hwm := object.Get("highWaterMark")
	if hwm == nil || goja.IsUndefined(hwm) {
		panic(typeErrorf(rt, "QueuingStrategyInit: highWaterMark is required"))
	}
	return hwm.ToFloat()
}
