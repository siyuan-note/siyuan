// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// Ordinary cleanup shares the editing/sync lock order with encrypted cleanup.
// Writers outside those locks (templates and agent sessions, for example) are
// covered by source checks before and after removal, with restoration on change.
func beginOrdinaryAssetCleanup() (verify func() error, release func(), err error) {
	syncLock.Lock()
	FlushTxQueue()
	flushLock.Lock()
	release = func() {
		flushLock.Unlock()
		syncLock.Unlock()
	}
	if txQueueSize() != 0 {
		release()
		return nil, nil, errors.New("editing transactions are pending; retry asset cleanup")
	}
	before, err := ordinaryAssetCleanupSourceDigest()
	if err != nil {
		release()
		return nil, nil, err
	}
	verify = func() error {
		after, readErr := ordinaryAssetCleanupSourceDigest()
		if readErr != nil {
			return readErr
		}
		if before != after || txQueueSize() != 0 {
			return errors.New("asset references changed during cleanup; retry the request")
		}
		return nil
	}
	return
}

func ordinaryAssetCleanupSourceDigest() (string, error) {
	hash := sha256.New()
	walk := func(root string, accept func(string) bool, notebook bool) error {
		return filepath.WalkDir(root, func(p string, entry fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				if p == root && os.IsNotExist(walkErr) {
					fmt.Fprintln(hash, root, "missing")
					return nil
				}
				return walkErr
			}
			if entry.IsDir() {
				if notebook && p != root && (entry.Name() == "assets" || strings.HasPrefix(entry.Name(), ".")) {
					return filepath.SkipDir
				}
				fmt.Fprintln(hash, "directory", p)
				return nil
			}
			if !accept(entry.Name()) {
				return nil
			}
			filelock.Lock(p)
			data, readErr := os.ReadFile(p)
			filelock.Unlock(p)
			if readErr != nil {
				return readErr
			}
			fmt.Fprintf(hash, "%q %x\n", p, sha256.Sum256(data))
			return nil
		})
	}
	entries, err := os.ReadDir(util.DataDir)
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		if !entry.IsDir() || !ast.IsNodeIDPattern(entry.Name()) {
			continue
		}
		boxRoot := filepath.Join(util.DataDir, entry.Name())
		fmt.Fprintln(hash, "notebook", boxRoot)
		confPath := filepath.Join(boxRoot, ".siyuan", "conf.json")
		data, readErr := os.ReadFile(confPath)
		if readErr != nil && !os.IsNotExist(readErr) {
			return "", readErr
		}
		fmt.Fprintf(hash, "%q %x\n", confPath, sha256.Sum256(data))
		if IsEncryptedBox(entry.Name()) {
			continue
		}
		if err = walk(boxRoot, func(name string) bool { return strings.HasSuffix(name, ".sy") }, true); err != nil {
			return "", err
		}
	}
	templates := filepath.Join(util.DataDir, "templates")
	if resolved, resolveErr := filepath.EvalSymlinks(templates); resolveErr == nil {
		templates = resolved
	} else if !os.IsNotExist(resolveErr) {
		return "", resolveErr
	}
	for _, source := range []struct {
		root   string
		accept func(string) bool
	}{
		{templates, func(name string) bool { return strings.HasSuffix(strings.ToLower(name), ".md") }},
		{filepath.Join(util.DataDir, "storage", "av"), func(name string) bool { return strings.HasSuffix(name, ".json") }},
		{filepath.Join(util.DataDir, "storage", "ai", "agent", "sessions"), func(name string) bool { return name == "session.json" || name == "runtime.json" }},
	} {
		if err = walk(source.root, source.accept, false); err != nil {
			return "", err
		}
	}
	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}

// Call only after every candidate has a complete history backup. The second
// check catches saves completed between the first check and an actual removal.
func removeOrdinaryUnusedAssets(items []*UnusedItem, historyDir string, verify func() error, remove func(string) error) (removed []string, size int64, err error) {
	removed = []string{}
	if err = verify(); err != nil {
		return
	}
	var attempted []string
	defer func() {
		if err == nil {
			return
		}
		for _, relative := range attempted {
			source, target := filepath.Join(historyDir, relative), filepath.Join(util.DataDir, relative)
			info, statErr := os.Stat(source)
			if statErr != nil {
				err = errors.Join(err, statErr)
				continue
			}
			var restoreErr error
			if info.IsDir() {
				restoreErr = promoteAssetDirectory(source, target)
			} else {
				restoreErr = os.MkdirAll(filepath.Dir(target), 0755)
				if restoreErr == nil {
					restoreErr = copyPromotedAsset(source, target)
				}
			}
			if restoreErr != nil {
				err = errors.Join(err, fmt.Errorf("restore asset [%s] from [%s]: %w", target, source, restoreErr))
			}
		}
		removed, size = nil, 0
	}()
	for _, item := range items {
		absPath := filepath.Join(util.DataDir, item.Item)
		info, statErr := os.Stat(absPath)
		if os.IsNotExist(statErr) {
			continue
		}
		if statErr != nil {
			err = statErr
			return
		}
		if info.IsDir() {
			dirSize, _ := util.SizeOfDirectory(absPath)
			size += dirSize
		} else {
			size += info.Size()
		}
		attempted = append(attempted, item.Item)
		if err = remove(absPath); err != nil {
			return
		}
		removed = append(removed, absPath)
	}
	err = verify()
	return
}
