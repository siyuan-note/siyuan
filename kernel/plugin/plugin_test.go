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
	"testing"

	"github.com/fastschema/qjs"
	"github.com/gorilla/websocket"
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
	err := p.start()
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

		result, err := p.callRpcMethod("test", map[string]any{
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
	p.stop()
}

func TestTrackSocketInit(t *testing.T) {
	petal := &model.Petal{Name: "test-track", Kernel: &model.KernelPetal{JS: ``}}
	p := NewKernelPlugin(petal)
	// TrackSocket must not panic on a fresh plugin (sockets was nil before the fix)
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("TrackSocket panicked on uninitialized map: %v", r)
		}
	}()
	conn := &websocket.Conn{}
	p.TrackSocket(conn, true)
	if _, ok := p.sockets[conn]; !ok {
		t.Error("expected conn to be tracked in sockets")
	}
	if _, ok := p.socketMus[conn]; !ok {
		t.Error("expected conn to have a mutex in socketMus")
	}
	p.UntrackSocket(conn)
	if len(p.sockets) != 0 {
		t.Errorf("expected sockets to be empty after untrack, got %d entries", len(p.sockets))
	}
	if len(p.socketMus) != 0 {
		t.Errorf("expected socketMus to be empty after untrack, got %d entries", len(p.socketMus))
	}
}

func TestRpcParamsToJsValue(t *testing.T) {
	rt, err := qjs.New()
	if err != nil {
		t.Fatalf("failed to create QJS runtime: %v", err)
	}
	defer rt.Close()
	ctx := rt.Context()

	jsonStr := `{"key":"value"}`
	jsonBytes := []byte(jsonStr)
	rawMsg := json.RawMessage(jsonStr)

	tests := []struct {
		name      string
		params    any
		wantJSON  string
		wantNil   bool
		wantError bool
	}{
		{
			name:    "nil params returns nil value",
			params:  nil,
			wantNil: true,
		},
		{
			name:     "string params parsed as JSON",
			params:   jsonStr,
			wantJSON: jsonStr,
		},
		{
			name:     "string pointer params parsed as JSON",
			params:   &jsonStr,
			wantJSON: jsonStr,
		},
		{
			name:     "byte slice params parsed as JSON",
			params:   jsonBytes,
			wantJSON: jsonStr,
		},
		{
			name:     "json.RawMessage params parsed as JSON",
			params:   rawMsg,
			wantJSON: jsonStr,
		},
		{
			name:     "byte slice pointer params parsed as JSON",
			params:   &jsonBytes,
			wantJSON: jsonStr,
		},
		{
			name:     "json.RawMessage pointer params parsed as JSON",
			params:   &rawMsg,
			wantJSON: jsonStr,
		},
		{
			name:     "default case marshals map to JSON",
			params:   map[string]any{"key": "value"},
			wantJSON: jsonStr,
		},
		{
			name:      "default case returns error for unmarshalable type",
			params:    make(chan int),
			wantError: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			value, err := rpcParamsToJsValue(ctx, tc.params)
			if tc.wantError {
				if err == nil {
					t.Error("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.wantNil {
				if value != nil {
					t.Errorf("expected nil value, got non-nil")
				}
				return
			}
			got, stringifyErr := value.JSONStringify()
			if stringifyErr != nil {
				t.Fatalf("JSONStringify failed: %v", stringifyErr)
			}
			if got != tc.wantJSON {
				t.Errorf("expected JSON %q, got %q", tc.wantJSON, got)
			}
		})
	}
}
