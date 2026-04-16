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
	"testing"

	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestRPCRegistration(t *testing.T) {
	code := `
		try {
			const log = async (...args) => {
				siyuan.logger.debug(JSON.stringify(args));
			};
			const test = async (...args) => {
				siyuan.logger.debug(JSON.stringify(args));
				await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate async work
				return args[0].message;
			};

			siyuan.rpc.bind("log", log);
			siyuan.rpc.unbind("log", log);

			siyuan.rpc.bind("test", test);
		} catch (e) {
			siyuan.logger.error("Failed to register RPC method:", e.toString());
		}

		siyuan.plugin.onload = (...args) => {
			siyuan.logger.debug("Plugin loaded with args: " + JSON.stringify(args));
		};

		siyuan.plugin.onunload = async (...args) => {
			siyuan.logger.debug("Plugin unloaded with args: " + JSON.stringify(args));
			await new Promise(resolve => setTimeout(resolve, 1000));
		};
	`
	petal := &model.Petal{
		Name: "test-rpc-register",
		Kernel: &model.KernelPetal{
			JS: code,
		},
	}
	p := NewKernelPlugin(petal)
	err := p.Start()
	if err != nil {
		t.Errorf("failed to start plugin: %v", err)
	} else {

		count := 0
		p.rpcMethods.Range(func(key, value any) bool {
			count++
			return true // 继续遍历
		})

		if count != 1 {
			t.Errorf("expected 1 registered RPC method, got %d", count)
		}

		result, err := p.CallRpcMethod("test", map[string]any{
			"message": "Hello, world!",
		})
		if err != nil {
			t.Errorf("CallRPCMethod failed: %v", err)
		} else {
			if resultStr, ok := result.(string); !ok || resultStr != "Hello, world!" {
				t.Errorf("expected result 'Hello, world!', got %v", result)
			}
		}
	}
	p.Stop()
}
