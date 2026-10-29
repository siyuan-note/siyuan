// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package gojaext 提供插件沙箱与 abort polyfill 共用的 goja 值判定与对象操作。
// 本包只依赖 goja，供 kernel/plugin 与 kernel/plugin/abort 同时引用，避免两侧各复制一份。
package gojaext

import (
	"fmt"

	"github.com/dop251/goja"
)

// IsValueNotUndefined 判断 jsValue 既不为 Go 的 nil，也不是脚本意义上的 undefined。
func IsValueNotUndefined(jsValue goja.Value) bool {
	return jsValue != nil && !goja.IsUndefined(jsValue)
}

// IsValueNotNull 判断 jsValue 既不为 Go 的 nil，也不是 undefined 或 null。
func IsValueNotNull(jsValue goja.Value) bool {
	return IsValueNotUndefined(jsValue) && !goja.IsNull(jsValue)
}

// IsArray 判断 jsValue 是否为 JavaScript Array。
func IsArray(rt *goja.Runtime, jsValue goja.Value) bool {
	if jsValue == nil {
		return false
	}

	if goja.IsUndefined(jsValue) || goja.IsNull(jsValue) {
		return false
	}

	return IsObjectArray(jsValue.ToObject(rt))
}

// IsObjectArray 按类名判断 goja.Object 是否为 JavaScript Array。
func IsObjectArray(jsObject *goja.Object) bool {
	if jsObject == nil {
		return false
	}
	return "Array" == jsObject.ClassName()
}

// Freeze 调用脚本环境的 Object.freeze()。
func Freeze(rt *goja.Runtime, obj *goja.Object) error {
	object := rt.GlobalObject().Get("Object").ToObject(rt)
	if object == nil {
		return fmt.Errorf("globalThis.Object is not an object")
	}

	freeze, ok := goja.AssertFunction(object.Get("freeze"))
	if !ok {
		return fmt.Errorf("globalThis.Object.freeze is not a function")
	}

	_, err := freeze(object, obj)
	return err
}
