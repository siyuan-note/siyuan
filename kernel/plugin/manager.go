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
	"os"
	"path/filepath"
	"sync"

	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	manager     *PluginManager
	managerOnce sync.Once
)

// InitManager initializes the global PluginManager singleton and starts it.
func InitManager() {
	manager := getManager()
	manager.PetalDisabledFunc = func() bool { return model.Conf.Bazaar.PetalDisabled }
	manager.TrustFunc = func() bool { return model.Conf.Bazaar.Trust }
	model.OnKernelPluginStart = manager.StartPlugin
	model.OnKernelPluginStop = manager.StopPlugin
	model.OnKernelPluginShutdown = manager.Stop
	manager.Start()
}

// getManager returns the singleton PluginManager.
func getManager() *PluginManager {
	managerOnce.Do(func() {
		manager = &PluginManager{
			plugins: make(map[string]*KernelPlugin),
		}
	})
	return manager
}

// PluginManager discovers, loads, starts, and stops kernel plugins.
type PluginManager struct {
	mu      sync.RWMutex
	plugins map[string]*KernelPlugin

	// PetalDisabledFunc and TrustFunc gate plugin loading (mirrors model.loadPetals guards)
	PetalDisabledFunc func() bool // returns true when petals are globally disabled
	TrustFunc         func() bool // returns true when bazaar trust is confirmed
}

// pluginJSON mirrors the subset of plugin.json fields we need.
type pluginJSON struct {
	Name   string   `json:"name"`
	Kernel []string `json:"kernel"`
}

// Start loads and starts all kernel-eligible plugins.
// Called from main.go after model.InitBoxes().
func (m *PluginManager) Start() {
	// Check global petal guards (same as model.loadPetals)
	if m.PetalDisabledFunc != nil && m.PetalDisabledFunc() {
		logging.LogInfof("kernel plugin manager: petals globally disabled, skipping")
		return
	}
	if m.TrustFunc != nil && !m.TrustFunc() {
		if util.ContainerStd == util.Container || util.ContainerDocker == util.Container {
			logging.LogInfof("kernel plugin manager: bazaar trust not confirmed, skipping")
			return
		}
	}

	petals := loadEnabledPetalNames()
	backend := bazaar.GetCurrentBackend()

	for _, name := range petals {
		pj := readPluginJSON(name)
		if pj == nil || !bazaar.IsTargetSupported(pj.Kernel, backend) {
			continue
		}

		jsPath := filepath.Join(util.DataDir, "plugins", name, "kernel.js")
		jsCode, err := filelock.ReadFile(jsPath)
		if err != nil {
			logging.LogErrorf("[plugin:%s] read kernel.js failed: %s", name, err)
			continue
		}

		kp := NewKernelPlugin(name)
		m.mu.Lock()
		m.plugins[name] = kp
		m.mu.Unlock()

		if err = kp.Start(string(jsCode)); err != nil {
			logging.LogErrorf("[plugin:%s] start failed: %s", name, err)
		}
	}

	m.mu.RLock()
	count := len(m.plugins)
	m.mu.RUnlock()
	logging.LogInfof("kernel plugin manager started, %d plugin(s) loaded", count)
}

// Stop shuts down all running kernel plugins.
// Called from model.Close() before process exit.
func (m *PluginManager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for name, kp := range m.plugins {
		kp.Stop()
		logging.LogInfof("[plugin:%s] stopped during shutdown", name)
	}
	m.plugins = make(map[string]*KernelPlugin)
	logging.LogInfof("kernel plugin manager stopped")
}

// StartPlugin starts a single kernel plugin by name.
// Called when a petal is enabled via SetPetalEnabled.
func (m *PluginManager) StartPlugin(name string) {
	backend := bazaar.GetCurrentBackend()
	pj := readPluginJSON(name)
	if pj == nil || !bazaar.IsTargetSupported(pj.Kernel, backend) {
		return
	}

	jsPath := filepath.Join(util.DataDir, "plugins", name, "kernel.js")
	jsCode, err := filelock.ReadFile(jsPath)
	if err != nil {
		logging.LogErrorf("[plugin:%s] read kernel.js failed: %s", name, err)
		return
	}

	m.mu.Lock()
	if existing, ok := m.plugins[name]; ok {
		existing.Stop()
	}
	kp := NewKernelPlugin(name)
	m.plugins[name] = kp
	m.mu.Unlock()

	if err = kp.Start(string(jsCode)); err != nil {
		logging.LogErrorf("[plugin:%s] start failed: %s", name, err)
	}
}

// StopPlugin stops a single kernel plugin by name.
// Called when a petal is disabled via SetPetalEnabled.
func (m *PluginManager) StopPlugin(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if kp, ok := m.plugins[name]; ok {
		kp.Stop()
		delete(m.plugins, name)
	}
}

// GetPlugin returns a loaded KernelPlugin by name, or nil.
func (m *PluginManager) GetPlugin(name string) *KernelPlugin {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.plugins[name]
}

// readPluginJSON reads and parses plugin.json for the named plugin.
func readPluginJSON(name string) *pluginJSON {
	jsonPath := filepath.Join(util.DataDir, "plugins", name, "plugin.json")
	data, err := filelock.ReadFile(jsonPath)
	if err != nil {
		return nil
	}
	var pj pluginJSON
	if err = json.Unmarshal(data, &pj); err != nil {
		logging.LogErrorf("[plugin:%s] parse plugin.json failed: %s", name, err)
		return nil
	}
	return &pj
}

// loadEnabledPetalNames reads petals.json and returns names of enabled petals.
func loadEnabledPetalNames() []string {
	confPath := filepath.Join(util.DataDir, "storage", "petal", "petals.json")
	data, err := filelock.ReadFile(confPath)
	if err != nil {
		return nil
	}

	type petalEntry struct {
		Name    string `json:"name"`
		Enabled bool   `json:"enabled"`
	}
	var petals []petalEntry
	if err = json.Unmarshal(data, &petals); err != nil {
		logging.LogErrorf("parse petals.json failed: %s", err)
		return nil
	}

	var names []string
	for _, p := range petals {
		if p.Enabled {
			// Check petal trust/disabled guards (same as model.loadPetals)
			pluginJSONPath := filepath.Join(util.DataDir, "plugins", p.Name, "plugin.json")
			if _, statErr := os.Stat(pluginJSONPath); statErr != nil {
				continue
			}
			names = append(names, p.Name)
		}
	}
	return names
}
