// SiYuan - From thought to insight, with agents
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
	"context"
	"crypto/sha256"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/asaskevich/EventBus"
	"github.com/fsnotify/fsnotify"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPluginSourceWatchStateDebouncesChangedContent(t *testing.T) {
	pluginsDir := t.TempDir()
	name := "test-plugin"
	pluginDir := filepath.Join(pluginsDir, name)
	if err := os.MkdirAll(pluginDir, 0755); err != nil {
		t.Fatal(err)
	}
	sourcePath := filepath.Join(pluginDir, "kernel.js")
	if err := os.WriteFile(sourcePath, []byte("initial"), 0644); err != nil {
		t.Fatal(err)
	}

	reloaded := make(chan string, 4)
	state := newPluginSourceWatchState(func(pluginName string) {
		reloaded <- pluginName
	})
	state.delay = 20 * time.Millisecond
	state.register(name, sourcePath, "initial")
	t.Cleanup(func() {
		state.unregister(name)
	})

	if err := os.WriteFile(sourcePath, []byte("changed"), 0644); err != nil {
		t.Fatal(err)
	}
	state.schedule(name)
	state.schedule(name)
	state.schedule(name)
	waitForPluginReload(t, reloaded, name)
	expectNoPluginReload(t, reloaded)

	state.schedule(name)
	expectNoPluginReload(t, reloaded)

	if err := os.Remove(sourcePath); err != nil {
		t.Fatal(err)
	}
	state.schedule(name)
	expectNoPluginReload(t, reloaded)

	if err := os.WriteFile(sourcePath, []byte("recreated"), 0644); err != nil {
		t.Fatal(err)
	}
	state.schedule(name)
	waitForPluginReload(t, reloaded, name)
}

func TestHandlePluginSourceEventSupportsCombinedOperations(t *testing.T) {
	pluginsDir := t.TempDir()
	name := "test-plugin"
	pluginDir := filepath.Join(pluginsDir, name)
	if err := os.MkdirAll(pluginDir, 0755); err != nil {
		t.Fatal(err)
	}
	sourcePath := filepath.Join(pluginDir, "kernel.js")
	if err := os.WriteFile(sourcePath, []byte("initial"), 0644); err != nil {
		t.Fatal(err)
	}

	reloaded := make(chan string, 1)
	manager := &PluginManager{
		pluginsDir: pluginsDir,
		sourceWatch: newPluginSourceWatchState(func(pluginName string) {
			reloaded <- pluginName
		}),
	}
	manager.sourceWatch.delay = 20 * time.Millisecond
	manager.sourceWatch.register(name, sourcePath, "initial")
	t.Cleanup(func() {
		manager.sourceWatch.unregister(name)
	})

	if err := os.WriteFile(sourcePath, []byte("changed"), 0644); err != nil {
		t.Fatal(err)
	}
	manager.handlePluginSourceEvent(fsnotify.Event{
		Name: sourcePath,
		Op:   fsnotify.Create | fsnotify.Write,
	})
	waitForPluginReload(t, reloaded, name)
}

func TestPluginSourceWatchStateScansChangedContent(t *testing.T) {
	pluginsDir := t.TempDir()
	name := "test-plugin"
	pluginDir := filepath.Join(pluginsDir, name)
	if err := os.MkdirAll(pluginDir, 0755); err != nil {
		t.Fatal(err)
	}
	sourcePath := filepath.Join(pluginDir, "kernel.js")
	if err := os.WriteFile(sourcePath, []byte("initial"), 0644); err != nil {
		t.Fatal(err)
	}

	reloaded := make(chan string, 2)
	state := newPluginSourceWatchState(func(pluginName string) {
		reloaded <- pluginName
	})
	state.delay = 20 * time.Millisecond
	state.register(name, sourcePath, "initial")
	t.Cleanup(func() {
		state.unregister(name)
	})

	waitForPluginSourceVerification(t, &state, name)
	state.scan()
	state.mu.Lock()
	timer := state.entries[name].timer
	state.mu.Unlock()
	if timer != nil {
		t.Fatal("unchanged source must not schedule a content read")
	}
	expectNoPluginReload(t, reloaded)

	if err := os.WriteFile(sourcePath, []byte("changed-content"), 0644); err != nil {
		t.Fatal(err)
	}
	state.scan()
	if err := os.WriteFile(sourcePath, []byte("final-content"), 0644); err != nil {
		t.Fatal(err)
	}
	waitForPluginReload(t, reloaded, name)

	state.mu.Lock()
	signature := state.entries[name].signature
	state.mu.Unlock()
	if want := sha256.Sum256([]byte("final-content")); signature != want {
		t.Fatalf("polled source signature = %x, want %x", signature, want)
	}

	state.scan()
	expectNoPluginReload(t, reloaded)

	if err := os.Remove(sourcePath); err != nil {
		t.Fatal(err)
	}
	state.scan()
	expectNoPluginReload(t, reloaded)

	if err := os.WriteFile(sourcePath, []byte("recreated"), 0644); err != nil {
		t.Fatal(err)
	}
	state.scan()
	waitForPluginReload(t, reloaded, name)
}

func TestPluginSourceWatchStateVerifiesRegistrationContent(t *testing.T) {
	pluginsDir := t.TempDir()
	name := "test-plugin"
	sourcePath := filepath.Join(pluginsDir, "kernel.js")
	if err := os.WriteFile(sourcePath, []byte("changed-after-load"), 0644); err != nil {
		t.Fatal(err)
	}

	reloaded := make(chan string, 1)
	state := newPluginSourceWatchState(func(pluginName string) {
		reloaded <- pluginName
	})
	state.delay = 20 * time.Millisecond
	state.register(name, sourcePath, "loaded-source")
	t.Cleanup(func() {
		state.unregister(name)
	})

	waitForPluginReload(t, reloaded, name)
}

func TestPluginSourceWatchStateChecksFileIdentity(t *testing.T) {
	pluginsDir := t.TempDir()
	name := "test-plugin"
	sourcePath := filepath.Join(pluginsDir, "kernel.js")
	if err := os.WriteFile(sourcePath, []byte("initial"), 0644); err != nil {
		t.Fatal(err)
	}

	reloaded := make(chan string, 1)
	state := newPluginSourceWatchState(func(pluginName string) {
		reloaded <- pluginName
	})
	state.delay = 20 * time.Millisecond
	state.register(name, sourcePath, "initial")
	t.Cleanup(func() {
		state.unregister(name)
	})
	waitForPluginSourceVerification(t, &state, name)

	if err := os.WriteFile(sourcePath, []byte("changed"), 0644); err != nil {
		t.Fatal(err)
	}
	fileState, err := readPluginSourceFileState(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	state.mu.Lock()
	entry := state.entries[name]
	entry.fileState = fileState
	entry.fileState.inode++
	state.mu.Unlock()

	state.scan()
	waitForPluginReload(t, reloaded, name)
}

func TestPluginSourceWatchStateIgnoresStaleRegistration(t *testing.T) {
	pluginsDir := t.TempDir()
	name := "test-plugin"
	sourcePath := filepath.Join(pluginsDir, "kernel.js")
	if err := os.WriteFile(sourcePath, []byte("initial"), 0644); err != nil {
		t.Fatal(err)
	}

	reloaded := make(chan string, 1)
	state := newPluginSourceWatchState(func(pluginName string) {
		reloaded <- pluginName
	})
	state.register(name, sourcePath, "initial")
	state.mu.Lock()
	staleGeneration := state.entries[name].generation
	state.mu.Unlock()

	state.unregister(name)
	state.register(name, sourcePath, "initial")
	t.Cleanup(func() {
		state.unregister(name)
	})

	if err := os.WriteFile(sourcePath, []byte("changed"), 0644); err != nil {
		t.Fatal(err)
	}
	state.reloadIfChanged(name, staleGeneration, nil)
	expectNoPluginReload(t, reloaded)
}

func TestSelectPluginSourceWatchMode(t *testing.T) {
	tests := []struct {
		name   string
		goos   string
		mobile bool
		want   pluginSourceWatchMode
	}{
		{name: "windows", goos: "windows", want: pluginSourceWatchEvents},
		{name: "linux", goos: "linux", want: pluginSourceWatchEvents},
		{name: "darwin", goos: "darwin", want: pluginSourceWatchPolling},
		{name: "darwin mobile", goos: "darwin", mobile: true, want: pluginSourceWatchDisabled},
		{name: "android", goos: "android", mobile: true, want: pluginSourceWatchDisabled},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := selectPluginSourceWatchMode(test.goos, test.mobile); got != test.want {
				t.Fatalf("selectPluginSourceWatchMode(%q, %t) = %d, want %d", test.goos, test.mobile, got, test.want)
			}
		})
	}
}

func TestStorageWatcherIsCreatedLazilyAndClosedIdempotently(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	storageDir := t.TempDir()
	plugin := &KernelPlugin{
		Petal:      &model.Petal{Name: "test-plugin"},
		storageDir: storageDir,
		context:    ctx,
		cancel:     cancel,
		bus:        EventBus.New(),
	}

	if plugin.watcher != nil {
		t.Fatal("storage watcher must not be initialized before the first add")
	}
	if err := plugin.removeStorageWatch(storageDir); err == nil {
		t.Fatal("removing a path before watcher initialization must fail")
	}
	if plugin.watcher != nil {
		t.Fatal("remove must not initialize the storage watcher")
	}

	if err := plugin.addStorageWatch(storageDir); err != nil {
		t.Fatalf("add storage watch failed: %v", err)
	}
	plugin.watcherMu.Lock()
	watcher := plugin.watcher
	plugin.watcherMu.Unlock()
	if watcher == nil {
		t.Fatal("storage watcher was not initialized by add")
	}

	cancel()
	plugin.closeStorageWatcher()
	plugin.closeStorageWatcher()

	plugin.watcherMu.Lock()
	watcher = plugin.watcher
	plugin.watcherMu.Unlock()
	if watcher != nil {
		t.Fatal("storage watcher was not cleared")
	}
	if err := plugin.addStorageWatch(storageDir); err == nil {
		t.Fatal("adding a path after plugin cancellation must fail")
	}
}

func TestStorageWatchOperationsExpandsCombinedOperations(t *testing.T) {
	event := fsnotify.Event{
		Op: fsnotify.Create | fsnotify.Write | fsnotify.Remove,
	}
	got := storageWatchOperations(event)
	want := []string{"CREATE", "WRITE", "REMOVE"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("storageWatchOperations() = %v, want %v", got, want)
	}
}

func TestPluginFileWatchIsDisabledOnMobile(t *testing.T) {
	originalContainer := util.Container
	t.Cleanup(func() {
		util.Container = originalContainer
	})

	for _, container := range []string{util.ContainerAndroid, util.ContainerIOS, util.ContainerHarmony} {
		util.Container = container
		if isPluginFileWatchSupported() {
			t.Fatalf("plugin file watcher must be disabled on mobile container [%s]", container)
		}

		ctx, cancel := context.WithCancel(context.Background())
		storageDir := t.TempDir()
		plugin := &KernelPlugin{
			Petal:      &model.Petal{Name: "test-plugin"},
			storageDir: storageDir,
			context:    ctx,
			cancel:     cancel,
			bus:        EventBus.New(),
		}
		if err := plugin.addStorageWatch(storageDir); !errors.Is(err, errPluginFileWatchUnsupported) {
			t.Fatalf("addStorageWatch() error = %v, want %v", err, errPluginFileWatchUnsupported)
		}
		if err := plugin.removeStorageWatch(storageDir); !errors.Is(err, errPluginFileWatchUnsupported) {
			t.Fatalf("removeStorageWatch() error = %v, want %v", err, errPluginFileWatchUnsupported)
		}
		if plugin.watcher != nil {
			t.Fatalf("storage watcher must not be initialized on mobile container [%s]", container)
		}
		cancel()
	}
}

func waitForPluginReload(t *testing.T, reloaded <-chan string, want string) {
	t.Helper()

	select {
	case got := <-reloaded:
		if got != want {
			t.Fatalf("reloaded plugin = %q, want %q", got, want)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for plugin reload")
	}
}

func expectNoPluginReload(t *testing.T, reloaded <-chan string) {
	t.Helper()

	select {
	case got := <-reloaded:
		t.Fatalf("unexpected plugin reload for %q", got)
	case <-time.After(80 * time.Millisecond):
	}
}

func waitForPluginSourceVerification(t *testing.T, state *pluginSourceWatchState, name string) {
	t.Helper()

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		state.mu.Lock()
		entry := state.entries[name]
		verified := entry != nil && entry.verified && entry.timer == nil
		state.mu.Unlock()
		if verified {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("timed out waiting for plugin source verification")
}
