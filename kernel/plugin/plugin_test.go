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

	"github.com/siyuan-note/siyuan/kernel/bazaar"
)

func TestIsKernelEligible(t *testing.T) {
	tests := []struct {
		name     string
		kernel   []string
		backend  string
		expected bool
	}{
		// Note: bazaar.IsTargetSupported returns true for empty/nil slice
		// (missing "kernel" field means supported on all platforms)
		{"nil kernel", nil, "darwin", true},
		{"empty kernel", []string{}, "darwin", true},
		{"all", []string{"all"}, "darwin", true},
		{"match", []string{"darwin", "linux"}, "darwin", true},
		{"no match", []string{"windows", "linux"}, "darwin", false},
		{"all with others", []string{"all", "windows"}, "linux", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := bazaar.IsTargetSupported(tt.kernel, tt.backend)
			if result != tt.expected {
				t.Errorf("IsTargetSupported(%v, %q) = %v, want %v", tt.kernel, tt.backend, result, tt.expected)
			}
		})
	}
}

func TestPluginStateString(t *testing.T) {
	tests := []struct {
		state    PluginState
		expected string
	}{
		{StateLoading, "loading"},
		{StateRunning, "running"},
		{StateErrored, "errored"},
		{StateStopped, "stopped"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			if got := tt.state.String(); got != tt.expected {
				t.Errorf("PluginState(%d).String() = %q, want %q", tt.state, got, tt.expected)
			}
		})
	}
}

func TestNewKernelPlugin(t *testing.T) {
	kp := NewKernelPlugin("test-plugin")
	if kp.Name != "test-plugin" {
		t.Errorf("Name = %q, want %q", kp.Name, "test-plugin")
	}
	if kp.State() != StateStopped {
		t.Errorf("initial state = %v, want %v", kp.State(), StateStopped)
	}
}

func TestRPCDispatchErrors(t *testing.T) {
	kp := NewKernelPlugin("test")
	// Plugin not running - should error
	_, err := kp.CallRPCMethod("anything", nil)
	if err == nil {
		t.Error("expected error calling RPC on stopped plugin")
	}
}

func TestKernelPluginStartStop(t *testing.T) {
	kp := NewKernelPlugin("test-start-stop")

	// Test that a plugin with no kernel.js (empty code) fails to start
	// because injectSandboxGlobals will fail (it needs a valid runtime)
	err := kp.Start("")
	// Should either succeed (with empty code doing nothing) or fail
	// We just verify it doesn't panic and state is set appropriately
	if err != nil {
		// If it failed, state should be errored
		if kp.State() != StateErrored && kp.State() != StateStopped {
			t.Errorf("expected errored or stopped state after failed start, got %v", kp.State())
		}
	} else {
		// If it succeeded, state should be running
		if kp.State() != StateRunning {
			t.Errorf("expected running state after successful start, got %v", kp.State())
		}
		kp.Stop()
		if kp.State() != StateStopped {
			t.Errorf("expected stopped state after stop, got %v", kp.State())
		}
	}
}

func TestManagerSingleton(t *testing.T) {
	m1 := getManager()
	m2 := getManager()
	if m1 != m2 {
		t.Error("GetManager should return the same instance")
	}
}

func TestManagerGetPlugin(t *testing.T) {
	m := getManager()
	// Should return nil for non-existent plugin
	if m.GetPlugin("non-existent") != nil {
		t.Error("GetPlugin should return nil for non-existent plugin")
	}
}
