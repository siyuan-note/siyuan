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
	"strings"

	"github.com/fastschema/qjs"
	"github.com/siyuan-note/logging"
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

// injectStorage adds siyuan.storage.* methods. TODO in Task 6.
func injectStorage(ctx *qjs.Context, p *KernelPlugin, siyuanObj *qjs.Value) error {
	// TODO: implement in Task 6
	return nil
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
