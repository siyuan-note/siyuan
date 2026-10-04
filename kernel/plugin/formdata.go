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

package plugin

import (
	"bytes"
	"crypto/rand"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"time"

	"github.com/dop251/goja"
	"github.com/samber/lo"
)

var (
	// formDataStateType 与 formDataIteratorStateType 用于在 Object.Export() 前先以 Object.ExportType() 做品牌判定，
	// 原因见 abortSignalStateType 的注释。
	formDataStateType         = reflect.TypeOf((*formDataState)(nil))
	formDataIteratorStateType = reflect.TypeOf((*formDataIteratorState)(nil))
)

// multipartNameEscaper 按 HTML 规范转义 Content-Disposition 的 name 与 filename 参数：只把 LF、CR、双引号替换为百分号编码。
var multipartNameEscaper = strings.NewReplacer("\n", "%0A", "\r", "%0D", `"`, "%22")

// formDataHost 保存注册时捕获的内建对象与 Blob、File、FormData 迭代器的原型，供各原生函数共享，
// 避免插件脚本事后改写 ArrayBuffer.isView、Uint8Array 等全局影响内部行为。
type formDataHost struct {
	isView           goja.Callable // ArrayBuffer.isView
	typedArrayBuffer goja.Callable // %TypedArray%.prototype.buffer 的 getter
	dataViewBuffer   goja.Callable // DataView.prototype.buffer 的 getter
	uint8Array       *goja.Object  // Uint8Array 构造函数

	blobPrototype             *goja.Object
	filePrototype             *goja.Object
	formDataIteratorPrototype *goja.Object
}

// EnableFormDataAPI 把 Blob、File 与 FormData 挂到 runtime 的 globalThis，调用方式与 url、buffer、console、encoding
// 一致，失败时 panic。FormData 的文件条目依赖 Blob 与 File，三者共享同一组原型，因此一起注册。返回的宿主状态供内核
// 在该 runtime 中创建 Blob 与 Uint8Array，见 ObjectSetDataMethods。
//
// 与规范的已知差异：不用 new 直接调用构造函数不会抛错（goja 的原生构造函数无法区分两种调用）；沙箱没有
// ReadableStream，Blob 不提供 stream()；沙箱没有 HTMLFormElement，FormData 构造函数的 form 参数只能省略或为
// undefined；实例可以添加自定义属性，但不能被冻结，也不能带自有的 Symbol 属性。
func EnableFormDataAPI(rt *goja.Runtime) *formDataHost {
	h, err := registerFormDataAPI(rt)
	if err != nil {
		panic(err)
	}
	return h
}

// registerFormDataAPI 捕获所需的内建对象，构造并挂载 Blob、File 与 FormData，返回宿主状态。
func registerFormDataAPI(rt *goja.Runtime) (h *formDataHost, err error) {
	defer func() {
		if r := recover(); r != nil {
			h, err = nil, fmt.Errorf("registerFormDataAPI: %v", r)
		}
	}()

	h = &formDataHost{}
	isView, ok := goja.AssertFunction(rt.Get("ArrayBuffer").ToObject(rt).Get("isView"))
	if !ok {
		return nil, fmt.Errorf("globalThis.ArrayBuffer.isView is not a function")
	}
	h.isView = isView
	h.uint8Array = rt.Get("Uint8Array").ToObject(rt)
	h.typedArrayBuffer = builtinGetter(rt, h.uint8Array.Get("prototype").ToObject(rt).Prototype(), "buffer")
	h.dataViewBuffer = builtinGetter(rt, rt.Get("DataView").ToObject(rt).Get("prototype").ToObject(rt), "buffer")

	h.blobPrototype = h.newBlobPrototype(rt)
	h.filePrototype = h.newFilePrototype(rt)
	h.formDataIteratorPrototype = h.newFormDataIteratorPrototype(rt)

	blobConstructor := h.newBlobConstructor(rt)
	lo.Must0(rt.Set("Blob", blobConstructor))
	lo.Must0(rt.Set("File", h.newFileConstructor(rt, blobConstructor)))
	lo.Must0(rt.Set("FormData", h.newFormDataConstructor(rt)))
	return
}

// formDataEntry 是 FormData 条目列表中的一项：file 非 nil 时为文件条目，值为该 File 对象；否则为字符串条目。
type formDataEntry struct {
	name  string
	value string

	file      *goja.Object
	fileState *blobState
}

// jsValue 返回条目的值：文件条目返回其 File 对象本身，字符串条目返回字符串。
func (e formDataEntry) jsValue(rt *goja.Runtime) goja.Value {
	if e.file != nil {
		return e.file
	}
	return rt.ToValue(e.value)
}

// formDataState 是 FormData 的宿主对象实现，条目列表只在事件循环线程上读写。
type formDataState struct {
	expandoProperties

	entries []formDataEntry
}

// formDataStateOf 取出 FormData 的宿主状态，只接受由本文件创建的对象。
func formDataStateOf(value goja.Value) (*formDataState, bool) {
	object, ok := value.(*goja.Object)
	if !ok || object.ExportType() != formDataStateType {
		return nil, false
	}
	state, ok := object.Export().(*formDataState)
	return state, ok
}

// formDataIteratorKind 区分 entries()、keys()、values() 返回的迭代器。
type formDataIteratorKind int

const (
	formDataIterateEntries formDataIteratorKind = iota
	formDataIterateKeys
	formDataIterateValues
)

// formDataIteratorState 是 FormData 迭代器的宿主对象实现：每次 next() 都按下标读取当前的条目列表，
// 迭代期间对 FormData 的增删会体现在后续结果中（与 WebIDL 一致）。
type formDataIteratorState struct {
	expandoProperties

	formData *formDataState
	kind     formDataIteratorKind
	index    int
}

// formDataIteratorStateOf 取出 FormData 迭代器的宿主状态，只接受由本文件创建的对象。
func formDataIteratorStateOf(value goja.Value) (*formDataIteratorState, bool) {
	object, ok := value.(*goja.Object)
	if !ok || object.ExportType() != formDataIteratorStateType {
		return nil, false
	}
	state, ok := object.Export().(*formDataIteratorState)
	return state, ok
}

// newFormDataConstructor 构造 FormData 全局构造函数：new FormData()。
func (h *formDataHost) newFormDataConstructor(rt *goja.Runtime) *goja.Object {
	prototype := h.newFormDataPrototype(rt)
	return newInterfaceConstructor(rt, "FormData", 0, prototype, func(call goja.ConstructorCall) *goja.Object {
		// 沙箱没有 HTMLFormElement，任何非 undefined 的 form 参数都无法转换。
		if !goja.IsUndefined(call.Argument(0)) {
			panic(rt.NewTypeError("FormData constructor: Argument 1 is not an HTMLFormElement; " +
				"form elements are not available in kernel plugins"))
		}
		object := rt.NewDynamicObject(&formDataState{})
		lo.Must0(object.SetPrototype(call.This.Prototype()))
		return object
	})
}

// formDataEntryOf 读取 append()/set() 的参数并按 HTML 规范的 create an entry 创建条目：参数不少于 3 个或值为 Blob 时
// 按 (name, blobValue, filename?) 重载处理，否则把值转换为 USVString。Blob 值转为 File：不是 File 时以 "blob" 为文件名，
// 给出 filename 时以其为文件名，类型保持不变，改名的 File 还保留 lastModified。
func (h *formDataHost) formDataEntryOf(rt *goja.Runtime, call goja.FunctionCall, method string) formDataEntry {
	if len(call.Arguments) < 2 {
		panic(rt.NewTypeError("FormData.%s: At least 2 arguments required, but only %d passed", method,
			len(call.Arguments)))
	}
	entry := formDataEntry{name: usvStringOf(rt, call.Arguments[0])}

	value := call.Arguments[1]
	blob, isBlob := blobStateOf(value)
	if !isBlob {
		if len(call.Arguments) >= 3 {
			panic(rt.NewTypeError("FormData.%s: Argument 2 is not a Blob", method))
		}
		entry.value = usvStringOf(rt, value)
		return entry
	}

	file := value.(*goja.Object)
	if filename := call.Argument(2); !goja.IsUndefined(filename) {
		lastModified := time.Now().UnixMilli()
		if blob.isFile {
			lastModified = blob.lastModified
		}
		blob = &blobState{data: blob.data, typ: blob.typ, isFile: true, name: usvStringOf(rt, filename),
			lastModified: lastModified}
		file = newBlobObject(rt, h.filePrototype, blob)
	} else if !blob.isFile {
		blob = &blobState{data: blob.data, typ: blob.typ, isFile: true, name: "blob",
			lastModified: time.Now().UnixMilli()}
		file = newBlobObject(rt, h.filePrototype, blob)
	}
	entry.file, entry.fileState = file, blob
	return entry
}

// newFormDataPrototype 构造 FormData.prototype：append、delete、get、getAll、has、set、entries、keys、values、forEach，
// 以及与 entries 为同一函数的 Symbol.iterator。
func (h *formDataHost) newFormDataPrototype(rt *goja.Runtime) *goja.Object {
	prototype := rt.NewObject()

	self := func(call goja.FunctionCall, method string) *formDataState {
		if state, ok := formDataStateOf(call.This); ok {
			return state
		}
		panic(rt.NewTypeError("FormData.prototype.%s called on an incompatible receiver", method))
	}
	nameOf := func(call goja.FunctionCall, method string) string {
		if len(call.Arguments) < 1 {
			panic(rt.NewTypeError("FormData.%s: At least 1 argument required, but only 0 passed", method))
		}
		return usvStringOf(rt, call.Arguments[0])
	}

	defineMethod(rt, prototype, "append", 2, func(call goja.FunctionCall) goja.Value {
		state := self(call, "append")
		state.entries = append(state.entries, h.formDataEntryOf(rt, call, "append"))
		return goja.Undefined()
	})
	defineMethod(rt, prototype, "delete", 1, func(call goja.FunctionCall) goja.Value {
		state := self(call, "delete")
		name := nameOf(call, "delete")
		state.entries = slices.DeleteFunc(state.entries, func(entry formDataEntry) bool { return entry.name == name })
		return goja.Undefined()
	})
	defineMethod(rt, prototype, "get", 1, func(call goja.FunctionCall) goja.Value {
		state := self(call, "get")
		name := nameOf(call, "get")
		for _, entry := range state.entries {
			if entry.name == name {
				return entry.jsValue(rt)
			}
		}
		return goja.Null()
	})
	defineMethod(rt, prototype, "getAll", 1, func(call goja.FunctionCall) goja.Value {
		state := self(call, "getAll")
		name := nameOf(call, "getAll")
		values := []any{}
		for _, entry := range state.entries {
			if entry.name == name {
				values = append(values, entry.jsValue(rt))
			}
		}
		return rt.NewArray(values...)
	})
	defineMethod(rt, prototype, "has", 1, func(call goja.FunctionCall) goja.Value {
		state := self(call, "has")
		name := nameOf(call, "has")
		return rt.ToValue(slices.ContainsFunc(state.entries, func(entry formDataEntry) bool { return entry.name == name }))
	})
	defineMethod(rt, prototype, "set", 2, func(call goja.FunctionCall) goja.Value {
		state := self(call, "set")
		entry := h.formDataEntryOf(rt, call, "set")
		index := slices.IndexFunc(state.entries, func(existing formDataEntry) bool { return existing.name == entry.name })
		if index < 0 {
			state.entries = append(state.entries, entry)
			return goja.Undefined()
		}
		// 替换第一个同名条目，并移除其后的其他同名条目。
		state.entries[index] = entry
		rest := slices.DeleteFunc(state.entries[index+1:], func(existing formDataEntry) bool {
			return existing.name == entry.name
		})
		state.entries = state.entries[:index+1+len(rest)]
		return goja.Undefined()
	})

	newIterator := func(kind formDataIteratorKind, method string) func(goja.FunctionCall) goja.Value {
		return func(call goja.FunctionCall) goja.Value {
			object := rt.NewDynamicObject(&formDataIteratorState{formData: self(call, method), kind: kind})
			lo.Must0(object.SetPrototype(h.formDataIteratorPrototype))
			return object
		}
	}
	entries := newMethod(rt, "entries", 0, newIterator(formDataIterateEntries, "entries"))
	lo.Must0(prototype.DefineDataProperty("entries", entries, goja.FLAG_TRUE, goja.FLAG_TRUE, goja.FLAG_TRUE))
	defineMethod(rt, prototype, "keys", 0, newIterator(formDataIterateKeys, "keys"))
	defineMethod(rt, prototype, "values", 0, newIterator(formDataIterateValues, "values"))
	defineMethod(rt, prototype, "forEach", 1, func(call goja.FunctionCall) goja.Value {
		state := self(call, "forEach")
		callback, ok := goja.AssertFunction(call.Argument(0))
		if !ok {
			panic(rt.NewTypeError("FormData.forEach: Argument 1 is not callable"))
		}
		thisArg := call.Argument(1)
		// 每轮都重新读取条目列表：回调中的增删会影响后续迭代（与 WebIDL 一致）。
		for i := 0; i < len(state.entries); i++ {
			entry := state.entries[i]
			if _, err := callback(thisArg, entry.jsValue(rt), rt.ToValue(entry.name), call.This); err != nil {
				panic(err)
			}
		}
		return goja.Undefined()
	})
	lo.Must0(prototype.DefineDataPropertySymbol(goja.SymIterator, entries, goja.FLAG_TRUE, goja.FLAG_TRUE,
		goja.FLAG_FALSE))

	defineToStringTag(rt, prototype, "FormData")
	return prototype
}

// newFormDataIteratorPrototype 构造 FormData 迭代器的原型：继承 %IteratorPrototype%，提供 next 与 Symbol.toStringTag。
func (h *formDataHost) newFormDataIteratorPrototype(rt *goja.Runtime) *goja.Object {
	prototype := rt.NewObject()
	lo.Must0(prototype.SetPrototype(iteratorPrototypeOf(rt)))

	defineMethod(rt, prototype, "next", 0, func(call goja.FunctionCall) goja.Value {
		state, ok := formDataIteratorStateOf(call.This)
		if !ok {
			panic(rt.NewTypeError("FormData Iterator.prototype.next called on an incompatible receiver"))
		}

		result := rt.NewObject()
		if state.index >= len(state.formData.entries) {
			lo.Must0(result.Set("value", goja.Undefined()))
			lo.Must0(result.Set("done", true))
			return result
		}
		entry := state.formData.entries[state.index]
		state.index++

		var value goja.Value
		switch state.kind {
		case formDataIterateKeys:
			value = rt.ToValue(entry.name)
		case formDataIterateValues:
			value = entry.jsValue(rt)
		default:
			value = rt.NewArray(entry.name, entry.jsValue(rt))
		}
		lo.Must0(result.Set("value", value))
		lo.Must0(result.Set("done", false))
		return result
	})

	defineToStringTag(rt, prototype, "FormData Iterator")
	return prototype
}

// encodeMultipart 按 HTML 规范的 multipart/form-data 编码算法把条目序列化为 UTF-8 请求体，字节格式与浏览器、
// Node.js（undici）一致：名称与字符串值中的 CR、LF 先统一为 CRLF，名称与文件名再转义 LF、CR、双引号；
// 文件条目带 filename 与 Content-Type（类型为空时为 application/octet-stream），字符串条目不带 Content-Type。
// 返回请求体以及带 boundary 参数的 Content-Type。
func (s *formDataState) encodeMultipart() (body []byte, contentType string) {
	boundary := "----formdata-siyuan-" + rand.Text()

	var buffer bytes.Buffer
	for _, entry := range s.entries {
		buffer.WriteString("--" + boundary + "\r\n")
		buffer.WriteString(`Content-Disposition: form-data; name="` +
			multipartNameEscaper.Replace(crlfReplacer.Replace(entry.name)) + `"`)
		if entry.fileState == nil {
			buffer.WriteString("\r\n\r\n" + crlfReplacer.Replace(entry.value) + "\r\n")
			continue
		}

		fileType := entry.fileState.typ
		if fileType == "" {
			fileType = "application/octet-stream"
		}
		buffer.WriteString(`; filename="` + multipartNameEscaper.Replace(entry.fileState.name) + `"` +
			"\r\nContent-Type: " + fileType + "\r\n\r\n")
		buffer.Write(entry.fileState.data)
		buffer.WriteString("\r\n")
	}
	buffer.WriteString("--" + boundary + "--\r\n")
	return buffer.Bytes(), "multipart/form-data; boundary=" + boundary
}
