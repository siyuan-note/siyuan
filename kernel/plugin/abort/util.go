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
