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

	model.OnKernelPluginStart = func(petal *model.Petal) { GetManager().StartPlugin(petal) }
	model.OnKernelPluginStop = func(petal *model.Petal) { GetManager().StopPlugin(petal) }
	model.OnKernelPluginShutdown = func() { GetManager().Stop() }

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
	defer func() {
		if r := recover(); r != nil {
			logging.LogErrorf("kernel plugin manager failed to start: %v", r)
		}
	}()

	logging.LogInfof("kernel plugin manager starting")

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
	defer func() {
		if r := recover(); r != nil {
			logging.LogErrorf("kernel plugin manager failed to stop: %v", r)
		}
	}()

	logging.LogInfof("kernel plugin manager stopping")

	m.mu.Lock()
	plugins := make([]*KernelPlugin, 0, len(m.plugins))
	for k, p := range m.plugins {
		plugins = append(plugins, p)
		delete(m.plugins, k)
	}
	m.mu.Unlock()

	wg := sync.WaitGroup{}
	for _, p := range plugins {
		wg.Add(1)
		go func(p *KernelPlugin) {
			defer wg.Done()
			if err := p.stop(); err != nil {
				logging.LogErrorf("[plugin:%s] stop failed: %s", p.Name, err)
			}
		}(p)
	}
	wg.Wait()

	count := len(plugins)
	logging.LogInfof("kernel plugin manager stopped, %d plugin(s) unloaded", count)
}

// StartPlugin starts a single kernel plugin.
// Called when a petal is enabled via SetPetalEnabled.
func (m *PluginManager) StartPlugin(petal *model.Petal) {
	defer func() {
		if r := recover(); r != nil {
			logging.LogErrorf("[plugin:%s] panic during start: %v", petal.Name, r)
		}
	}()

	m.StopPlugin(petal)

	p := NewKernelPlugin(petal)

	m.mu.Lock()
	m.plugins[p.Name] = p
	m.mu.Unlock()

	if err := p.start(); err != nil {
		logging.LogErrorf("[plugin:%s] start failed: %s", p.Name, err)
	}
}

// StopPlugin stops a single kernel plugin.
// Called when a petal is disabled via SetPetalEnabled.
func (m *PluginManager) StopPlugin(petal *model.Petal) {
	defer func() {
		if r := recover(); r != nil {
			logging.LogErrorf("[plugin:%s] panic during stop: %v", petal.Name, r)
		}
	}()

	m.mu.Lock()
	p, ok := m.plugins[petal.Name]
	if ok {
		delete(m.plugins, p.Name)
	}
	m.mu.Unlock()

	if ok {
		if err := p.stop(); err != nil {
			logging.LogErrorf("[plugin:%s] stop failed: %s", p.Name, err)
		}
	}
}

// GetPlugin returns a loaded KernelPlugin by name, or nil.
func (m *PluginManager) GetPlugin(name string) *KernelPlugin {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.plugins[name]
}

func (m *PluginManager) GetLoadedPlugin(name string) (plugin *PluginInfo, found bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if p, ok := m.plugins[name]; ok {
		return &PluginInfo{
			Name:    p.Name,
			Methods: p.GetRpcMethodsInfo(),
		}, true
	}
	return nil, false
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
