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

package encoding

import "github.com/dop251/goja"

// Enable 把 TextEncoder 与 TextDecoder 构造函数挂到 runtime 的 globalThis，调用方式与 goja_nodejs 的 url、buffer、console
// 一致，失败时 panic。TextDecoder 的 fatal、ignoreBOM、stream 选项依赖 runtime 已设置能识别 json 或 js 标签的字段名映射。
func Enable(runtime *goja.Runtime) {
	if err := RegisterRuntime(runtime); err != nil {
		panic(err)
	}
}
