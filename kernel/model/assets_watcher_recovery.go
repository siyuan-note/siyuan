// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !darwin

package model

import (
	"os"
	"path/filepath"
	"slices"

	"github.com/fsnotify/fsnotify"
)

// Track only the watched root's direct files, matching fsnotify's non-recursive scope.
type assetWatchRecovery struct {
	root     string
	watcher  *fsnotify.Watcher
	identity os.FileInfo
	known    map[string]bool
	pending  bool
}

func newAssetWatchRecovery(watcher *fsnotify.Watcher, root string) *assetWatchRecovery {
	state := &assetWatchRecovery{root: root, watcher: watcher, known: map[string]bool{}}
	state.identity, _ = statAssetWatchRoot(root)
	if files, err := state.files(); err == nil {
		state.known = files
	} else {
		state.pending = true
	}
	return state
}

func statAssetWatchRoot(root string) (os.FileInfo, error) {
	// File.Stat captures the identity from the handle. On Windows, os.Stat may
	// defer identity lookup until SameFile, after the original path was replaced.
	directory, err := os.Open(root)
	if err != nil {
		return nil, err
	}
	defer directory.Close()
	return directory.Stat()
}

func (state *assetWatchRecovery) files() (map[string]bool, error) {
	entries, err := os.ReadDir(state.root)
	if err != nil {
		return nil, err
	}
	files := map[string]bool{}
	for _, entry := range entries {
		if !entry.IsDir() {
			files[filepath.Join(state.root, entry.Name())] = true
		}
	}
	return files, nil
}

func (state *assetWatchRecovery) remember(batch assetWatchBatch) {
	for name := range batch {
		if filepath.Dir(name) != state.root {
			continue
		}
		info, err := os.Stat(name)
		if err == nil && !info.IsDir() {
			state.known[name] = true
		} else if os.IsNotExist(err) {
			delete(state.known, name)
		}
	}
}

// recover rebinds a replaced root and reconciles all paths after lost notifications.
// Failed scans retain the known set and are retried; an unreadable root is not empty.
func (state *assetWatchRecovery) recover(overflow bool) (assetWatchBatch, error) {
	state.pending = state.pending || overflow
	info, err := statAssetWatchRoot(state.root)
	if err != nil {
		state.pending = true
		return nil, err
	}
	if state.identity == nil || !os.SameFile(state.identity, info) || !slices.Contains(state.watcher.WatchList(), state.root) {
		state.pending = true
		// The old watch may already have been removed by the platform.
		_ = state.watcher.Remove(state.root)
		if err = state.watcher.Add(state.root); err != nil {
			return nil, err
		}
		state.identity = info
	}
	if !state.pending {
		return nil, nil
	}
	files, err := state.files()
	if err != nil {
		return nil, err
	}
	batch := assetWatchBatch{}
	for name := range state.known {
		batch.add(name, true)
	}
	for name := range files {
		batch.add(name, true)
	}
	state.known, state.pending = files, false
	return batch, nil
}
