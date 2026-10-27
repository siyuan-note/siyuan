// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package abort

import (
	"fmt"

	"github.com/dop251/goja"
)

// isJsValueNotUndefined、isJsValueNotNull、isJsArray、isJsObjectArray 与 objectFreeze 分别与 kernel/plugin/sandbox.go
// 的同名函数及 ObjectFreeze 同构：本包不依赖 plugin 包，避免循环依赖，因此复制一份这些通用、不含业务逻辑的辅助。

func isJsValueNotUndefined(jsValue goja.Value) bool {
	return jsValue != nil && !goja.IsUndefined(jsValue)
}

func isJsValueNotNull(jsValue goja.Value) bool {
	return isJsValueNotUndefined(jsValue) && !goja.IsNull(jsValue)
}

func isJsArray(rt *goja.Runtime, jsValue goja.Value) bool {
	if jsValue == nil {
		return false
	}

	if goja.IsUndefined(jsValue) || goja.IsNull(jsValue) {
		return false
	}

	jsObject := jsValue.ToObject(rt)
	return isJsObjectArray(jsObject)
}

func isJsObjectArray(jsObject *goja.Object) bool {
	if jsObject == nil {
		return false
	}

	switch jsObject.ClassName() {
	case "Array":
		return true
	default:
		return false
	}
}

// dictMember 读取字典对象 object 上名为 name 的成员，缺失或为 undefined 时返回 nil；调用方据此套用默认值，
// 不能直接对 Get 的结果调用 ToBoolean/String 等方法——goja 的 Get 在属性不存在时返回 Go 的 nil（不是脚本
// 意义上的 undefined 值），对 nil 调用这些方法会触发 nil 指针解引用而不是产生一个"假值"。
func dictMember(object *goja.Object, name string) goja.Value {
	value := object.Get(name)
	if value == nil || goja.IsUndefined(value) {
		return nil
	}
	return value
}

// objectFreeze 调用 Object.freeze()。
func objectFreeze(rt *goja.Runtime, obj *goja.Object) error {
	Object := rt.GlobalObject().Get("Object").ToObject(rt)
	if Object == nil {
		return fmt.Errorf("globalThis.Object is not an object")
	}

	freeze, ok := goja.AssertFunction(Object.Get("freeze"))
	if !ok {
		return fmt.Errorf("globalThis.Object.freeze is not a function")
	}

	_, err := freeze(Object, obj)
	return err
}
