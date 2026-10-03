// 本文件移植自 https://github.com/grafana/sobek-webapi-encoding 的 encoding/error.go（提交 5785852a34），
// 按 Apache License 2.0 使用，许可证全文见同目录 LICENSE。
// 修改：以 github.com/dop251/goja 替换 github.com/grafana/sobek。

package encoding

import (
	"fmt"

	"github.com/dop251/goja"
)

// ErrorName identifies the category of an encoding error.
type ErrorName string

const (
	// RangeError is thrown if the value of label is unknown, or
	// is one of the values leading to a 'replacement' decoding
	// algorithm ("iso-2022-cn" or "iso-2022-cn-ext").
	RangeError ErrorName = "RangeError"

	// TypeError is thrown if the value if the Decoder fatal option
	// is set and the input data cannot be decoded.
	TypeError ErrorName = "TypeError"
)

// Error represents an encoding error.
type Error struct {
	// Name contains one of the strings associated with an error name.
	Name ErrorName `json:"name"`

	// Message represents message or description associated with the given error name.
	Message string `json:"message"`
}

// JSError creates a JavaScript error object that can be thrown
func (e *Error) JSError(rt *goja.Runtime) *goja.Object {
	var constructor *goja.Object

	switch e.Name {
	case TypeError:
		constructor = rt.Get("TypeError").ToObject(rt)
	case RangeError:
		constructor = rt.Get("RangeError").ToObject(rt)
	default:
		constructor = rt.Get("Error").ToObject(rt)
	}

	errorObj, err := rt.New(constructor, rt.ToValue(e.Message))
	if err != nil {
		// Fallback to generic error
		errorObj = rt.ToValue(fmt.Errorf("%s: %s", e.Name, e.Message)).ToObject(rt)
	}

	return errorObj
}

// Error implements the `error` interface.
func (e *Error) Error() string {
	return fmt.Sprintf("%s: %s", e.Name, e.Message)
}

// NewError returns a new Error instance.
func NewError(name ErrorName, message string) *Error {
	return &Error{
		Name:    name,
		Message: message,
	}
}

// Ensure Error implements the error interface at compile time.
var _ error = (*Error)(nil)
