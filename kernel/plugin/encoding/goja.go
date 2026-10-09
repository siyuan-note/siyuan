// 本文件移植自 https://github.com/grafana/sobek-webapi-encoding 的 encoding/sobek.go（提交 5785852a34），
// 按 Apache License 2.0 使用，许可证全文见同目录 LICENSE。
// 修改：以 github.com/dop251/goja 替换 github.com/grafana/sobek，文件由 sobek.go 更名为 goja.go。

package encoding

import (
	"errors"
	"fmt"

	"github.com/dop251/goja"
)

// RegisterRuntime exports the TextDecoder and TextEncoder constructors into the provided goja runtime.
//
// It does not configure rt's [goja.FieldNameMapper]: doing so unconditionally
// would override a mapper the host application may have already set for its
// own purposes. Callers must set a mapper that resolves this package's "js"
// (or equivalent "json") tags for "fatal", "ignoreBOM", and "stream". For
// example, configure
// rt.SetFieldNameMapper(goja.TagFieldNameMapper("js", true)) before
// registering, or TextDecoder/TextDecoder.decode options will be silently
// ignored. See the package documentation for details.
func RegisterRuntime(rt *goja.Runtime) error {
	if err := bindTextDecoder(rt); err != nil {
		return err
	}

	return bindTextEncoder(rt)
}

func bindTextDecoder(rt *goja.Runtime) error {
	constructor := func(call goja.ConstructorCall) *goja.Object {
		label := "utf-8"
		if arg := call.Argument(0); arg != nil && !isNullish(arg) {
			// Per the WebIDL USVString conversion rules, a Symbol cannot be
			// coerced to a string and must throw a TypeError; unlike real
			// string coercion, goja's ExportTo would otherwise silently
			// convert it to its description instead of erroring.
			if _, isSymbol := arg.(*goja.Symbol); isSymbol {
				throwAsJSError(rt, NewError(TypeError, "the provided label value cannot be converted to a string"))
			}

			if err := rt.ExportTo(arg, &label); err != nil {
				throwAsJSError(rt, NewError(RangeError, "extracting label from the first argument: "+err.Error()))
			}
		}

		var options TextDecoderOptions
		if arg := call.Argument(1); arg != nil && !isNullish(arg) {
			if err := rt.ExportTo(arg, &options); err != nil {
				panic(rt.NewGoError(err))
			}
		}

		td, err := NewTextDecoder(label, options)
		if err != nil {
			throwAsJSError(rt, err)
		}

		return newTextDecoderObject(rt, td)
	}

	return rt.Set("TextDecoder", constructor)
}

func bindTextEncoder(rt *goja.Runtime) error {
	constructor := func(_ goja.ConstructorCall) *goja.Object {
		return newTextEncoderObject(rt, NewTextEncoder())
	}

	return rt.Set("TextEncoder", constructor)
}

// newTextDecoderObject converts the given TextDecoder instance into a JS object.
//
// It is used by the TextDecoder constructor to convert the Go instance into a JS,
// and will also set the relevant properties as read-only as per the spec.
//
// In the event setting the properties on the object where to fail, the function
// will throw a JS exception.
func newTextDecoderObject(rt *goja.Runtime, td *TextDecoder) *goja.Object {
	obj := rt.NewObject()

	// Wrap the Go TextDecoder.Decode method in a JS function
	decodeMethod := func(call goja.FunctionCall) goja.Value {
		// Handle variable arguments - buffer can be undefined/missing
		var buffer goja.Value
		if len(call.Arguments) > 0 {
			buffer = call.Arguments[0]
		}

		// Handle options parameter
		var options TextDecodeOptions
		if len(call.Arguments) > 1 && !isNullish(call.Arguments[1]) {
			if err := rt.ExportTo(call.Arguments[1], &options); err != nil {
				panic(rt.NewGoError(err))
			}
		}

		data, err := exportArrayBuffer(rt, buffer)
		if err != nil {
			panic(rt.NewGoError(err))
		}

		decoded, err := td.Decode(data, options)
		if err != nil {
			throwAsJSError(rt, err)
		}

		return rt.ToValue(decoded)
	}

	// Set the decode method to the wrapper function we just created
	if err := setReadOnlyPropertyOf(obj, "decode", rt.ToValue(decodeMethod)); err != nil {
		panic(rt.NewGoError(fmt.Errorf("defining decode read-only property on TextDecoder object: %w", err)))
	}

	// Set the encoding property
	if err := setReadOnlyPropertyOf(obj, "encoding", rt.ToValue(string(td.Encoding))); err != nil {
		panic(rt.NewGoError(fmt.Errorf("defining encoding read-only property on TextDecoder object: %w", err)))
	}

	// Set the fatal property
	if err := setReadOnlyPropertyOf(obj, "fatal", rt.ToValue(td.Fatal)); err != nil {
		panic(rt.NewGoError(fmt.Errorf("defining fatal read-only property on TextDecoder object: %w", err)))
	}

	// Set the ignoreBOM property
	if err := setReadOnlyPropertyOf(obj, "ignoreBOM", rt.ToValue(td.IgnoreBOM)); err != nil {
		panic(rt.NewGoError(fmt.Errorf("defining ignoreBOM read-only property on TextDecoder object: %w", err)))
	}

	return obj
}

func newTextEncoderObject(rt *goja.Runtime, te *TextEncoder) *goja.Object {
	obj := rt.NewObject()

	// Wrap the Go TextEncoder.Encode method in a JS function
	encodeMethod := func(value goja.Value) *goja.Object {
		// Handle undefined/null values by defaulting to empty string
		var text string
		if isNullish(value) {
			text = ""
		} else {
			text = value.String()
		}

		buffer, err := te.Encode(text)
		if err != nil {
			throwAsJSError(rt, err)
		}

		// Create a new Uint8Array from the buffer
		u, err := rt.New(rt.Get("Uint8Array"), rt.ToValue(rt.NewArrayBuffer(buffer)))
		if err != nil {
			panic(rt.NewGoError(err))
		}

		return u
	}

	// Set the encode property by wrapping the Go function in a JS function
	if err := setReadOnlyPropertyOf(obj, "encode", rt.ToValue(encodeMethod)); err != nil {
		panic(rt.NewGoError(fmt.Errorf("defining encode read-only method on TextEncoder object: %w", err)))
	}

	// Set the encoding property
	if err := setReadOnlyPropertyOf(obj, "encoding", rt.ToValue(string(te.Encoding))); err != nil {
		panic(rt.NewGoError(fmt.Errorf("defining encoding read-only property on TextEncoder object: %w", err)))
	}

	return obj
}

func throwAsJSError(rt *goja.Runtime, err error) {
	var encErr *Error
	if errors.As(err, &encErr) {
		panic(encErr.JSError(rt))
	}

	panic(rt.NewGoError(err))
}

// setReadOnlyPropertyOf sets a read-only property on the given [goja.Object].
func setReadOnlyPropertyOf(obj *goja.Object, name string, value goja.Value) error {
	err := obj.DefineDataProperty(name,
		value,
		goja.FLAG_FALSE,
		goja.FLAG_FALSE,
		goja.FLAG_TRUE,
	)
	if err != nil {
		return fmt.Errorf("defining %s read-only property: %w", name, err)
	}

	return nil
}

// exportArrayBuffer interprets the given value as an ArrayBuffer, TypedArray or DataView
// and returns the underlying byte slice, backed by the original data (no copy is
// performed, per [goja.Runtime.ExportTo]'s documented behavior for these types).
func exportArrayBuffer(rt *goja.Runtime, v goja.Value) ([]byte, error) {
	if isNullish(v) {
		return []byte{}, nil
	}

	var data []byte
	if err := rt.ExportTo(v, &data); err != nil {
		return nil, errors.New("data is not an ArrayBuffer, typed array, or DataView")
	}

	return data, nil
}

func isNullish(v goja.Value) bool {
	return v == nil || goja.IsUndefined(v) || goja.IsNull(v)
}
