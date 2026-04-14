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
	"os"
	"path/filepath"
	"strings"

	"github.com/fastschema/qjs"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// injectSandboxGlobals injects all siyuan.* APIs into the plugin's QJS context.
func injectSandboxGlobals(p *KernelPlugin) error {
	ctx := p.runtime.Context()

	// Create the `siyuan` global object as an empty object
	siyuanObj := ctx.NewObject()
	if siyuanObj == nil {
		return fmt.Errorf("failed to create siyuan object")
	}
	ctx.Global().SetPropertyStr("siyuan", siyuanObj)

	if err := injectLog(ctx, p); err != nil {
		return err
	}
	if err := injectStorage(ctx, p, siyuanObj); err != nil {
		return err
	}
	if err := injectFetch(ctx, p, siyuanObj); err != nil {
		return err
	}
	if err := injectSocket(ctx, p, siyuanObj); err != nil {
		return err
	}
	if err := injectRPCRegister(ctx, p, siyuanObj); err != nil {
		return err
	}

	return nil
}

// injectLog adds siyuan.log(level, ...args) to the QJS context.
func injectLog(ctx *qjs.Context, p *KernelPlugin) error {
	// SetFunc signature: func(this *This) (*Value, error)
	// Get arguments via this.Args()
	ctx.SetFunc("__siyuan_log", func(this *qjs.This) (*qjs.Value, error) {
		args := this.Args()
		if len(args) < 1 {
			return ctx.NewNull(), nil
		}

		level := args[0].String()
		parts := make([]string, 0, len(args)-1)
		for _, arg := range args[1:] {
			parts = append(parts, arg.String())
		}
		msg := strings.Join(parts, " ")
		prefix := fmt.Sprintf("[plugin:%s]", p.Name)

		switch level {
		case "info":
			logging.LogInfof("%s %s", prefix, msg)
		case "warn":
			logging.LogWarnf("%s %s", prefix, msg)
		case "error":
			logging.LogErrorf("%s %s", prefix, msg)
		default:
			logging.LogInfof("%s %s", prefix, msg)
		}

		return ctx.NewNull(), nil
	})

	// Wire up siyuan.log in JS - calls the Go binding
	_, err := ctx.Eval(`
		siyuan.log = function(level, ...args) {
			__siyuan_log(level, ...args);
		};
	`)
	return err
}

// injectStorage adds siyuan.storage.* methods for scoped file CRUD.
func injectStorage(ctx *qjs.Context, p *KernelPlugin, siyuanObj *qjs.Value) error {
	baseDir := filepath.Join(util.DataDir, "storage", "petal", p.Name)

	// Resolve and validate a relative path against the plugin's storage base directory.
	resolvePath := func(relPath string) (string, error) {
		if strings.Contains(relPath, "..") {
			return "", fmt.Errorf("path traversal not allowed")
		}
		abs := filepath.Join(baseDir, filepath.Clean(relPath))
		// Ensure the resolved path is still within baseDir
		if !strings.HasPrefix(abs, baseDir) {
			return "", fmt.Errorf("path traversal not allowed")
		}
		return abs, nil
	}

	// storage.get(path) -> Promise<string>
	ctx.SetAsyncFunc("__siyuan_storage_get", func(this *qjs.This) {
		args := this.Args()
		if len(args) < 1 {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.get: path required")))
			return
		}
		go func() {
			abs, err := resolvePath(args[0].String())
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
				return
			}
			data, err := filelock.ReadFile(abs)
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.get: %w", err)))
				return
			}
			this.Promise().Resolve(ctx.NewString(string(data)))
		}()
	})

	// storage.put(path, content) -> Promise<void>
	ctx.SetAsyncFunc("__siyuan_storage_put", func(this *qjs.This) {
		args := this.Args()
		if len(args) < 2 {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.put: path and content required")))
			return
		}
		go func() {
			abs, err := resolvePath(args[0].String())
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
				return
			}
			dir := filepath.Dir(abs)
			if err = os.MkdirAll(dir, 0755); err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.put: mkdir: %w", err)))
				return
			}
			if err = filelock.WriteFile(abs, []byte(args[1].String())); err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.put: %w", err)))
				return
			}
			this.Promise().Resolve(ctx.NewUndefined())
		}()
	})

	// storage.remove(path) -> Promise<void>
	ctx.SetAsyncFunc("__siyuan_storage_remove", func(this *qjs.This) {
		args := this.Args()
		if len(args) < 1 {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.remove: path required")))
			return
		}
		go func() {
			abs, err := resolvePath(args[0].String())
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
				return
			}
			if err = os.RemoveAll(abs); err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.remove: %w", err)))
				return
			}
			this.Promise().Resolve(ctx.NewUndefined())
		}()
	})

	// storage.list(path) -> Promise<Entry[]>
	ctx.SetAsyncFunc("__siyuan_storage_list", func(this *qjs.This) {
		args := this.Args()
		if len(args) < 1 {
			this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.list: path required")))
			return
		}
		go func() {
			abs, err := resolvePath(args[0].String())
			if err != nil {
				this.Promise().Reject(ctx.NewError(err))
				return
			}
			entries, err := os.ReadDir(abs)
			if err != nil {
				this.Promise().Reject(ctx.NewError(fmt.Errorf("storage.list: %w", err)))
				return
			}

			// Build result as JSON string, then parse to JS object
			result := make([]map[string]interface{}, 0, len(entries))
			for _, entry := range entries {
				info, infoErr := entry.Info()
				if infoErr != nil {
					continue
				}
				result = append(result, map[string]interface{}{
					"name":      entry.Name(),
					"isDir":     info.IsDir(),
					"isSymlink": entry.Type()&os.ModeSymlink != 0,
					"updated":   info.ModTime().Unix(),
				})
			}
			jsonBytes, _ := json.Marshal(result)
			jsVal := ctx.ParseJSON(string(jsonBytes))
			this.Promise().Resolve(jsVal)
		}()
	})

	// Wire up siyuan.storage.* methods in JS
	_, err := ctx.Eval(`
		siyuan.storage = {
			get: function(path) { return __siyuan_storage_get(path); },
			put: function(path, content) { return __siyuan_storage_put(path, content); },
			remove: function(path) { return __siyuan_storage_remove(path); },
			list: function(path) { return __siyuan_storage_list(path); }
		};
	`)
	return err
}

// injectFetch adds siyuan.fetch method. TODO in Task 7.
func injectFetch(ctx *qjs.Context, p *KernelPlugin, siyuanObj *qjs.Value) error {
	// TODO: implement in Task 7
	return nil
}

// injectSocket adds siyuan.socket method. TODO in Task 8.
func injectSocket(ctx *qjs.Context, p *KernelPlugin, siyuanObj *qjs.Value) error {
	// TODO: implement in Task 8
	return nil
}

// injectRPCRegister adds siyuan.rpc.register method. TODO in Task 9.
func injectRPCRegister(ctx *qjs.Context, p *KernelPlugin, siyuanObj *qjs.Value) error {
	// TODO: implement in Task 9
	return nil
}
