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
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type PluginManagerState int64

const (
	PluginManagerStateStopped PluginManagerState = iota
	PluginManagerStateRunning
)

// PluginManager discovers, loads, starts, and stops kernel plugins.
type PluginManager struct {
	state       PluginManagerState // protected by lifecycleMu
	lifecycleMu sync.RWMutex       // protects the lifecycle state of the manager (starting/stopping), allowing concurrent start/stop of different plugins while preventing concurrent start/stop of the entire manager

	pluginsDir string // base directory for plugins (e.g. /path/to/workspace/data/plugins)

	context context.Context   // Context for managing plugin manager lifecycle
	watcher *fsnotify.Watcher // watcher for kernel plugin source file changes, to trigger hot reload

	sourceWatch     pluginSourceWatchState
	sourceWatchMode pluginSourceWatchMode

	plugins   sync.Map // map[string]*KernelPlugin
	pluginsMu sync.Map // map[string]*sync.Mutex, one per plugin name, to serialize start/stop of the same plugin while allowing concurrent start/stop of different plugins

}

type PluginInfo struct {
	Name      string           `json:"name"`
	State     string           `json:"state"`
	StateCode int              `json:"stateCode"`
	Methods   []*RpcMethodInfo `json:"methods"`
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

	model.OnKernelPluginsStart = func() { GetManager().Start() }
	model.OnKernelPluginsStop = func() { GetManager().Stop() }

	m.Start()
}

// GetManager returns the singleton PluginManager.
func GetManager() *PluginManager {
	managerOnce.Do(func() {
		context := context.Background()
		sourceWatchMode := currentPluginSourceWatchMode()

		var watcher *fsnotify.Watcher
		if sourceWatchMode == pluginSourceWatchEvents {
			var err error
			watcher, err = fsnotify.NewWatcher()
			if err != nil {
				logging.LogErrorf("failed to create kernel plugin source file watcher: %s", err)
			}
		}

		manager = &PluginManager{
			state: PluginManagerStateStopped,

			pluginsDir: filepath.Join(util.DataDir, "plugins"),

			context:         context,
			watcher:         watcher,
			sourceWatchMode: sourceWatchMode,
		}
		manager.sourceWatch = newPluginSourceWatchState(func(name string) {
			petal := model.GetPetalByName(name)
			if petal == nil || !petal.Enabled {
				return
			}
			logging.LogInfof("[plugin:%s] source file kernel.js changed, reloading plugin", petal.Name)
			model.SetPetalEnabled(petal.Name, petal.Enabled)
		})

		switch sourceWatchMode {
		case pluginSourceWatchEvents:
			if watcher == nil {
				return
			}
			go func() {
				defer watcher.Close()

				for {
					select {
					case <-context.Done():
						return
					case event, ok := <-watcher.Events:
						if !ok {
							return
						}
						manager.handlePluginSourceEvent(event)
					case err, ok := <-watcher.Errors:
						if !ok {
							return
						}
						logging.LogErrorf("kernel plugin source file watcher error: %s", err)
					}
				}
			}()
		case pluginSourceWatchPolling:
			go manager.pollPluginSources(context)
		}
	})
	return manager
}

func (m *PluginManager) State() PluginManagerState {
	m.lifecycleMu.RLock()
	defer m.lifecycleMu.RUnlock()
	return m.state
}

// Start loads and starts all kernel-eligible plugins.
// Called from main.go after model initialization.
func (m *PluginManager) Start() {
	defer func() {
		if r := recover(); r != nil {
			logging.LogErrorf("kernel plugin manager failed to start: %v", r)
		}
	}()

	if m.State() == PluginManagerStateRunning {
		logging.LogInfof("kernel plugin manager is already running, skipping start")
		return
	}

	if !model.IsPetalsEnabled() {
		logging.LogInfof("kernel plugins are disabled by configuration, skipping start")
		return
	}

	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()

	logging.LogInfof("kernel plugin manager starting")

	petals := model.LoadKernelPetals()

	all := len(petals)
	counter := int64(0)

	wg := sync.WaitGroup{}
	for _, petal := range petals {
		wg.Go(func() {
			if ok := m.StartPlugin(petal); ok {
				atomic.AddInt64(&counter, 1)
			}
		})
	}
	wg.Wait()

	m.state = PluginManagerStateRunning
	logging.LogInfof("kernel plugin manager started, %d/%d plugin(s) loaded", counter, all)
}

// Stop shuts down all running kernel plugins.
// Called from model.Close() before process exit.
func (m *PluginManager) Stop() {
	defer func() {
		if r := recover(); r != nil {
			logging.LogErrorf("kernel plugin manager failed to stop: %v", r)
		}
	}()

	if m.State() == PluginManagerStateStopped {
		logging.LogInfof("kernel plugin manager is already stopped, skipping stop")
		return
	}

	m.lifecycleMu.Lock()
	defer m.lifecycleMu.Unlock()

	logging.LogInfof("kernel plugin manager stopping")

	all := int64(0)
	counter := int64(0)

	wg := sync.WaitGroup{}
	m.plugins.Range(func(key, value any) bool {
		atomic.AddInt64(&all, 1)
		if p, ok := value.(*KernelPlugin); ok {
			wg.Go(func() {
				if ok := m.StopPlugin(p.Petal); ok {
					atomic.AddInt64(&counter, 1)
				}
			})
		}
		return true
	})
	wg.Wait()

	m.state = PluginManagerStateStopped
	logging.LogInfof("kernel plugin manager stopped, %d/%d plugin(s) unloaded", counter, all)
}

// StartPlugin starts a single kernel plugin.
// Called when a petal is enabled via SetPetalEnabled.
func (m *PluginManager) StartPlugin(petal *model.Petal) (ok bool) {
	defer func() {
		if r := recover(); r != nil {
			logging.LogErrorf("[plugin:%s] panic during start: %v", petal.Name, r)
			ok = false
		}
	}()

	if !model.IsPetalsEnabled() {
		ok = false
		return
	}

	if petal.Kernel.Incompatible || !petal.Kernel.Existed {
		ok = false
		return
	}

	pluginMu := m.getPluginMu(petal.Name)
	pluginMu.Lock()
	defer pluginMu.Unlock()

	// Stop any running instance inside the same lock so that concurrent hot-reload goroutines queue here and each one sees the instance started by the previous.
	m.stopLocked(petal.Name)

	p := NewKernelPlugin(m.context, petal)

	m.plugins.Store(p.Name, p)

	startErr := p.start()
	m.addPluginSourceWatch(petal.Name, petal.Kernel.JS)
	if startErr != nil {
		logging.LogErrorf("[plugin:%s] start failed: %s", p.Name, startErr)
		ok = false
		return
	}

	ok = true
	return
}

// StopPlugin stops a single kernel plugin.
// Called when a petal is disabled via SetPetalEnabled.
func (m *PluginManager) StopPlugin(petal *model.Petal) (ok bool) {
	defer func() {
		if r := recover(); r != nil {
			logging.LogErrorf("[plugin:%s] panic during stop: %v", petal.Name, r)
			ok = false
		}
	}()

	pluginMu := m.getPluginMu(petal.Name)
	pluginMu.Lock()
	defer pluginMu.Unlock()

	return m.stopLocked(petal.Name)
}

// stopLocked stops a running plugin by name. The caller must hold the per-plugin mutex.
func (m *PluginManager) stopLocked(name string) (ok bool) {
	m.removePluginSourceWatch(name)

	value, loaded := m.plugins.LoadAndDelete(name)
	if !loaded {
		return false
	}

	p := value.(*KernelPlugin)
	success, err := p.stop()
	if err != nil {
		logging.LogErrorf("[plugin:%s] stop failed: %s", name, err)
		return false
	}
	return success
}

// getPluginMu returns the per-plugin mutex for the given name, creating it if needed.
func (m *PluginManager) getPluginMu(name string) *sync.Mutex {
	v, _ := m.pluginsMu.LoadOrStore(name, &sync.Mutex{})
	return v.(*sync.Mutex)
}

// GetPlugin returns a loaded KernelPlugin by name, or nil.
func (m *PluginManager) GetPlugin(name string) *KernelPlugin {
	value, loaded := m.plugins.Load(name)
	if loaded {
		return value.(*KernelPlugin)
	}
	return nil
}

// GetLoadedPlugin returns the plugin info for a loaded KernelPlugin by name, or nil.
func (m *PluginManager) GetLoadedPlugin(name string) (plugin *PluginInfo, found bool) {
	p := m.GetPlugin(name)
	if p != nil {
		return &PluginInfo{
			Name:      p.Name,
			State:     p.State().String(),
			StateCode: int(p.State()),
			Methods:   p.GetRpcMethodsInfo(),
		}, true
	}
	return nil, false
}

// GetLoadedPluginInfo returns a list of all loaded plugins with their RPC method info.
func (m *PluginManager) GetLoadedPluginsInfo() (plugins []*PluginInfo) {
	m.plugins.Range(func(key, value any) bool {
		p := value.(*KernelPlugin)
		plugins = append(plugins, &PluginInfo{
			Name:      p.Name,
			State:     p.State().String(),
			StateCode: int(p.State()),
			Methods:   p.GetRpcMethodsInfo(),
		})
		return true
	})
	return plugins
}

// addPluginSourceWatch 注册插件源码监听，用于 kernel.js 热重载。
func (m *PluginManager) addPluginSourceWatch(name, source string) {
	if m.sourceWatchMode == pluginSourceWatchDisabled {
		return
	}
	path := filepath.Join(m.pluginsDir, name)
	if m.sourceWatchMode == pluginSourceWatchEvents {
		if m.watcher == nil {
			return
		}
		if err := m.watcher.Add(path); err != nil {
			logging.LogErrorf("failed to add kernel plugin source path [%s] to watcher: %s", path, err)
			return
		}
	}
	m.sourceWatch.register(name, filepath.Join(path, "kernel.js"), source)
}

// removePluginSourceWatch 在插件停止时移除源码监听。
func (m *PluginManager) removePluginSourceWatch(name string) (err error) {
	m.sourceWatch.unregister(name)
	if m.sourceWatchMode != pluginSourceWatchEvents || m.watcher == nil {
		return
	}
	path := filepath.Join(m.pluginsDir, name)
	err = m.watcher.Remove(path)
	return
}

// pollPluginSources 在 macOS 上集中轮询已注册的 kernel.js。
func (m *PluginManager) pollPluginSources(ctx context.Context) {
	ticker := time.NewTicker(pluginSourcePollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.sourceWatch.scan()
		}
	}
}
