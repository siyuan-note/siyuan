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

// Package crypto 以 Go 标准库实现 Web Crypto API 的算法层，供内核插件沙箱的 globalThis.crypto 绑定调用。
// 该包不依赖 goja，密钥材料只保存在 Go 侧，不向插件脚本暴露。
package crypto

import "fmt"

// Web Crypto 规范要求的错误名称，绑定层据此设置 JS 错误对象的 name 属性。
const (
	ErrNameType          = "TypeError"          // 参数类型或必需成员缺失，绑定层转换为 JS TypeError
	ErrNameNotSupported  = "NotSupportedError"  // 算法或参数组合不受支持
	ErrNameSyntax        = "SyntaxError"        // 用法列表等参数不符合规范要求
	ErrNameInvalidAccess = "InvalidAccessError" // 密钥不允许该操作
	ErrNameData          = "DataError"          // 待导入的密钥数据无效
	ErrNameOperation     = "OperationError"     // 运算失败，包含认证失败与填充错误
	ErrNameQuotaExceeded = "QuotaExceededError" // 请求的随机字节数超出限额
	ErrNameTypeMismatch  = "TypeMismatchError"  // 传入的数组类型不符合要求
)

// Error 是算法层的错误类型，Name 对应 Web Crypto 规范中的错误名称。
type Error struct {
	Name    string
	Message string
}

func (e *Error) Error() string {
	return e.Message
}

// NewError 构造一个带规范错误名称的错误，供算法层与绑定层共用。
func NewError(name string, format string, args ...any) *Error {
	return &Error{Name: name, Message: fmt.Sprintf(format, args...)}
}

func typeError(format string, args ...any) *Error {
	return NewError(ErrNameType, format, args...)
}

func notSupportedError(format string, args ...any) *Error {
	return NewError(ErrNameNotSupported, format, args...)
}

func syntaxError(format string, args ...any) *Error {
	return NewError(ErrNameSyntax, format, args...)
}

func invalidAccessError(format string, args ...any) *Error {
	return NewError(ErrNameInvalidAccess, format, args...)
}

func dataError(format string, args ...any) *Error {
	return NewError(ErrNameData, format, args...)
}

func operationError(format string, args ...any) *Error {
	return NewError(ErrNameOperation, format, args...)
}
