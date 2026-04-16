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
	"sync"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
)

// PluginManager discovers, loads, starts, and stops kernel plugins.
type PluginManager struct {
	mu      sync.RWMutex
	plugins map[string]*KernelPlugin
}

type PluginInfo struct {
	Name    string           `json:"name"`
	Methods []*RpcMethodInfo `json:"methods"`
}

var (
	manager     *PluginManager
	managerOnce sync.Once
)

// InitManager initializes the global PluginManager singleton and starts it.
func InitManager() {
	m := GetManager()

	model.OnKernelPluginStart = func(petal *model.Petal) { m.StartPlugin(petal) }
	model.OnKernelPluginStop = func(petal *model.Petal) { m.StopPlugin(petal) }
	model.OnKernelPluginShutdown = func() { m.Stop() }

	m.Start()
}

// GetManager returns the singleton PluginManager.
func GetManager() *PluginManager {
	managerOnce.Do(func() {
		manager = &PluginManager{
			plugins: make(map[string]*KernelPlugin),
		}
	})
	return manager
}

// Start loads and starts all kernel-eligible plugins.
// Called from main.go after model initialization.
func (m *PluginManager) Start() {
	petals := model.LoadKernelPetals()

	wg := sync.WaitGroup{}
	for _, petal := range petals {
		wg.Add(1)
		go func(petal *model.Petal) {
			defer wg.Done()
			m.StartPlugin(petal)
		}(petal)
	}
	wg.Wait()

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

	wg := sync.WaitGroup{}
	for _, p := range m.plugins {
		wg.Add(1)
		go func(p *KernelPlugin) {
			defer wg.Done()
			p.Stop()
		}(p)
	}
	wg.Wait()

	count := len(m.plugins)
	for k := range m.plugins {
		delete(m.plugins, k)
	}

	logging.LogInfof("kernel plugin manager stopped, %d plugin(s) unloaded", count)
}

// StartPlugin starts a single kernel plugin.
// Called when a petal is enabled via SetPetalEnabled.
func (m *PluginManager) StartPlugin(petal *model.Petal) {
	m.mu.Lock()
	if p, ok := m.plugins[petal.Name]; ok {
		p.Stop()
		delete(m.plugins, p.Name)
	}

	p := NewKernelPlugin(petal)
	m.plugins[p.Name] = p
	m.mu.Unlock()

	if err := p.Start(); err != nil {
		logging.LogErrorf("[plugin:%s] start failed: %s", p.Name, err)
	}
}

// StopPlugin stops a single kernel plugin.
// Called when a petal is disabled via SetPetalEnabled.
func (m *PluginManager) StopPlugin(petal *model.Petal) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if p, ok := m.plugins[petal.Name]; ok {
		p.Stop()
		delete(m.plugins, p.Name)
	}
}

// GetPlugin returns a loaded KernelPlugin by name, or nil.
func (m *PluginManager) GetPlugin(name string) *KernelPlugin {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.plugins[name]
}

// GetLoadedPluginInfo returns a list of all loaded plugins with their RPC method info.
func (m *PluginManager) GetLoadedPluginsInfo() (plugins []*PluginInfo) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, p := range m.plugins {
		plugins = append(plugins, &PluginInfo{
			Name:    p.Name,
			Methods: p.GetRpcMethodsInfo(),
		})
	}
	return plugins
}
