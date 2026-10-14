package plugin

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestOptionalLifecycleHooks(t *testing.T) {
	logPath := filepath.Join(t.TempDir(), "lifecycle.log")
	logging.SetLogPath(logPath)
	t.Cleanup(func() { logging.SetLogPath(util.LogPath) })
	for _, test := range []struct {
		name, hook string
		wantError  bool
	}{
		{"null", "null", false},
		{"undefined", "undefined", false},
		{"function", "function () {}", false},
		{"promise", "function () { return Promise.resolve(); }", false},
		{"invalid", "42", true},
		{"throws", "function () { throw new Error('hook-failed'); }", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			loop := eventloop.NewEventLoop()
			loop.Start()
			defer loop.Terminate()
			plugin := &KernelPlugin{Petal: &model.Petal{Name: test.name}}
			plugin.worker.Start(loop)
			if _, err := plugin.worker.RunSync(func(rt *goja.Runtime) (any, error) {
				return rt.RunString("globalThis.siyuan = {plugin: {lifecycle: {onrunning: " + test.hook + "}}};")
			}); err != nil {
				t.Fatal(err)
			}
			done := make(chan struct{})
			go func() { plugin.invokeHook("onrunning"); close(done) }()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("lifecycle invocation did not complete")
			}
			data, err := os.ReadFile(logPath)
			if err != nil && !os.IsNotExist(err) {
				t.Fatal(err)
			}
			if found := strings.Contains(string(data), "[plugin:"+test.name+"] lifecycle hook"); found != test.wantError {
				t.Fatalf("lifecycle error logged=%v, want %v", found, test.wantError)
			}
		})
	}
}
