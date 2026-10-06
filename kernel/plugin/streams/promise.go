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

// deferred 包装 rt.NewPromise() 返回的三元组，供需要重复创建、随时 resolve/reject 的内部 Promise
// （如 reader/writer 的 closed、ready）使用。
type deferred struct {
	promise *goja.Promise
	resolve func(any) error
	reject  func(any) error
}

func newDeferred(rt *goja.Runtime) deferred {
	p, resolve, reject := rt.NewPromise()
	return deferred{promise: p, resolve: resolve, reject: reject}
}

// value 返回可暴露给脚本的 Promise 值。
func (d deferred) value(rt *goja.Runtime) goja.Value { return rt.ToValue(d.promise) }

// isPending 返回该 Promise 当前是否仍处于 pending 状态。
func (d deferred) isPending() bool { return d.promise.State() == goja.PromiseStatePending }

// newResolvedPromise 返回一个已经以 value 兑定的 Promise 值。
func newResolvedPromise(rt *goja.Runtime, value goja.Value) goja.Value {
	p, resolve, _ := rt.NewPromise()
	if err := resolve(value); err != nil {
		panic(err)
	}
	return rt.ToValue(p)
}

// newRejectedPromise 返回一个已经以 reason 拒绝的 Promise 值。
func newRejectedPromise(rt *goja.Runtime, reason goja.Value) goja.Value {
	p, _, reject := rt.NewPromise()
	if err := reject(reason); err != nil {
		panic(err)
	}
	return rt.ToValue(p)
}

// awaitResult 统一处理"可能是 Promise，也可能是普通值"的结果：result 不是 Promise 时直接以其值调用
// onFulfilled；是 Promise 时注册 then 回调。goja 把 Promise 反应（包括已经 settle 的 Promise 上新注册的
// then 回调）排进内部 job 队列，只在最外层脚本调用整体返回、控制权交还给 Go 的那一刻才循环排空（而不是
// 在 then()/resolve() 调用的当下同步触发），因此 onFulfilled/onRejected 的实际调用时机既不是
// awaitResult 返回前，也不保证在当前 Go 调用栈内——只保证最终会被调用（除非对应的 Promise 永不 settle）。
func awaitResult(rt *goja.Runtime, result goja.Value, onFulfilled func(value goja.Value), onRejected func(reason goja.Value)) {
	promise, ok := asPromise(result)
	if !ok {
		onFulfilled(result)
		return
	}

	object := rt.ToValue(promise).ToObject(rt)
	then, ok := goja.AssertFunction(object.Get("then"))
	if !ok {
		// 不应该发生：goja 的 Promise 对象总有可调用的 then。退化为直接按当前导出值处理，不中断调用方。
		onFulfilled(result)
		return
	}

	if _, err := then(object,
		rt.ToValue(func(call goja.FunctionCall) goja.Value {
			onFulfilled(call.Argument(0))
			return goja.Undefined()
		}),
		rt.ToValue(func(call goja.FunctionCall) goja.Value {
			onRejected(call.Argument(0))
			return goja.Undefined()
		}),
	); err != nil {
		panic(err)
	}
}

// asPromise 判断 value 是否导出为 *goja.Promise。
func asPromise(value goja.Value) (*goja.Promise, bool) {
	if value == nil {
		return nil, false
	}
	p, ok := value.Export().(*goja.Promise)
	return p, ok
}

// callOptional 调用可能为 nil 的 goja.Callable；fn 为 nil 时视为返回 undefined 的空操作，不调用 this/传参。
func callOptional(fn goja.Callable, this goja.Value, args ...goja.Value) (result goja.Value, err error) {
	if fn == nil {
		return goja.Undefined(), nil
	}
	return fn(this, args...)
}
