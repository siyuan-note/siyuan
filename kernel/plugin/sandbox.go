// SiYuan - Refactor your thinking
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
	"fmt"
	"strconv"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/buffer"
	"github.com/dop251/goja_nodejs/console"
	"github.com/dop251/goja_nodejs/require"
	"github.com/dop251/goja_nodejs/url"
	"github.com/imroc/req/v3"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
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
	httpClient *req.Client = req.C().SetTimeout(time.Minute)
)

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

	registry := require.NewRegistry()

	registry.Enable(rt)
	registry.RegisterNativeModule(
		console.ModuleName,
		console.RequireWithPrinter(&Printer{name: p.Name}),
	)

	url.Enable(rt)
	buffer.Enable(rt)
	console.Enable(rt)
	return
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
	lo.Must0(injectClient(p, rt, siyuan))
	lo.Must0(injectServer(p, rt, siyuan))

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

// ObjectSetDataMethods attaches text(), json(), buffer() and arrayBuffer() methods to a JS object,
// each returning a Promise that resolves with the corresponding representation of data.
func ObjectSetDataMethods(p *KernelPlugin, rt *goja.Runtime, object *goja.Object, data []byte) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("ObjectSetDataMethods: %v", r)
		}
	}()

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
		}

		return rt.ToValue(promise)
	})))
	return
}

// NewDataObject creates a new JS object with text(), json(), buffer() and arrayBuffer() methods for the given data.
func NewDataObject(p *KernelPlugin, rt *goja.Runtime, data []byte) (*goja.Object, error) {
	obj := rt.NewObject()
	if err := ObjectSetDataMethods(p, rt, obj, data); err != nil {
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
		}

		thenValue := resultObj.Get("then")
		then, ok := goja.AssertFunction(thenValue)
		if !ok {
			callback(rt, &CallResult{Error: fmt.Errorf("'promise.then property is not a function")})
		}

		then(resultObj, rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) {
			// ⚠️ call.Arguments always is an empty array.
			promise, ok := result.(*goja.Promise)
			if ok {
				callback(rt, &CallResult{Value: promise.Result()})
			} else {
				callback(rt, &CallResult{Value: resultJs})
			}
		}), rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) {
			callback(rt, &CallResult{Error: fmt.Errorf("promise rejected: %v", call.Argument(0).Export())})
		}))
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

// isJsValueNotNull checks if a goja.Value is not nil, undefined or null.
func isJsValueNotNull(jsValue goja.Value) bool {
	return jsValue != nil && !goja.IsUndefined(jsValue) && !goja.IsNull(jsValue)
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
	if request.Request.Body.Data != nil {
		request.Request.Body.Data, err = NewDataObject(p, rt, *request.Request.Body.Data.(*[]byte))
		if err != nil {
			return
		}
	}

	// convert body form files data to js object
	if request.Request.Body.Form != nil {
		for _, fileList := range request.Request.Body.Form.File {
			for _, file := range fileList {
				if file.Data != nil {
					file.Data, err = NewDataObject(p, rt, *file.Data.(*[]byte))
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
