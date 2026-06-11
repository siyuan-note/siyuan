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
	"fmt"

	"github.com/dop251/goja"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// injectRpc adds siyuan.rpc method for RPC method registration.
func injectRpc(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectRpc: %v", r)
		}
	}()

	rpc := rt.NewObject()

	lo.Must0(rpc.Set("bind", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error
		var name string
		var method goja.Callable
		var descriptions []string
		if len(call.Arguments) < 2 {
			argErr = fmt.Errorf("method name and function required")
		} else {
			nameArg := call.Argument(0)
			methodArg := call.Argument(1)
			descArgs := call.Arguments[2:]
			if goja.IsString(nameArg) {
				name = nameArg.String()
			} else {
				argErr = fmt.Errorf("first argument must be method name string")
			}
			if argErr == nil {
				if methodJs, ok := goja.AssertFunction(methodArg); ok {
					method = methodJs
				} else {
					argErr = fmt.Errorf("second argument must be a function")
				}
			}
			if argErr == nil {
				descriptions = make([]string, len(descArgs))
				for i, a := range descArgs {
					descriptions[i] = a.String()
				}
			}
		}

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if argErr != nil {
				err = argErr
				return
			}
			err = p.bindRpcMethod(name, method, descriptions...)
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.rpc.bind resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.rpc.bind reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.rpc.bind worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.rpc.bind reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(rpc.Set("unbind", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error
		var name string
		if len(call.Arguments) < 1 {
			argErr = fmt.Errorf("method name required")
		} else if nameArg := call.Argument(0); goja.IsString(nameArg) {
			name = nameArg.String()
		} else {
			argErr = fmt.Errorf("first argument must be method name string")
		}

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if argErr != nil {
				err = argErr
				return
			}
			err = p.unbindRpcMethod(name)
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.rpc.unbind resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.rpc.unbind reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.rpc.unbind worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.rpc.unbind reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(rpc.Set("broadcast", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error
		var method string
		var params util.Optional[any]
		if len(call.Arguments) < 1 {
			argErr = fmt.Errorf("method required")
		} else {
			if m := call.Argument(0); goja.IsString(m) {
				method = m.String()
			} else {
				argErr = fmt.Errorf("first argument must be method name string")
			}
			if argErr == nil {
				arg := call.Argument(1)
				if goja.IsUndefined(arg) {
					params.Value = nil
					params.Exists = false
					params.IsNull = false
				} else if goja.IsNull(arg) {
					params.Value = nil
					params.Exists = true
					params.IsNull = true
				} else {
					params.Value = arg.Export()
					params.Exists = true
					params.IsNull = false
				}
			}
		}

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if argErr != nil {
				err = argErr
				return
			}
			p.BroadcastNotification(method, params)
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.rpc.broadcast resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.rpc.broadcast reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.rpc.broadcast worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.rpc.broadcast reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(ObjectFreeze(rt, rpc))

	lo.Must0(siyuan.Set("rpc", rpc))
	return
}
