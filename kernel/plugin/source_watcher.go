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
	"crypto/sha256"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	pluginSourceReloadDelay  = 300 * time.Millisecond
	pluginSourcePollInterval = time.Second
)

var errPluginFileWatchUnsupported = errors.New("plugin file watcher is not supported on mobile")

type pluginSourceWatchMode uint8

const (
	pluginSourceWatchDisabled pluginSourceWatchMode = iota
	pluginSourceWatchEvents
	pluginSourceWatchPolling
)

type pluginSourceWatchEntry struct {
	path       string
	signature  [sha256.Size]byte
	fileState  pluginSourceFileState
	lastError  string
	verified   bool
	generation uint64
	timer      *time.Timer
}

type pluginSourceFileState struct {
	exists  bool
	size    int64
	modTime int64
	device  uint64
	inode   uint64
	ctime   int64
}

type pluginSourceWatchState struct {
	mu         sync.Mutex
	entries    map[string]*pluginSourceWatchEntry
	generation uint64
	delay      time.Duration
	reload     func(name string)
}

func newPluginSourceWatchState(reload func(name string)) pluginSourceWatchState {
	return pluginSourceWatchState{
		entries: map[string]*pluginSourceWatchEntry{},
		delay:   pluginSourceReloadDelay,
		reload:  reload,
	}
}

func isPluginFileWatchSupported() bool {
	return !util.IsMobileContainer()
}

func currentPluginSourceWatchMode() pluginSourceWatchMode {
	return selectPluginSourceWatchMode(runtime.GOOS, util.IsMobileContainer())
}

func selectPluginSourceWatchMode(goos string, mobile bool) pluginSourceWatchMode {
	if mobile {
		return pluginSourceWatchDisabled
	}
	if goos == "darwin" {
		return pluginSourceWatchPolling
	}
	return pluginSourceWatchEvents
}

func (s *pluginSourceWatchState) register(name, path, source string) {
	fileState, _ := readPluginSourceFileState(path)

	s.mu.Lock()
	defer s.mu.Unlock()

	if old := s.entries[name]; old != nil && old.timer != nil {
		old.timer.Stop()
	}
	s.generation++
	entry := &pluginSourceWatchEntry{
		path:       path,
		signature:  sha256.Sum256([]byte(source)),
		fileState:  fileState,
		generation: s.generation,
	}
	s.entries[name] = entry
	s.scheduleLocked(name, entry, &fileState)
}

func (s *pluginSourceWatchState) unregister(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if entry := s.entries[name]; entry != nil && entry.timer != nil {
		entry.timer.Stop()
	}
	delete(s.entries, name)
}

func (s *pluginSourceWatchState) scan() {
	s.mu.Lock()
	entries := make(map[string]pluginSourceWatchSnapshot, len(s.entries))
	for name, entry := range s.entries {
		entries[name] = pluginSourceWatchSnapshot{
			path:       entry.path,
			generation: entry.generation,
			fileState:  entry.fileState,
			verified:   entry.verified,
		}
	}
	s.mu.Unlock()

	for name, snapshot := range entries {
		fileState, err := readPluginSourceFileState(snapshot.path)
		if err != nil {
			s.logReadError(name, snapshot.generation, snapshot.path, err)
			continue
		}
		if snapshot.verified && fileState == snapshot.fileState {
			s.clearReadError(name, snapshot.generation)
			continue
		}
		s.scheduleIfCurrent(name, snapshot.generation, &fileState)
	}
}

func (s *pluginSourceWatchState) schedule(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entry := s.entries[name]
	if entry == nil {
		return
	}
	s.scheduleLocked(name, entry, nil)
}

func (s *pluginSourceWatchState) scheduleIfCurrent(name string, generation uint64, expected *pluginSourceFileState) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entry := s.entries[name]
	if entry == nil || entry.generation != generation {
		return
	}
	s.scheduleLocked(name, entry, expected)
}

func (s *pluginSourceWatchState) scheduleLocked(name string, entry *pluginSourceWatchEntry, expected *pluginSourceFileState) {
	s.generation++
	entry.generation = s.generation
	generation := entry.generation
	if entry.timer != nil {
		entry.timer.Stop()
	}
	entry.timer = time.AfterFunc(s.delay, func() {
		s.reloadIfChanged(name, generation, expected)
	})
}

func (s *pluginSourceWatchState) reloadIfChanged(name string, generation uint64, expected *pluginSourceFileState) {
	s.mu.Lock()
	entry := s.entries[name]
	if entry == nil || entry.generation != generation {
		s.mu.Unlock()
		return
	}
	path := entry.path
	previous := entry.signature
	s.mu.Unlock()

	fileState, err := readPluginSourceFileState(path)
	if err != nil {
		s.finishReadError(name, generation, path, err)
		return
	}
	if expected != nil && fileState != *expected {
		s.scheduleIfCurrent(name, generation, &fileState)
		return
	}
	if !fileState.exists {
		s.finishPluginSourceCheck(name, generation, fileState, previous, false)
		return
	}

	data, err := os.ReadFile(path)
	if err != nil {
		s.finishReadError(name, generation, path, err)
		return
	}
	latestFileState, err := readPluginSourceFileState(path)
	if err != nil {
		s.finishReadError(name, generation, path, err)
		return
	}
	if latestFileState != fileState {
		s.scheduleIfCurrent(name, generation, &latestFileState)
		return
	}

	signature := sha256.Sum256(data)
	s.finishPluginSourceCheck(name, generation, latestFileState, signature, signature != previous)
}

func (s *pluginSourceWatchState) finishPluginSourceCheck(
	name string,
	generation uint64,
	fileState pluginSourceFileState,
	signature [sha256.Size]byte,
	changed bool,
) {
	s.mu.Lock()
	entry := s.entries[name]
	if entry == nil || entry.generation != generation {
		s.mu.Unlock()
		return
	}
	entry.fileState = fileState
	entry.lastError = ""
	entry.signature = signature
	entry.verified = true
	entry.timer = nil
	reload := s.reload
	s.mu.Unlock()

	if changed && reload != nil {
		reload(name)
	}
}

func (s *pluginSourceWatchState) finishReadError(name string, generation uint64, path string, err error) {
	s.mu.Lock()
	entry := s.entries[name]
	if entry == nil || entry.generation != generation {
		s.mu.Unlock()
		return
	}
	entry.timer = nil
	message := err.Error()
	if entry.lastError == message {
		s.mu.Unlock()
		return
	}
	entry.lastError = message
	s.mu.Unlock()

	if !os.IsNotExist(err) {
		logging.LogWarnf("read kernel plugin source file [%s] failed: %s", path, err)
	}
}

func (s *pluginSourceWatchState) logReadError(name string, generation uint64, path string, err error) {
	s.mu.Lock()
	entry := s.entries[name]
	if entry == nil || entry.generation != generation {
		s.mu.Unlock()
		return
	}
	message := err.Error()
	if entry.lastError == message {
		s.mu.Unlock()
		return
	}
	entry.lastError = message
	s.mu.Unlock()

	logging.LogWarnf("read kernel plugin source file [%s] failed: %s", path, err)
}

func (s *pluginSourceWatchState) clearReadError(name string, generation uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entry := s.entries[name]
	if entry != nil && entry.generation == generation {
		entry.lastError = ""
	}
}

type pluginSourceWatchSnapshot struct {
	path       string
	generation uint64
	fileState  pluginSourceFileState
	verified   bool
}

func readPluginSourceFileState(path string) (pluginSourceFileState, error) {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return pluginSourceFileState{}, nil
	}
	if err != nil {
		return pluginSourceFileState{}, err
	}
	device, inode, ctime := readPluginSourceFileIdentity(info)
	return pluginSourceFileState{
		exists:  true,
		size:    info.Size(),
		modTime: info.ModTime().UnixNano(),
		device:  device,
		inode:   inode,
		ctime:   ctime,
	}, nil
}

func (m *PluginManager) handlePluginSourceEvent(event fsnotify.Event) {
	if filepath.Base(event.Name) != "kernel.js" {
		return
	}
	if !event.Has(fsnotify.Create) && !event.Has(fsnotify.Write) &&
		!event.Has(fsnotify.Rename) && !event.Has(fsnotify.Remove) {
		return
	}

	m.sourceWatch.schedule(filepath.Base(filepath.Dir(event.Name)))
}
