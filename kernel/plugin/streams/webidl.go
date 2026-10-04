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
	"slices"

	"github.com/dop251/goja"
)

// expandoProperties 保存脚本在宿主对象上自行添加的属性，使流对象能像浏览器中的平台对象一样挂载自定义属性、
// 被子类用类字段扩展；内建成员都由原型上的访问器与方法提供，不经过这里。与 kernel/plugin/webidl.go 的同名
// 类型同构：本包不依赖 plugin 包，避免循环依赖，因此复制一份这些通用、不含业务逻辑的 WebIDL 辅助。
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

// newMethod 创建 name 与 length 符合规范的原生函数；goja 默认以 Go 函数的完整限定名作为函数的 name。
func newMethod(rt *goja.Runtime, name string, length int, fn func(goja.FunctionCall) goja.Value) *goja.Object {
	method := rt.ToValue(fn).(*goja.Object)
	must(method.DefineDataProperty("name", rt.ToValue(name), goja.FLAG_FALSE, goja.FLAG_TRUE, goja.FLAG_FALSE))
	must(method.DefineDataProperty("length", rt.ToValue(length), goja.FLAG_FALSE, goja.FLAG_TRUE, goja.FLAG_FALSE))
	return method
}

// defineMethod 按 WebIDL 操作的属性特性（可写、可配置、可枚举）在 target 上定义方法。
func defineMethod(rt *goja.Runtime, target *goja.Object, name string, length int, fn func(goja.FunctionCall) goja.Value) {
	method := newMethod(rt, name, length, fn)
	must(target.DefineDataProperty(name, method, goja.FLAG_TRUE, goja.FLAG_TRUE, goja.FLAG_TRUE))
}

// defineGetter 按 WebIDL 只读属性的特性（无 setter、可配置、可枚举）在 target 上定义访问器。
func defineGetter(rt *goja.Runtime, target *goja.Object, name string, get func(goja.FunctionCall) goja.Value) {
	getter := newMethod(rt, "get "+name, 0, get)
	must(target.DefineAccessorProperty(name, getter, nil, goja.FLAG_TRUE, goja.FLAG_TRUE))
}

// defineToStringTag 定义 Symbol.toStringTag，使 Object.prototype.toString 返回 [object <tag>]。
func defineToStringTag(rt *goja.Runtime, target *goja.Object, tag string) {
	must(target.DefineDataPropertySymbol(goja.SymToStringTag, rt.ToValue(tag), goja.FLAG_FALSE, goja.FLAG_TRUE,
		goja.FLAG_FALSE))
}

// newInterfaceConstructor 创建接口的构造函数，并按 WebIDL 设置 name、length、prototype 与 prototype.constructor
// 的属性特性。construct 应以 call.This.Prototype() 作为实例原型，使子类构造的实例继承子类的原型。
func newInterfaceConstructor(rt *goja.Runtime, name string, length int, prototype *goja.Object,
	construct func(goja.ConstructorCall) *goja.Object) *goja.Object {
	constructor := rt.ToValue(construct).(*goja.Object)
	must(constructor.DefineDataProperty("name", rt.ToValue(name), goja.FLAG_FALSE, goja.FLAG_TRUE, goja.FLAG_FALSE))
	must(constructor.DefineDataProperty("length", rt.ToValue(length), goja.FLAG_FALSE, goja.FLAG_TRUE,
		goja.FLAG_FALSE))
	must(constructor.DefineDataProperty("prototype", prototype, goja.FLAG_FALSE, goja.FLAG_FALSE, goja.FLAG_FALSE))
	must(prototype.DefineDataProperty("constructor", constructor, goja.FLAG_TRUE, goja.FLAG_TRUE, goja.FLAG_FALSE))
	return constructor
}

// illegalConstructor 构造一个按 WebIDL 规范不可直接实例化的接口的构造函数：用 new 调用会抛出 TypeError，与
// kernel/plugin 的 AbortSignal 构造函数一致（goja 以 ConstructorCall 签名注册的函数本就只能通过 new 调用）。
func illegalConstructor(rt *goja.Runtime, name string, prototype *goja.Object) *goja.Object {
	return newInterfaceConstructor(rt, name, 0, prototype, func(goja.ConstructorCall) *goja.Object {
		panic(rt.NewTypeError("Illegal constructor"))
	})
}

// must 在 err 非 nil 时 panic；仅用于"失败说明调用方传参有编程错误"的内部断言场景（如重复定义同名属性），不用于
// 可能来自脚本输入的失败路径。
func must(err error) {
	if err != nil {
		panic(err)
	}
}
