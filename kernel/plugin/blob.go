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
	"math"
	"reflect"
	"runtime"
	"strings"
	"time"

	"github.com/dop251/goja"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/plugin/encoding"
)

var (
	// blobStateType 用于在 Object.Export() 前先以 Object.ExportType() 做品牌判定，原因见 abortSignalStateType 的注释。
	blobStateType = reflect.TypeOf((*blobState)(nil))
	// arrayBufferExportType 是 ArrayBuffer 对象的导出类型，用于在不调用 Export() 的前提下识别 ArrayBuffer。
	arrayBufferExportType = reflect.TypeOf(goja.ArrayBuffer{})
)

var (
	// crlfReplacer 把 CRLF、单独的 CR 与单独的 LF 统一替换为 CRLF。
	crlfReplacer = newLineBreakReplacer("\r\n")
	// nativeLineBreakReplacer 把各种换行统一替换为平台换行符：Windows 为 CRLF，其他平台为 LF。
	nativeLineBreakReplacer = newLineBreakReplacer(lo.Ternary(runtime.GOOS == "windows", "\r\n", "\n"))
)

// newLineBreakReplacer 返回把 CRLF、单独的 CR 与单独的 LF 都替换为 lineBreak 的替换器；CRLF 排在最前，作为整体替换。
func newLineBreakReplacer(lineBreak string) *strings.Replacer {
	return strings.NewReplacer("\r\n", lineBreak, "\r", lineBreak, "\n", lineBreak)
}

// blobState 是 Blob 与 File 的宿主对象实现，isFile 为 true 时表示 File。字节序列构造后不再修改，可以在多个对象之间
// 共享（slice() 直接引用原数组的一段）；交给脚本的 ArrayBuffer 一律复制，避免脚本改写内核保留的数据。
type blobState struct {
	expandoProperties

	data []byte
	typ  string

	isFile       bool
	name         string
	lastModified int64 // 自 Unix 纪元起的毫秒数
}

// blobStateOf 取出 Blob（含 File）的宿主状态，只接受由本文件创建的对象。
func blobStateOf(value goja.Value) (*blobState, bool) {
	object, ok := value.(*goja.Object)
	if !ok || object.ExportType() != blobStateType {
		return nil, false
	}
	state, ok := object.Export().(*blobState)
	return state, ok
}

// newBlobObject 创建包装 state 的 Blob 或 File 对象。
func newBlobObject(rt *goja.Runtime, prototype *goja.Object, state *blobState) *goja.Object {
	object := rt.NewDynamicObject(state)
	lo.Must0(object.SetPrototype(prototype))
	return object
}

// blobPart 是 BlobPart 联合类型转换后的值：Blob、BufferSource（字节在处理各部分时才复制）或字符串。
type blobPart struct {
	blob   *blobState
	buffer *goja.Object
	text   string
}

// blobPropertyBag 是 BlobPropertyBag 字典转换后的值。
type blobPropertyBag struct {
	typ    string
	native bool // endings 为 "native"
}

// blobPartsOf 按 WebIDL 把值转换为 sequence<BlobPart>，各项依次按 Blob、ArrayBuffer、ArrayBuffer 视图、USVString 识别。
func (h *formDataHost) blobPartsOf(rt *goja.Runtime, value goja.Value, context string) (parts []blobPart) {
	iterateSequence(rt, value, context, func(element goja.Value) {
		if state, ok := blobStateOf(element); ok {
			parts = append(parts, blobPart{blob: state})
		} else if h.isBufferSource(element) {
			parts = append(parts, blobPart{buffer: element.(*goja.Object)})
		} else {
			parts = append(parts, blobPart{text: usvStringOf(rt, element)})
		}
	})
	return
}

// isBufferSource 判断值是不是 ArrayBuffer 或 ArrayBuffer 视图（TypedArray、DataView），不会触发对象上的访问器。
func (h *formDataHost) isBufferSource(value goja.Value) bool {
	object, ok := value.(*goja.Object)
	if !ok {
		return false
	}
	if object.ExportType() == arrayBufferExportType {
		return true
	}
	isView, err := h.isView(goja.Undefined(), object)
	return err == nil && isView.ToBoolean()
}

// bufferSourceBytes 返回 BufferSource 当前的字节（与引擎共享内存，调用方须自行复制），ArrayBuffer 已分离时返回空。
// 视图先经注册时捕获的内建 buffer 访问器取出其 ArrayBuffer，确认未分离后再导出：goja 导出已分离缓冲区上的视图
// 会触发 Go 运行时 panic，而不是抛出 JS 异常。
func (h *formDataHost) bufferSourceBytes(rt *goja.Runtime, object *goja.Object) []byte {
	if object.ExportType() == arrayBufferExportType {
		return object.Export().(goja.ArrayBuffer).Bytes()
	}

	buffer, err := h.typedArrayBuffer(object)
	if err != nil {
		// 调用方已用 ArrayBuffer.isView 判定过，不是 TypedArray 时只能是 DataView。
		if buffer, err = h.dataViewBuffer(object); err != nil {
			panic(err)
		}
	}
	if arrayBuffer, ok := buffer.Export().(goja.ArrayBuffer); !ok || arrayBuffer.Detached() {
		return nil
	}

	var view []byte
	if err := rt.ExportTo(object, &view); err != nil {
		panic(rt.NewTypeError("failed to read the bytes of a BufferSource: %v", err))
	}
	return view
}

// processBlobParts 按 File API 规范拼接各部分的字节：BufferSource 在此时才复制其当前内容（已分离的为空），
// 字符串按 UTF-8 编码，native 为 true 时先把字符串中的换行统一为平台换行符。
func (h *formDataHost) processBlobParts(rt *goja.Runtime, parts []blobPart, native bool) []byte {
	data := []byte{}
	for _, part := range parts {
		switch {
		case part.blob != nil:
			data = append(data, part.blob.data...)
		case part.buffer != nil:
			data = append(data, h.bufferSourceBytes(rt, part.buffer)...)
		default:
			text := part.text
			if native {
				text = nativeLineBreakReplacer.Replace(text)
			}
			data = append(data, text...)
		}
	}
	return data
}

// blobPropertyBagOf 按 WebIDL 转换 BlobPropertyBag：undefined 与 null 视为空字典，其他非对象值抛 TypeError，成员按
// 字典序读取（endings、type）。同时返回字典对象，供 File 随后读取 FilePropertyBag 自身的 lastModified。
func blobPropertyBagOf(rt *goja.Runtime, value goja.Value, context string) (blobPropertyBag, *goja.Object) {
	var bag blobPropertyBag
	if !isJsValueNotNull(value) {
		return bag, nil
	}
	dictionary, ok := value.(*goja.Object)
	if !ok {
		panic(rt.NewTypeError("%s: options can't be converted to a dictionary", context))
	}

	if endings := dictionary.Get("endings"); isJsValueNotUndefined(endings) {
		switch value := usvStringOf(rt, endings); value {
		case "transparent":
		case "native":
			bag.native = true
		default:
			panic(rt.NewTypeError("%s: '%s' (value of 'endings' member of BlobPropertyBag) is not a valid value for "+
				"enumeration EndingType", context, value))
		}
	}
	if typ := dictionary.Get("type"); isJsValueNotUndefined(typ) {
		bag.typ = usvStringOf(rt, typ)
	}
	return bag, dictionary
}

// normalizeBlobType 按 File API 规范规范化媒体类型：含 U+0020 到 U+007E 之外的字符时为空串，否则转为 ASCII 小写。
func normalizeBlobType(typ string) string {
	for i := 0; i < len(typ); i++ {
		if typ[i] < 0x20 || typ[i] > 0x7E {
			return ""
		}
	}
	return strings.ToLower(typ)
}

// relativeBlobPosition 按 slice blob 算法把 slice() 的 start 或 end 归一化到 [0, size]：负数从末尾倒数。
func relativeBlobPosition(position, size float64) float64 {
	if position < 0 {
		return math.Max(size+position, 0)
	}
	return math.Min(position, size)
}

// cloneBytes 复制字节切片，输入为空时也返回非 nil 切片。
func cloneBytes(data []byte) []byte {
	return append(make([]byte, 0, len(data)), data...)
}

// newBlobConstructor 构造 Blob 全局构造函数：new Blob(blobParts?, options?)。
func (h *formDataHost) newBlobConstructor(rt *goja.Runtime) *goja.Object {
	return newInterfaceConstructor(rt, "Blob", 0, h.blobPrototype, func(call goja.ConstructorCall) *goja.Object {
		var parts []blobPart
		if blobParts := call.Argument(0); !goja.IsUndefined(blobParts) {
			parts = h.blobPartsOf(rt, blobParts, "Blob constructor")
		}
		options, _ := blobPropertyBagOf(rt, call.Argument(1), "Blob constructor")
		state := &blobState{data: h.processBlobParts(rt, parts, options.native), typ: normalizeBlobType(options.typ)}
		return newBlobObject(rt, call.This.Prototype(), state)
	})
}

// newFileConstructor 构造继承自 Blob 的 File 全局构造函数：new File(fileBits, fileName, options?)。
func (h *formDataHost) newFileConstructor(rt *goja.Runtime, blobConstructor *goja.Object) *goja.Object {
	constructor := newInterfaceConstructor(rt, "File", 2, h.filePrototype, func(call goja.ConstructorCall) *goja.Object {
		if len(call.Arguments) < 2 {
			panic(rt.NewTypeError("File constructor: At least 2 arguments required, but only %d passed",
				len(call.Arguments)))
		}
		parts := h.blobPartsOf(rt, call.Arguments[0], "File constructor")
		name := usvStringOf(rt, call.Arguments[1])
		options, dictionary := blobPropertyBagOf(rt, call.Argument(2), "File constructor")
		lastModified := time.Now().UnixMilli()
		if dictionary != nil {
			if value := dictionary.Get("lastModified"); isJsValueNotUndefined(value) {
				lastModified = longLongOf(value)
			}
		}

		state := &blobState{
			data:         h.processBlobParts(rt, parts, options.native),
			typ:          normalizeBlobType(options.typ),
			isFile:       true,
			name:         name,
			lastModified: lastModified,
		}
		return newBlobObject(rt, call.This.Prototype(), state)
	})
	lo.Must0(constructor.SetPrototype(blobConstructor))
	return constructor
}

// newBlobPrototype 构造 Blob.prototype：size、type 访问器与 slice、text、arrayBuffer、bytes 方法。
// 沙箱没有 ReadableStream，因此不提供 stream()。
func (h *formDataHost) newBlobPrototype(rt *goja.Runtime) *goja.Object {
	prototype := rt.NewObject()

	self := func(call goja.FunctionCall, member string) *blobState {
		if state, ok := blobStateOf(call.This); ok {
			return state
		}
		panic(rt.NewTypeError("Blob.prototype.%s called on an incompatible receiver", member))
	}

	defineGetter(rt, prototype, "size", func(call goja.FunctionCall) goja.Value {
		return rt.ToValue(len(self(call, "size").data))
	})
	defineGetter(rt, prototype, "type", func(call goja.FunctionCall) goja.Value {
		return rt.ToValue(self(call, "type").typ)
	})

	defineMethod(rt, prototype, "slice", 0, func(call goja.FunctionCall) goja.Value {
		state := self(call, "slice")
		size := float64(len(state.data))
		relativeStart := 0.0
		if start := call.Argument(0); !goja.IsUndefined(start) {
			relativeStart = relativeBlobPosition(clampedLongLongOf(start), size)
		}
		relativeEnd := size
		if end := call.Argument(1); !goja.IsUndefined(end) {
			relativeEnd = relativeBlobPosition(clampedLongLongOf(end), size)
		}
		contentType := ""
		if value := call.Argument(2); !goja.IsUndefined(value) {
			contentType = normalizeBlobType(usvStringOf(rt, value))
		}

		start := int(relativeStart)
		end := start + int(math.Max(relativeEnd-relativeStart, 0))
		return newBlobObject(rt, h.blobPrototype, &blobState{data: state.data[start:end:end], typ: contentType})
	})

	// 读取方法返回 Promise：接收者不兼容时返回被拒绝的 Promise 而不是同步抛出（与 WebIDL 一致）。
	defineReader := func(name string, read func(state *blobState) (goja.Value, error)) {
		defineMethod(rt, prototype, name, 0, func(call goja.FunctionCall) goja.Value {
			promise, resolve, reject := rt.NewPromise()
			var settleErr error
			if state, ok := blobStateOf(call.This); !ok {
				settleErr = reject(rt.NewTypeError("Blob.prototype.%s called on an incompatible receiver", name))
			} else if value, err := read(state); err != nil {
				settleErr = reject(rt.NewGoError(err))
			} else {
				settleErr = resolve(value)
			}
			if settleErr != nil {
				logging.LogErrorf("Blob.prototype.%s: settle promise: %v", name, settleErr)
			}
			return rt.ToValue(promise)
		})
	}
	defineReader("text", func(state *blobState) (goja.Value, error) {
		// 与 TextDecoder 默认行为相同的 UTF-8 解码：去掉开头的 BOM，无效字节序列替换为 U+FFFD。
		decoder, err := encoding.NewTextDecoder("utf-8", encoding.TextDecoderOptions{})
		if err != nil {
			return nil, err
		}
		text, err := decoder.Decode(state.data, encoding.TextDecodeOptions{})
		if err != nil {
			return nil, err
		}
		return rt.ToValue(text), nil
	})
	defineReader("arrayBuffer", func(state *blobState) (goja.Value, error) {
		return rt.ToValue(rt.NewArrayBuffer(cloneBytes(state.data))), nil
	})
	defineReader("bytes", func(state *blobState) (goja.Value, error) {
		return rt.New(h.uint8Array, rt.ToValue(rt.NewArrayBuffer(cloneBytes(state.data))))
	})

	defineToStringTag(rt, prototype, "Blob")
	return prototype
}

// newFilePrototype 构造继承自 Blob.prototype 的 File.prototype：name 与 lastModified 访问器。
func (h *formDataHost) newFilePrototype(rt *goja.Runtime) *goja.Object {
	prototype := rt.NewObject()
	lo.Must0(prototype.SetPrototype(h.blobPrototype))

	self := func(call goja.FunctionCall, member string) *blobState {
		if state, ok := blobStateOf(call.This); ok && state.isFile {
			return state
		}
		panic(rt.NewTypeError("File.prototype.%s called on an incompatible receiver", member))
	}
	defineGetter(rt, prototype, "name", func(call goja.FunctionCall) goja.Value {
		return rt.ToValue(self(call, "name").name)
	})
	defineGetter(rt, prototype, "lastModified", func(call goja.FunctionCall) goja.Value {
		return rt.ToValue(self(call, "lastModified").lastModified)
	})

	defineToStringTag(rt, prototype, "File")
	return prototype
}
