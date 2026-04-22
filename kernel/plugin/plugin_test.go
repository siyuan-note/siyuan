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
	"os"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func init() {
	// plugin.start() calls os.MkdirAll(util.DataDir + "/storage/petal/...").
	// Set DataDir to a temp dir so tests don't write to the real workspace.
	util.DataDir = os.TempDir()
}

func newTestPlugin(t *testing.T, kernelJS string) *KernelPlugin {
	t.Helper()
	petal := &model.Petal{
		Name:        "test-plugin",
		DisplayName: "Test Plugin",
		Kernel: model.KernelPetal{
			JS:      kernelJS,
			Existed: true,
		},
	}
	// CreatePluginJWT uses a package-level jwtKey (initialized to make([]byte, 32), i.e. all zeros).
	// It will succeed without calling model.InitJwtKey() — the token will simply use a zero key.
	// No HTTP calls are made during lifecycle tests, so this is fine for testing.
	p := NewKernelPlugin(petal)
	return p
}

func TestPluginStartStop(t *testing.T) {
	p := newTestPlugin(t, `// minimal plugin — no event.on`)
	if err := p.start(); err != nil {
		t.Fatalf("start failed: %v", err)
	}
	if p.State() != PluginStateRunning {
		t.Fatalf("expected running, got %s", p.State())
	}
	ok, err := p.stop()
	if err != nil {
		t.Fatalf("stop failed: %v", err)
	}
	if !ok {
		t.Fatal("expected stop to return ok=true")
	}
	if p.State() != PluginStateStopped {
		t.Fatalf("expected stopped, got %s", p.State())
	}
}

func TestPluginLifecycleHook(t *testing.T) {
	js := `
siyuan.event.on = function(event) {
    if (event.type === "lifecycle" && event.detail.name === "load") {
        siyuan.event.emit(event.type + ":" + event.id, {});
        return true;
    }
    return false;
};
`
	p := newTestPlugin(t, js)
	if err := p.start(); err != nil {
		t.Fatalf("start failed: %v", err)
	}
	defer func() {
		if ok, err := p.stop(); !ok || err != nil {
			t.Errorf("stop failed: ok=%v, err=%v", ok, err)
		}
	}()
	if p.State() != PluginStateRunning {
		t.Fatalf("expected running, got %s", p.State())
	}
}

func TestPluginRpcDispatch(t *testing.T) {
	js := `
siyuan.rpc.subscribe("add");
siyuan.event.on = function(event) {
    if (event.type === "rpc" && event.method === "add") {
        var result = event.params[0] + event.params[1];
        siyuan.event.emit("rpc:" + event.id, result);
        return true;
    }
    return false;
};
`
	p := newTestPlugin(t, js)
	if err := p.start(); err != nil {
		t.Fatalf("start failed: %v", err)
	}
	defer func() {
		if ok, err := p.stop(); !ok || err != nil {
			t.Errorf("stop failed: ok=%v, err=%v", ok, err)
		}
	}()
	if p.State() != PluginStateRunning {
		t.Fatalf("expected running, got %s", p.State())
	}

	result, rpcErr := p.callRpcMethod("add", []any{1, 2})
	if rpcErr != nil {
		t.Fatalf("RPC error: %v", rpcErr)
	}
	// JSON unmarshal gives float64 for numbers.
	got, ok := result.(float64)
	if !ok {
		t.Fatalf("expected float64 result, got %T(%v)", result, result)
	}
	if got != 3 {
		t.Fatalf("expected 3, got %v", got)
	}
}

func TestPluginRpcMethodNotFound(t *testing.T) {
	js := `
siyuan.event.on = function(event) {
    return false;
};
`
	p := newTestPlugin(t, js)
	if err := p.start(); err != nil {
		t.Fatalf("start failed: %v", err)
	}
	defer func() {
		if ok, err := p.stop(); !ok || err != nil {
			t.Errorf("stop failed: ok=%v, err=%v", ok, err)
		}
	}()
	if p.State() != PluginStateRunning {
		t.Fatalf("expected running, got %s", p.State())
	}

	_, rpcErr := p.callRpcMethod("nonexistent", nil)
	if rpcErr == nil {
		t.Fatal("expected error for unknown method")
	}
	if rpcErr.Code != JsonRpcErrorCodeMethodNotFound {
		t.Fatalf("expected MethodNotFound (%d), got %d: %s", JsonRpcErrorCodeMethodNotFound, rpcErr.Code, rpcErr.Message)
	}
}
