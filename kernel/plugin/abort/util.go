// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package abort

import (
	"github.com/dop251/goja"
)

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
