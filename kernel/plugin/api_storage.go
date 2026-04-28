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
	"os"
	"path/filepath"
	"strings"

	"github.com/dop251/goja"
	"github.com/samber/lo"
	"github.com/siyuan-note/filelock"
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

	baseDir := filepath.Join(util.DataDir, "storage", "petal", p.Name)

	resolvePath := func(relPath string) (abs string, err error) {
		abs = filepath.Join(baseDir, filepath.Clean(relPath))
		if !(abs == baseDir || strings.HasPrefix(abs, baseDir+string(filepath.Separator))) {
			err = fmt.Errorf("siyuan.storage: path traversal not allowed")
		}
		return
	}

	storage := rt.NewObject()

	// siyuan.storage.get(path) -> Promise<{text, json, arrayBuffer}>
	lo.Must0(storage.Set("get", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			var path string
			if len(call.Arguments) >= 1 && goja.IsString(call.Argument(0)) {
				path = call.Argument(0).String()
			} else {
				err = fmt.Errorf("path required")
				return
			}

			abs, resolveErr := resolvePath(path)
			if resolveErr != nil {
				err = resolveErr
				return
			}

			go func() (result []byte, err error) {
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("panic during siyuan.storage.get: %v", r)
					}
					p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
						if err != nil {
							return nil, err
						}

						content := rt.NewObject()
						if err = ObjectSetDataMethods(p, rt, content, result); err != nil {
							return nil, err
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

				data, readErr := filelock.ReadFile(abs)
				if readErr != nil {
					err = readErr
					return
				}

				result = data
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
		}

		return rt.ToValue(promise)
	})))

	// siyuan.storage.put(path, content) -> Promise<void>
	lo.Must0(storage.Set("put", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if len(call.Arguments) < 2 {
				err = fmt.Errorf("path and content required")
				return
			}
			path := call.Argument(0).String()
			content := call.Argument(1).String()
			abs, resolveErr := resolvePath(path)
			if resolveErr != nil {
				err = resolveErr
				return
			}

			go func() (result any, err error) {
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("panic during siyuan.storage.put: %v", r)
					}

					p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
						if lo.IsNil(err) {
							if resolveErr := resolve(result); resolveErr != nil {
								logging.LogErrorf("[plugin:%s] siyuan.storage.put resolve: %v", p.Name, resolveErr)
							}
						} else {
							if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
								logging.LogErrorf("[plugin:%s] siyuan.storage.put reject: %v", p.Name, rejectErr)
							}
						}
						return
					}, nil)
				}()

				if mkdirErr := os.MkdirAll(filepath.Dir(abs), 0755); mkdirErr != nil {
					err = fmt.Errorf("failed to make directory: %w", mkdirErr)
					return
				}
				if writeErr := filelock.WriteFile(abs, []byte(content)); writeErr != nil {
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
		}

		return rt.ToValue(promise)
	})))

	// siyuan.storage.remove(path) -> Promise<void>
	lo.Must0(storage.Set("remove", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if len(call.Arguments) < 1 {
				err = fmt.Errorf("path required")
				return
			}
			path := call.Argument(0).String()
			abs, resolveErr := resolvePath(path)
			if resolveErr != nil {
				err = resolveErr
				return
			}
			if abs == baseDir {
				err = fmt.Errorf("cannot remove storage root")
				return
			}

			go func() (result any, err error) {
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("panic during siyuan.storage.remove: %v", r)
					}

					p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
						if lo.IsNil(err) {
							if resolveErr := resolve(result); resolveErr != nil {
								logging.LogErrorf("[plugin:%s] siyuan.storage.remove resolve: %v", p.Name, resolveErr)
							}
						} else {
							if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
								logging.LogErrorf("[plugin:%s] siyuan.storage.remove reject: %v", p.Name, rejectErr)
							}
						}
						return
					}, nil)
				}()

				if removeErr := os.RemoveAll(abs); removeErr != nil {
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
		}

		return rt.ToValue(promise)
	})))

	// siyuan.storage.list(path) -> Promise<Entry[]>
	lo.Must0(storage.Set("list", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if len(call.Arguments) < 1 {
				err = fmt.Errorf("path required")
				return
			}
			path := call.Argument(0).String()
			abs, resolveErr := resolvePath(path)
			if resolveErr != nil {
				err = resolveErr
				return
			}

			go func() (result any, err error) {
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("panic during siyuan.storage.list: %v", r)
					}
					p.worker.Run(func(rt *goja.Runtime) (_ any, _ error) {
						if lo.IsNil(err) {
							if resolveErr := resolve(result); resolveErr != nil {
								logging.LogErrorf("[plugin:%s] siyuan.storage.list resolve: %v", p.Name, resolveErr)
							}
						} else {
							if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
								logging.LogErrorf("[plugin:%s] siyuan.storage.list reject: %v", p.Name, rejectErr)
							}
						}
						return
					}, nil)
				}()

				entries, readErr := os.ReadDir(abs)
				if readErr != nil {
					err = fmt.Errorf("failed to read directory: %w", readErr)
					return
				}

				results := make([]R, 0, len(entries))
				for _, entry := range entries {
					info, infoErr := entry.Info()
					if infoErr != nil {
						continue
					}
					results = append(results, R{
						"name":      entry.Name(),
						"isDir":     info.IsDir(),
						"isSymlink": util.IsSymlink(entry),
						"updated":   info.ModTime().Unix(),
					})
				}

				result = results
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
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(ObjectFreeze(rt, storage))

	lo.Must0(siyuan.Set("storage", storage))
	return
}
