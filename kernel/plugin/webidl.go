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

package plugin

import (
	"math"
	"slices"

	"github.com/dop251/goja"
	"github.com/samber/lo"
)

// expandoProperties 保存脚本在宿主对象上自行添加的属性，使 Blob、File、FormData 能像浏览器中的平台对象一样
// 挂载自定义属性、被子类用类字段扩展；内建成员都由原型上的访问器与方法提供，不经过这里。
type expandoProperties struct {
	keys   []string
	values map[string]goja.Value
}

func (e *expandoProperties) Get(key string) goja.Value { return e.values[key] }

func (e *expandoProperties) Set(key string, value goja.Value) bool {
	if e.values == nil {
		e.values = map[string]goja.Value{}
	}
	if _, ok := e.values[key]; !ok {
		e.keys = append(e.keys, key)
	}
	e.values[key] = value
	return true
}

func (e *expandoProperties) Has(key string) bool {
	_, ok := e.values[key]
	return ok
}

func (e *expandoProperties) Delete(key string) bool {
	if _, ok := e.values[key]; ok {
		delete(e.values, key)
		e.keys = slices.DeleteFunc(e.keys, func(k string) bool { return k == key })
	}
	return true
}

func (e *expandoProperties) Keys() []string { return slices.Clone(e.keys) }

// usvStringOf 按 WebIDL 把值转换为 USVString：执行 ECMAScript ToString（对象会调用其 toString/valueOf，Symbol 抛
// TypeError），未配对的代理项替换为 U+FFFD（goja 把 UTF-16 字符串转为 Go 字符串时即如此处理）。
func usvStringOf(rt *goja.Runtime, value goja.Value) string {
	str := value.ToString()
	if _, ok := str.(*goja.Symbol); ok {
		panic(rt.NewTypeError("Cannot convert a Symbol value to a string"))
	}
	return str.String()
}

// longLongOf 按 WebIDL 把值转换为 long long（无 [Clamp] 与 [EnforceRange]）：ToNumber 后 NaN 与无穷大视为 0，
// 截断小数部分，超出 64 位有符号范围时按 2^64 取模回绕。
func longLongOf(value goja.Value) int64 {
	x := value.ToFloat()
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return 0
	}
	x = math.Trunc(x)
	if x < math.MinInt64 || x >= math.MaxInt64 {
		x = math.Mod(x, 1<<64)
		if x < math.MinInt64 {
			x += 1 << 64
		} else if x >= math.MaxInt64 {
			x -= 1 << 64
		}
	}
	return int64(x)
}

// clampedLongLongOf 按 WebIDL [Clamp] long long 转换：NaN 视为 0，超出范围取边界，就近取整且恰在中间时取偶数。
// 返回 float64，调用方再与不超过 2^53 的长度比较，因此不会损失精度。
func clampedLongLongOf(value goja.Value) float64 {
	x := value.ToFloat()
	if math.IsNaN(x) {
		return 0
	}
	x = math.Min(math.Max(x, math.MinInt64), math.MaxInt64)
	// 加 0 把 -0 规范化为 +0。
	return math.RoundToEven(x) + 0
}

// iterateSequence 按 WebIDL 把值转换为 sequence：值必须是对象，Symbol.iterator 方法只读取一次，随后逐项取值并立即
// 交给 convert 转换；转换出错时异常直接向上传播，不关闭迭代器（与 WebIDL 一致）。
func iterateSequence(rt *goja.Runtime, value goja.Value, context string, convert func(goja.Value)) {
	object, ok := value.(*goja.Object)
	if !ok {
		panic(rt.NewTypeError("%s: Argument 1 can't be converted to a sequence", context))
	}
	getIterator, ok := goja.AssertFunction(object.GetSymbol(goja.SymIterator))
	if !ok {
		panic(rt.NewTypeError("%s: Argument 1 can't be converted to a sequence", context))
	}
	iteratorValue, err := getIterator(object)
	if err != nil {
		panic(err)
	}
	iterator, ok := iteratorValue.(*goja.Object)
	if !ok {
		panic(rt.NewTypeError("%s: Result of the Symbol.iterator method is not an object", context))
	}
	next, ok := goja.AssertFunction(iterator.Get("next"))
	if !ok {
		panic(rt.NewTypeError("%s: The iterator's next method is not callable", context))
	}

	for {
		resultValue, err := next(iterator)
		if err != nil {
			panic(err)
		}
		result, ok := resultValue.(*goja.Object)
		if !ok {
			panic(rt.NewTypeError("%s: Iterator result is not an object", context))
		}
		if done := result.Get("done"); done != nil && done.ToBoolean() {
			return
		}
		element := result.Get("value")
		if element == nil {
			element = goja.Undefined()
		}
		convert(element)
	}
}

// newMethod 创建 name 与 length 符合规范的原生函数；goja 默认以 Go 函数的完整限定名作为函数的 name。
func newMethod(rt *goja.Runtime, name string, length int, fn func(goja.FunctionCall) goja.Value) *goja.Object {
	method := rt.ToValue(fn).(*goja.Object)
	lo.Must0(method.DefineDataProperty("name", rt.ToValue(name), goja.FLAG_FALSE, goja.FLAG_TRUE, goja.FLAG_FALSE))
	lo.Must0(method.DefineDataProperty("length", rt.ToValue(length), goja.FLAG_FALSE, goja.FLAG_TRUE, goja.FLAG_FALSE))
	return method
}

// defineMethod 按 WebIDL 操作的属性特性（可写、可配置、可枚举）在 target 上定义方法。
func defineMethod(rt *goja.Runtime, target *goja.Object, name string, length int, fn func(goja.FunctionCall) goja.Value) {
	method := newMethod(rt, name, length, fn)
	lo.Must0(target.DefineDataProperty(name, method, goja.FLAG_TRUE, goja.FLAG_TRUE, goja.FLAG_TRUE))
}

// defineGetter 按 WebIDL 只读属性的特性（无 setter、可配置、可枚举）在 target 上定义访问器。
func defineGetter(rt *goja.Runtime, target *goja.Object, name string, get func(goja.FunctionCall) goja.Value) {
	getter := newMethod(rt, "get "+name, 0, get)
	lo.Must0(target.DefineAccessorProperty(name, getter, nil, goja.FLAG_TRUE, goja.FLAG_TRUE))
}

// defineToStringTag 定义 Symbol.toStringTag，使 Object.prototype.toString 返回 [object <tag>]。
func defineToStringTag(rt *goja.Runtime, target *goja.Object, tag string) {
	lo.Must0(target.DefineDataPropertySymbol(goja.SymToStringTag, rt.ToValue(tag), goja.FLAG_FALSE, goja.FLAG_TRUE,
		goja.FLAG_FALSE))
}

// newInterfaceConstructor 创建接口的构造函数，并按 WebIDL 设置 name、length、prototype 与 prototype.constructor 的
// 属性特性。construct 应以 call.This.Prototype() 作为实例原型，使子类构造的实例继承子类的原型。
func newInterfaceConstructor(rt *goja.Runtime, name string, length int, prototype *goja.Object,
	construct func(goja.ConstructorCall) *goja.Object) *goja.Object {
	constructor := rt.ToValue(construct).(*goja.Object)
	lo.Must0(constructor.DefineDataProperty("name", rt.ToValue(name), goja.FLAG_FALSE, goja.FLAG_TRUE, goja.FLAG_FALSE))
	lo.Must0(constructor.DefineDataProperty("length", rt.ToValue(length), goja.FLAG_FALSE, goja.FLAG_TRUE,
		goja.FLAG_FALSE))
	lo.Must0(constructor.DefineDataProperty("prototype", prototype, goja.FLAG_FALSE, goja.FLAG_FALSE, goja.FLAG_FALSE))
	lo.Must0(prototype.DefineDataProperty("constructor", constructor, goja.FLAG_TRUE, goja.FLAG_TRUE, goja.FLAG_FALSE))
	return constructor
}

// builtinGetter 取出 object 上自有访问器属性 name 的 getter，供注册时捕获内建访问器，避免插件脚本事后改写。
func builtinGetter(rt *goja.Runtime, object *goja.Object, name string) goja.Callable {
	objectConstructor := rt.Get("Object").ToObject(rt)
	getOwnPropertyDescriptor, ok := goja.AssertFunction(objectConstructor.Get("getOwnPropertyDescriptor"))
	if !ok {
		panic(rt.NewTypeError("Object.getOwnPropertyDescriptor is not a function"))
	}
	descriptor := lo.Must(getOwnPropertyDescriptor(objectConstructor, object, rt.ToValue(name))).ToObject(rt)
	getter, ok := goja.AssertFunction(descriptor.Get("get"))
	if !ok {
		panic(rt.NewTypeError("the %s property has no getter", name))
	}
	return getter
}

// iteratorPrototypeOf 返回 %IteratorPrototype%（数组迭代器原型的原型），以它为原型的迭代器自身也是可迭代对象。
func iteratorPrototypeOf(rt *goja.Runtime) *goja.Object {
	array := rt.NewArray()
	values, ok := goja.AssertFunction(array.GetSymbol(goja.SymIterator))
	if !ok {
		panic(rt.NewTypeError("Array.prototype[Symbol.iterator] is not a function"))
	}
	iterator := lo.Must(values(array)).ToObject(rt)
	return iterator.Prototype().Prototype()
}
