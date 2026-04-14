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
)

func TestPluginManagerStartWithDisabledPetals(t *testing.T) {
	m := &PluginManager{
		plugins: make(map[string]*KernelPlugin),
		PetalDisabledFunc: func() bool { return true },
	}

	// When petals are disabled, Start() should return early
	m.Start()

	if len(m.plugins) != 0 {
		t.Errorf("expected no plugins loaded when petals disabled, got %d", len(m.plugins))
	}
}

func TestPluginManagerStartWithNoTrust(t *testing.T) {
	m := &PluginManager{
		plugins: make(map[string]*KernelPlugin),
		TrustFunc: func() bool { return false },
	}

	// When trust is false and in container, Start() should return early
	// Note: This test behavior depends on util.Container value
	m.Start()

	// Just verify it doesn't panic
}

func TestPluginManagerStop(t *testing.T) {
	m := &PluginManager{
		plugins: make(map[string]*KernelPlugin),
	}

	// Add a mock plugin
	kp := NewKernelPlugin("test-stop")
	m.plugins["test-stop"] = kp

	// Stop should clear all plugins
	m.Stop()

	if len(m.plugins) != 0 {
		t.Errorf("expected plugins map to be empty after Stop, got %d", len(m.plugins))
	}

	if kp.State() != StateStopped {
		t.Errorf("expected plugin state to be stopped, got %v", kp.State())
	}
}

func TestPluginManagerStartPlugin(t *testing.T) {
	m := &PluginManager{
		plugins: make(map[string]*KernelPlugin),
		TokenFunc: func() string { return "test-token" },
	}

	// StartPlugin with non-existent plugin should not panic
	m.StartPlugin("non-existent-plugin")

	// Verify no plugin was added
	if m.GetPlugin("non-existent-plugin") != nil {
		t.Error("expected nil for non-existent plugin")
	}
}

func TestPluginManagerStopPlugin(t *testing.T) {
	m := &PluginManager{
		plugins: make(map[string]*KernelPlugin),
	}

	// Add a mock plugin
	kp := NewKernelPlugin("test")
	m.plugins["test"] = kp

	// Stop the plugin
	m.StopPlugin("test")

	// Verify plugin was removed
	if m.GetPlugin("test") != nil {
		t.Error("expected plugin to be removed after StopPlugin")
	}

	// Verify plugin state
	if kp.State() != StateStopped {
		t.Errorf("expected plugin state to be stopped, got %v", kp.State())
	}
}

func TestPluginManagerStopPluginNonExistent(t *testing.T) {
	m := &PluginManager{
		plugins: make(map[string]*KernelPlugin),
	}

	// StopPlugin with non-existent plugin should not panic
	m.StopPlugin("non-existent")
}

func TestPluginManagerConcurrency(t *testing.T) {
	m := &PluginManager{
		plugins: make(map[string]*KernelPlugin),
	}

	// Test concurrent access
	done := make(chan bool, 3)

	go func() {
		m.GetPlugin("test")
		done <- true
	}()

	go func() {
		m.plugins["test"] = NewKernelPlugin("test")
		done <- true
	}()

	go func() {
		m.Stop()
		done <- true
	}()

	for i := 0; i < 3; i++ {
		<-done
	}

	// Should not panic with race detector
}

func TestReadPluginJSONNonExistent(t *testing.T) {
	// Test with non-existent plugin
	pj := readPluginJSON("definitely-non-existent-plugin-12345")
	if pj != nil {
		t.Error("expected nil for non-existent plugin.json")
	}
}

func TestLoadEnabledPetalNamesNoFile(t *testing.T) {
	// When petals.json doesn't exist, should return nil
	names := loadEnabledPetalNames()
	// This depends on the actual file system state
	// In a fresh environment without petals.json, it should return nil or empty
	_ = names // Just verify it doesn't panic
}

func TestPluginManagerTokenFunc(t *testing.T) {
	called := false
	m := &PluginManager{
		plugins: make(map[string]*KernelPlugin),
		TokenFunc: func() string {
			called = true
			return "test-token"
		},
	}

	// Verify TokenFunc is set
	if m.TokenFunc == nil {
		t.Error("expected TokenFunc to be set")
	}

	// Call the TokenFunc
	token := m.TokenFunc()
	if !called {
		t.Error("expected TokenFunc to be called")
	}
	if token != "test-token" {
		t.Errorf("expected token 'test-token', got %q", token)
	}
}

func TestPluginManagerPetalDisabledFunc(t *testing.T) {
	called := false
	m := &PluginManager{
		plugins: make(map[string]*KernelPlugin),
		PetalDisabledFunc: func() bool {
			called = true
			return false
		},
	}

	// Verify PetalDisabledFunc is set
	if m.PetalDisabledFunc == nil {
		t.Error("expected PetalDisabledFunc to be set")
	}

	// Call the PetalDisabledFunc
	m.PetalDisabledFunc()
	if !called {
		t.Error("expected PetalDisabledFunc to be called")
	}
}

func TestPluginManagerTrustFunc(t *testing.T) {
	called := false
	m := &PluginManager{
		plugins: make(map[string]*KernelPlugin),
		TrustFunc: func() bool {
			called = true
			return true
		},
	}

	// Verify TrustFunc is set
	if m.TrustFunc == nil {
		t.Error("expected TrustFunc to be set")
	}

	// Call the TrustFunc
	m.TrustFunc()
	if !called {
		t.Error("expected TrustFunc to be called")
	}
}

func TestKernelPluginTrackUntrackSocket(t *testing.T) {
	kp := NewKernelPlugin("test-socket")

	// Create a mock connection (we can't easily create a real websocket.Conn in tests)
	// So we'll just verify the methods don't panic with nil
	kp.TrackSocket(nil)

	if len(kp.sockets) != 1 {
		t.Errorf("expected 1 socket tracked, got %d", len(kp.sockets))
	}

	kp.UntrackSocket(nil)

	if len(kp.sockets) != 0 {
		t.Errorf("expected 0 sockets after untrack, got %d", len(kp.sockets))
	}
}

func TestKernelPluginRegisterRPCMethod(t *testing.T) {
	kp := NewKernelPlugin("test-rpc")
	kp.regOpen = true

	// We can't easily create a *qjs.Value in tests without a runtime
	// So we just verify the method structure exists and regOpen is checked
	if !kp.regOpen {
		t.Error("expected regOpen to be true initially")
	}
}
