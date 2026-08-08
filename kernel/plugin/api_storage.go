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
	"path/filepath"
	"strings"

	"github.com/dop251/goja"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// injectStorage adds siyuan.storage.* methods for scoped file CRUD.
func injectStorage(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectStorage: %v", r)
		}
	}()

	resolvePath := func(relPath string) (abs string, err error) {
		abs = filepath.Join(p.storageDir, filepath.Clean(relPath))
		if !(abs == p.storageDir || strings.HasPrefix(abs, p.storageDir+string(filepath.Separator))) {
			err = fmt.Errorf("siyuan.storage: path traversal not allowed")
		}
		return
	}

	watcher := rt.NewObject()

	// siyuan.storage.watcher.add(path) -> Promise<void>
	lo.Must0(watcher.Set("add", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error
		var path string
		if len(call.Arguments) >= 1 && goja.IsString(call.Argument(0)) {
			path = call.Argument(0).String()
		} else {
			argErr = fmt.Errorf("path required")
		}

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if argErr != nil {
				err = argErr
				return
			}
			abs, resolveErr := resolvePath(path)
			if resolveErr != nil {
				err = resolveErr
				return
			}
			if addErr := p.addStorageWatch(abs); addErr != nil {
				err = fmt.Errorf("failed to add storage path to watcher: %v", addErr)
			}
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.watcher.add resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.watcher.add reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.storage.watcher.add worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.storage.watcher.add reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	// siyuan.storage.watcher.remove(path) -> void
	lo.Must0(watcher.Set("remove", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error
		var path string
		if len(call.Arguments) >= 1 && goja.IsString(call.Argument(0)) {
			path = call.Argument(0).String()
		} else {
			argErr = fmt.Errorf("path required")
		}

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if argErr != nil {
				err = argErr
				return
			}
			abs, resolveErr := resolvePath(path)
			if resolveErr != nil {
				err = resolveErr
				return
			}
			if removeErr := p.removeStorageWatch(abs); removeErr != nil {
				err = fmt.Errorf("failed to remove storage path from watcher: %v", removeErr)
			}
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.watcher.remove resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.watcher.remove reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.storage.watcher.remove worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.storage.watcher.remove reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(ObjectFreeze(rt, watcher))

	storage := rt.NewObject()

	// siyuan.storage.get(path) -> Promise<{text, json, arrayBuffer}>
	lo.Must0(storage.Set("get", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error
		var path string
		if len(call.Arguments) >= 1 && goja.IsString(call.Argument(0)) {
			path = call.Argument(0).String()
		} else {
			argErr = fmt.Errorf("path required")
		}

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if argErr != nil {
				err = argErr
				return
			}
			go func() (result []byte, err error) {
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("panic during siyuan.storage.get: %v", r)
					}
					operationResult, operationErr := result, err
					p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
						if operationErr != nil {
							return nil, operationErr
						}

						content := rt.NewObject()
						if dataErr := ObjectSetDataMethods(p, rt, content, operationResult); dataErr != nil {
							return nil, dataErr
						}

						return content, nil
					}, func(rt *goja.Runtime, result any, err error) {
						if lo.IsNil(err) {
							if resolveErr := resolve(result); resolveErr != nil {
								logging.LogErrorf("[plugin:%s] siyuan.storage.get resolve: %v", p.Name, resolveErr)
							}
						} else {
							if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
								logging.LogErrorf("[plugin:%s] siyuan.storage.get reject: %v", p.Name, rejectErr)
							}
						}
					})
				}()

				result, err = p.storageGet(path)
				return
			}()

			return
		}, func(rt *goja.Runtime, result any, err error) {
			if !lo.IsNil(err) {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.get reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.storage.get worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.storage.get reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	// siyuan.storage.put(path, content) -> Promise<void>
	lo.Must0(storage.Set("put", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error
		var path, content string
		if len(call.Arguments) < 2 {
			argErr = fmt.Errorf("path and content required")
		} else {
			path = call.Argument(0).String()
			content = call.Argument(1).String()
		}

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if argErr != nil {
				err = argErr
				return
			}
			if util.ReadOnly {
				err = fmt.Errorf("The current kernel is in read-only mode, storage.put is not allowed")
				return
			}

			go func() (result any, err error) {
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("panic during siyuan.storage.put: %v", r)
					}

					operationResult, operationErr := result, err
					p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
						if lo.IsNil(operationErr) {
							if resolveErr := resolve(operationResult); resolveErr != nil {
								logging.LogErrorf("[plugin:%s] siyuan.storage.put resolve: %v", p.Name, resolveErr)
							}
						} else {
							if rejectErr := reject(rt.NewGoError(operationErr)); rejectErr != nil {
								logging.LogErrorf("[plugin:%s] siyuan.storage.put reject: %v", p.Name, rejectErr)
							}
						}
						return
					}, nil)
				}()

				if writeErr := p.storagePut(path, []byte(content)); writeErr != nil {
					err = fmt.Errorf("failed to write file: %w", writeErr)
					return
				}
				return
			}()

			return
		}, func(rt *goja.Runtime, result any, err error) {
			if !lo.IsNil(err) {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.put reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.storage.put worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.storage.put reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	// siyuan.storage.remove(path) -> Promise<void>
	lo.Must0(storage.Set("remove", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error
		var path string
		if len(call.Arguments) < 1 {
			argErr = fmt.Errorf("path required")
		} else {
			path = call.Argument(0).String()
		}

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if argErr != nil {
				err = argErr
				return
			}
			if util.ReadOnly {
				err = fmt.Errorf("The current kernel is in read-only mode, storage.remove is not allowed")
				return
			}

			go func() (result any, err error) {
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("panic during siyuan.storage.remove: %v", r)
					}

					operationResult, operationErr := result, err
					p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
						if lo.IsNil(operationErr) {
							if resolveErr := resolve(operationResult); resolveErr != nil {
								logging.LogErrorf("[plugin:%s] siyuan.storage.remove resolve: %v", p.Name, resolveErr)
							}
						} else {
							if rejectErr := reject(rt.NewGoError(operationErr)); rejectErr != nil {
								logging.LogErrorf("[plugin:%s] siyuan.storage.remove reject: %v", p.Name, rejectErr)
							}
						}
						return
					}, nil)
				}()

				if removeErr := p.storageRemove(path); removeErr != nil {
					err = fmt.Errorf("failed to remove: %w", removeErr)
					return
				}
				return
			}()

			return
		}, func(rt *goja.Runtime, result any, err error) {
			if !lo.IsNil(err) {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.remove reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.storage.remove worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.storage.remove reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	// siyuan.storage.list(path) -> Promise<Entry[]>
	lo.Must0(storage.Set("list", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error
		var path string
		if len(call.Arguments) < 1 {
			argErr = fmt.Errorf("path required")
		} else {
			path = call.Argument(0).String()
		}

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if argErr != nil {
				err = argErr
				return
			}

			go func() (result any, err error) {
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("panic during siyuan.storage.list: %v", r)
					}
					operationResult, operationErr := result, err
					p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
						if lo.IsNil(operationErr) {
							if resolveErr := resolve(operationResult); resolveErr != nil {
								logging.LogErrorf("[plugin:%s] siyuan.storage.list resolve: %v", p.Name, resolveErr)
							}
						} else {
							if rejectErr := reject(rt.NewGoError(operationErr)); rejectErr != nil {
								logging.LogErrorf("[plugin:%s] siyuan.storage.list reject: %v", p.Name, rejectErr)
							}
						}
						return
					}, nil)
				}()

				result, err = p.storageList(path)
				return
			}()

			return
		}, func(rt *goja.Runtime, result any, err error) {
			if !lo.IsNil(err) {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.storage.list reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.storage.list worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.storage.list reject: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	// siyuan.storage.watcher
	lo.Must0(storage.Set("watcher", watcher))

	lo.Must0(ObjectFreeze(rt, storage))

	lo.Must0(siyuan.Set("storage", storage))
	return
}
