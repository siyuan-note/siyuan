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
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/buffer"
	"github.com/dop251/goja_nodejs/console"
	"github.com/dop251/goja_nodejs/require"
	"github.com/dop251/goja_nodejs/url"
	"github.com/imroc/req/v3"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/plugin/encoding"
)

type WebSocketState int64

const (
	WebSocketReadyStateConnecting WebSocketState = iota
	WebSocketReadyStateOpen
	WebSocketReadyStateClosing
	WebSocketReadyStateClosed
)

type EventSourceState int64

const (
	EventSourceConnecting EventSourceState = iota
	EventSourceOpen
	EventSourceClosed
)

var (
	// 请求时限由 siyuan.client.fetch 按请求设置；req.C() 默认 2 分钟的整体超时会截断更长的时限，因此关闭。
	httpClient *req.Client = req.C().SetTimeout(0)

	// fetchDefaultTimeout 是 siyuan.client.fetch 未指定 timeout 时的请求时限。
	fetchDefaultTimeout = time.Minute
)

type Promise struct {
	Resolve func(reason interface{}) error
	Reject  func(reason interface{}) error
}

type FunctionResult[T any] struct {
	Value T
	Error error
}

type CallResult FunctionResult[goja.Value]

func (r *CallResult) TaskResult() *TaskResult {
	if r.Error != nil {
		return &TaskResult{err: r.Error}
	}
	return &TaskResult{value: r.Value.Export()}
}

// EnableExtendModules registers extended modules (e.g. url, buffer) to the plugin's goja runtime.
func EnableExtendModules(p *KernelPlugin, rt *goja.Runtime) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("failed to enable extend modules: %v", r)
		}
	}()

	registry := require.NewRegistry(require.WithLoader(pluginSourceLoader(p)))

	registry.Enable(rt)
	registry.RegisterNativeModule(
		console.ModuleName,
		console.RequireWithPrinter(&Printer{name: p.Name}),
	)

	url.Enable(rt)
	buffer.Enable(rt)
	console.Enable(rt)
	encoding.Enable(rt)
	EnableAbortAPI(rt)
	p.formDataHost = EnableFormDataAPI(rt)
	return
}

// pluginSourceLoader 返回 require 的源码加载器，只读取插件目录（kernel.js 所在目录）内的普通文件。
// require 以调用方脚本名为基准解析相对路径，kernel.js 的脚本名是 p.file，因此 p.file 所在目录对应插件目录；
// 绝对路径、越出插件目录的路径以及向上查找到的 node_modules 都视为模块文件不存在，解析器会继续尝试其他候选路径。
// 文件经插件目录句柄打开，指向插件目录之外的符号链接无法读取。
func pluginSourceLoader(p *KernelPlugin) require.SourceLoader {
	prefix := filepath.Dir(p.file) + string(filepath.Separator)
	return func(name string) ([]byte, error) {
		rel, ok := strings.CutPrefix(name, prefix)
		if !ok || !filepath.IsLocal(rel) {
			return nil, require.ModuleFileDoesNotExistError
		}

		root, err := os.OpenRoot(p.pluginDir)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil, require.ModuleFileDoesNotExistError
			}
			return nil, err
		}
		defer root.Close()

		file, err := root.Open(rel)
		if err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return nil, require.ModuleFileDoesNotExistError
			}
			return nil, err
		}
		defer file.Close()

		info, err := file.Stat()
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, require.ModuleFileDoesNotExistError
		}
		return io.ReadAll(file)
	}
}

// EnableSiyuanModule injects all siyuan.* APIs into the plugin's goja global context.
func EnableSiyuanModule(p *KernelPlugin, rt *goja.Runtime) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("failed to inject global context: %v", r)
		}
	}()

	siyuan := rt.NewObject()

	lo.Must0(injectPlugin(p, rt, siyuan))
	lo.Must0(injectEvent(p, rt, siyuan))
	lo.Must0(injectLogger(p, rt, siyuan))
	lo.Must0(injectStorage(p, rt, siyuan))
	lo.Must0(injectRpc(p, rt, siyuan))
	lo.Must0(injectAgent(p, rt, siyuan))
	lo.Must0(injectClient(p, rt, siyuan))
	lo.Must0(injectServer(p, rt, siyuan))
	lo.Must0(injectSecretsVars(p, rt, siyuan))
	lo.Must0(injectCrypto(p, rt, siyuan))

	lo.Must0(ObjectFreeze(rt, siyuan))

	lo.Must0(rt.GlobalObject().Set("siyuan", siyuan))
	return
}

// ObjectFreeze calls Object.freeze() on the given goja object.
func ObjectFreeze(rt *goja.Runtime, obj *goja.Object) error {
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

// ObjectSeal calls Object.seal() on the given goja object.
func ObjectSeal(rt *goja.Runtime, obj *goja.Object) error {
	Object := rt.GlobalObject().Get("Object").ToObject(rt)
	if Object == nil {
		return fmt.Errorf("globalThis.Object is not an object")
	}

	seal, ok := goja.AssertFunction(Object.Get("seal"))
	if !ok {
		return fmt.Errorf("globalThis.Object.seal is not a function")
	}

	_, err := seal(Object, obj)
	return err
}

// ObjectSetDataMethods 给 JS 对象添加 text()、json()、buffer()、arrayBuffer()、bytes() 与 blob() 方法，各方法返回以
// data 的相应形式完成的 Promise。buffer()、arrayBuffer() 与 bytes() 的结果直接引用 data，不做复制；blob()
// 返回 data 的副本，脚本修改其他方法的结果不会改变 Blob 的内容，Blob 的 type 是按 Blob 构造函数的 type 选项
// 规范化后的 contentType（不按 MIME 类型解析）。
func ObjectSetDataMethods(p *KernelPlugin, rt *goja.Runtime, object *goja.Object, data []byte, contentType string) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("ObjectSetDataMethods: %v", r)
		}
	}()

	// 使用注册时捕获的 Blob 原型与 Uint8Array 构造函数，插件脚本改写同名全局不影响返回的对象。
	host := p.formDataHost
	blobType := normalizeBlobType(contentType)

	lo.Must0(object.Set("text", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			result = string(data)
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] data.text() resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] data.text() reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] text worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] data.text() reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))
	lo.Must0(object.Set("json", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			var value any
			if unmarshalErr := json.Unmarshal(data, &value); unmarshalErr != nil {
				err = unmarshalErr
				return
			}

			result = rt.ToValue(value)
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] data.json() resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] data.json() reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] json worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] data.json() reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))
	lo.Must0(object.Set("buffer", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			result = buffer.WrapBytes(rt, data)
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(rt.ToValue(result)); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] data.buffer() resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] data.buffer() reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] buffer worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] data.buffer() reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))
	lo.Must0(object.Set("arrayBuffer", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			result = rt.NewArrayBuffer(data)
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(rt.ToValue(result)); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] data.arrayBuffer() resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] data.arrayBuffer() reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] arrayBuffer worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] data.arrayBuffer() reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))
	lo.Must0(object.Set("bytes", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			result, err = rt.New(host.uint8Array, rt.ToValue(rt.NewArrayBuffer(data)))
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(rt.ToValue(result)); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] data.bytes() resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] data.bytes() reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] bytes worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] data.bytes() reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))
	lo.Must0(object.Set("blob", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			result = newBlobObject(rt, host.blobPrototype, &blobState{data: cloneBytes(data), typ: blobType})
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(rt.ToValue(result)); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] data.blob() resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] data.blob() reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] blob worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] data.blob() reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))
	return
}

// NewDataObject 创建带有 ObjectSetDataMethods 所述数据方法的 JS 对象，contentType 为 blob() 返回的 Blob 的媒体类型。
func NewDataObject(p *KernelPlugin, rt *goja.Runtime, data []byte, contentType string) (*goja.Object, error) {
	obj := rt.NewObject()
	if err := ObjectSetDataMethods(p, rt, obj, data, contentType); err != nil {
		return nil, err
	}
	return obj, nil
}

// getJsContextValue safely retrieves a nested value from the plugin's JS context, returning nil if any step fails.
func getJsContextValue(rt *goja.Runtime, paths []any) (value goja.Value, err error) {
	var cursor goja.Value = rt.GlobalObject()
	var path string = "globalThis"

	for _, key := range paths {
		if cursor == nil {
			err = fmt.Errorf("path %v: value is nil", key)
			return
		}

		if goja.IsUndefined(cursor) || goja.IsNull(cursor) {
			err = fmt.Errorf("path %v: value is %s", key, cursor.String())
			return
		}

		obj := cursor.ToObject(rt)
		if obj == nil {
			err = fmt.Errorf("path %v: expected object, got %T", key, cursor)
			return
		}

		switch k := key.(type) {
		case string:
			cursor = obj.Get(k)
			path = fmt.Sprintf("%s.%s", path, k)
		case int:
			cursor = obj.Get(strconv.Itoa(k))
			path = fmt.Sprintf("%s[%d]", path, k)
		default:
			err = fmt.Errorf("unsupported path type: %T", key)
			return
		}
	}
	value = cursor
	return
}

// dispatchEvent calls the globalThis.siyuan.event.on hook with the given event object.
func dispatchEvent(p *KernelPlugin, rt *goja.Runtime, e any) (async bool, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("goja panic during dispatchEvent: %v", r)
		}
	}()

	event, err := getJsContextValue(rt, []any{"siyuan", "event"})
	if err != nil {
		return
	}
	if event == nil {
		err = fmt.Errorf("globalThis.siyuan.event not found")
		return
	}
	if goja.IsUndefined(event) || goja.IsNull(event) {
		err = fmt.Errorf("globalThis.siyuan.event is %s", event.String())
		return
	}

	eventObj := event.ToObject(rt)
	if eventObj == nil {
		err = fmt.Errorf("globalThis.siyuan.event is not an object")
		return
	}

	handlerValue := eventObj.Get("handler")
	handler, ok := goja.AssertFunction(handlerValue)
	if !ok {
		return
	}

	eventJs := rt.ToValue(e)
	invokeResult, invokeErr := handler(event, eventJs)
	if invokeErr != nil {
		err = invokeErr
		return
	}

	async = isJsPromise(invokeResult)
	return
}

// invokeFunction calls a goja.Callable with the given this and arguments, handling both synchronous return values and Promises.
func invokeFunction(callback func(rt *goja.Runtime, result *CallResult), rt *goja.Runtime, async bool, fn goja.Callable, this goja.Value, args ...goja.Value) {
	resultJs, invokeErr := fn(this, args...)
	if callback == nil {
		return
	}

	if invokeErr != nil {
		callback(rt, &CallResult{Error: invokeErr})
		return
	}

	result := resultJs.Export()
	if isGoPromise(result) {
		if !async {
			panic(fmt.Errorf("synchronous function returned a Promise"))
		}
		resultObj := resultJs.ToObject(rt)
		if resultObj == nil {
			callback(rt, &CallResult{Error: fmt.Errorf("expected promise object, got %T", result)})
			return
		}

		thenValue := resultObj.Get("then")
		then, ok := goja.AssertFunction(thenValue)
		if !ok {
			callback(rt, &CallResult{Error: fmt.Errorf("'promise.then property is not a function")})
			return
		}

		// 在 Promise 吸收回调异常前，将转换错误交回调用方。
		runCallback := func(fn func()) {
			defer func() {
				if r := recover(); r != nil {
					callback(rt, &CallResult{Error: fmt.Errorf("promise callback panicked: %v", r)})
				}
			}()
			fn()
		}

		// 使用 Goja 原生函数签名接收 Promise 的完成值和拒绝原因。
		_, thenErr := then(resultObj, rt.ToValue(func(call goja.FunctionCall) goja.Value {
			runCallback(func() {
				callback(rt, &CallResult{Value: call.Argument(0)})
			})
			return goja.Undefined()
		}), rt.ToValue(func(call goja.FunctionCall) goja.Value {
			runCallback(func() {
				reason := call.Argument(0).Export()
				// Error 的 message 通常不可枚举，导出对象时需保留其错误文本。
				if object, ok := call.Argument(0).(*goja.Object); ok && object.ClassName() == "Error" {
					reason = object.String()
				}
				callback(rt, &CallResult{Error: fmt.Errorf("promise rejected: %v", reason)})
			})
			return goja.Undefined()
		}))
		if thenErr != nil {
			callback(rt, &CallResult{Error: thenErr})
		}
	} else {
		callback(rt, &CallResult{Value: resultJs})
	}
}

// isJsPromise checks if a goja.Value is a JavaScript Promise.
func isJsPromise(jsValue goja.Value) bool {
	if jsValue == nil {
		return false
	}

	goValue := jsValue.Export()
	return isGoPromise(goValue)
}

// isGoPromise checks if a Go value is a *goja.Promise.
func isGoPromise(goValue any) bool {
	if goValue == nil {
		return false
	}

	_, ok := goValue.(*goja.Promise)
	return ok
}

// isJsArray checks if a goja.Value is a JavaScript Array.
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

// isJsObjectArray checks if a goja.Object is a JavaScript Array by inspecting its class name.
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

// isJsValueNotUndefined checks if a goja.Value is not nil and not undefined.
func isJsValueNotUndefined(jsValue goja.Value) bool {
	return jsValue != nil && !goja.IsUndefined(jsValue)
}

// isJsValueNotNull checks if a goja.Value is not nil, undefined or null.
func isJsValueNotNull(jsValue goja.Value) bool {
	return isJsValueNotUndefined(jsValue) && !goja.IsNull(jsValue)
}

// jsValueToBytes attempts to convert a goja.Value to a byte slice, supporting string, Buffer, ArrayBuffer, etc.
func jsValueToBytes(rt *goja.Runtime, value goja.Value) (data []byte, err error) {
	if goValue := value.Export(); goValue != nil {
		switch d := goValue.(type) {
		case string: // string
			data = []byte(d)
		case []byte: // Buffer
			data = d
		case goja.ArrayBuffer: // ArrayBuffer
			data = d.Bytes()
		case buffer.Buffer: // ?
			data = buffer.Bytes(rt, value)
		default:
			err = fmt.Errorf("unsupported data type: %T", goValue)
		}
		return
	}
	err = fmt.Errorf("js value cannot be exported to a valid Go value")
	return
}

// getRequestHandler retrieves the handler function and its containing object for a given scope and request type from the plugin's JS context.
func getRequestHandler(rt *goja.Runtime, scope AccessScope, requestType RequestType) (handler goja.Callable, handlerObj *goja.Object, err error) {
	// Get handler object: siyuan.server[scope][requestType]
	handlerObjValue, getObjErr := getJsContextValue(rt, []any{"siyuan", "server", string(scope), string(requestType)})
	if getObjErr != nil {
		err = getObjErr
		return
	}

	handlerObj = handlerObjValue.ToObject(rt)
	if handlerObj == nil {
		err = fmt.Errorf("globalThis.siyuan.server[%s][%s] is not an object", scope, requestType)
		return
	}

	// Get handler: siyuan.server[scope][requestType].handler
	handlerValue := handlerObj.Get("handler")
	if !isJsValueNotNull(handlerValue) {
		err = fmt.Errorf("siyuan.server[%s][%s].handler is not set", scope, requestType)
		return
	}

	handler, ok := goja.AssertFunction(handlerValue)
	if !ok {
		err = fmt.Errorf("siyuan.server[%s][%s].handler is not a function", scope, requestType)
		return
	}

	return
}

// requestGoToJs converts a Go Request to a JavaScript value.
func requestGoToJs(p *KernelPlugin, rt *goja.Runtime, request *Request) (jsRequest goja.Value, err error) {
	// convert body raw data to js object
	if data, ok := request.Request.Body.Data.(*[]byte); ok && data != nil {
		contentType := http.Header(request.Request.Headers).Get("Content-Type")
		request.Request.Body.Data, err = NewDataObject(p, rt, *data, contentType)
		if err != nil {
			return
		}
	}

	// convert body form files data to js object
	if request.Request.Body.Form != nil {
		for _, fileList := range request.Request.Body.Form.File {
			for _, file := range fileList {
				if data, ok := file.Data.(*[]byte); ok && data != nil {
					contentType := http.Header(file.Headers).Get("Content-Type")
					file.Data, err = NewDataObject(p, rt, *data, contentType)
					if err != nil {
						return
					}
				}
			}
		}
	}

	jsRequest = rt.ToValue(request)
	return
}
