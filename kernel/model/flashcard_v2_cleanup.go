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

package model

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/conf"
	flashcardv2 "github.com/siyuan-note/siyuan/kernel/flashcard"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// InspectInvalidFlashcardV2Sources 独立核验源文件，不把可重建索引中的缺失作为删除依据。
func InspectInvalidFlashcardV2Sources(ctx context.Context) (flashcardv2.InvalidSourcesReport, error) {
	store, err := requireFlashcardV2Store(ctx, false)
	if err != nil {
		return flashcardv2.InvalidSourcesReport{}, err
	}
	return store.InspectInvalidSources(ctx, resolveFlashcardBlockPresence)
}

// DeleteInvalidFlashcardV2Sources 串行处理同步和编辑事务，并在删除前重新核验文件。
func DeleteInvalidFlashcardV2Sources(ctx context.Context, request flashcardv2.DeleteInvalidSourcesRequest) (flashcardv2.DeleteInvalidSourcesResult, error) {
	syncLock.Lock()
	defer syncLock.Unlock()
	FlushTxQueue()
	flushLock.Lock()
	defer flushLock.Unlock()
	store, err := requireFlashcardV2Store(ctx, true)
	if err != nil {
		return flashcardv2.DeleteInvalidSourcesResult{}, err
	}
	request.ChangedAt = time.Now().UnixMilli()
	return store.DeleteInvalidSources(ctx, request, resolveFlashcardBlockPresence)
}

type flashcardFileStamp struct {
	Size     int64
	Modified int64
	Mode     fs.FileMode
}

// flashcardCleanupInventory 同时记录目录，检测扫描期间发生的新增、移动和恢复。
func flashcardCleanupInventory(ctx context.Context, dataDir string) (map[string]flashcardFileStamp, error) {
	ret := map[string]flashcardFileStamp{}
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if !ast.IsNodeIDPattern(entry.Name()) {
			continue
		}
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return nil, errors.New("unsupported notebook path")
		}
		err = filepath.WalkDir(filepath.Join(dataDir, entry.Name()), func(path string, d fs.DirEntry, walkErr error) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			if walkErr != nil {
				return walkErr
			}
			if d.Type()&os.ModeSymlink != 0 {
				return errors.New("unsupported notebook symbolic link")
			}
			if !d.IsDir() && !strings.HasSuffix(d.Name(), ".sy") && d.Name() != "conf.json" {
				return nil
			}
			info, err := d.Info()
			if err != nil {
				return err
			}
			ret[path] = flashcardFileStamp{Size: info.Size(), Modified: info.ModTime().UnixNano(), Mode: info.Mode()}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return ret, nil
}

type flashcardCleanupNode struct {
	ID         string
	Type       string
	Spec       string
	Properties map[string]string
	Children   []flashcardCleanupNode
}

func resolveFlashcardBlockPresence(ctx context.Context, blockIDs []string) (map[string]flashcardv2.BlockPresence, error) {
	return scanFlashcardBlockPresence(ctx, util.DataDir, blockIDs, IsEncryptedBox)
}

// scanFlashcardBlockPresence 只读普通笔记本，包括关闭的笔记本；任何不完整扫描都保留未找到的引用。
func scanFlashcardBlockPresence(ctx context.Context, dataDir string, blockIDs []string,
	isEncrypted func(string) bool) (map[string]flashcardv2.BlockPresence, error) {
	ret := map[string]flashcardv2.BlockPresence{}
	if len(blockIDs) == 0 {
		return ret, nil
	}
	for _, id := range blockIDs {
		ret[id] = flashcardv2.BlockUnknown
	}
	before, err := flashcardCleanupInventory(ctx, dataDir)
	if err != nil {
		return ret, err
	}
	complete := true
	boxes := map[string]*conf.BoxConf{}
	for path, stamp := range before {
		rel, relErr := filepath.Rel(dataDir, path)
		if relErr != nil {
			return ret, relErr
		}
		parts := strings.Split(rel, string(filepath.Separator))
		if len(parts) != 1 || !stamp.Mode.IsDir() {
			continue
		}
		boxID := parts[0]
		if isEncrypted(boxID) {
			complete = false
			continue
		}
		data, readErr := filelock.ReadFile(filepath.Join(path, ".siyuan", "conf.json"))
		var box conf.BoxConf
		if readErr != nil || json.Unmarshal(data, &box) != nil || box.Encrypted || box.BoxCrypt != nil {
			complete = false
			continue
		}
		boxes[boxID] = &box
	}
	for path, stamp := range before {
		if err = ctx.Err(); err != nil {
			return ret, err
		}
		if stamp.Mode.IsDir() || !strings.HasSuffix(path, ".sy") {
			continue
		}
		rel, _ := filepath.Rel(dataDir, path)
		box := boxes[strings.Split(rel, string(filepath.Separator))[0]]
		if box == nil {
			continue
		}
		data, readErr := filelock.ReadFile(path)
		var root flashcardCleanupNode
		if readErr != nil || json.Unmarshal(data, &root) != nil || root.Type != "NodeDocument" ||
			root.ID != strings.TrimSuffix(filepath.Base(path), ".sy") ||
			(root.Spec != "" && root.Spec != "1" && root.Spec != "2" && root.Spec != "3" && root.Spec != "4") {
			complete = false
			continue
		}
		var visit func(flashcardCleanupNode)
		visit = func(node flashcardCleanupNode) {
			if node.Type == "" {
				complete = false
			}
			// 同时保留兼容格式的属性 ID，宁可少清理，也不因旧格式差异误删。
			for _, id := range []string{node.ID, node.Properties["id"]} {
				if _, wanted := ret[id]; wanted {
					if box.Closed {
						ret[id] = flashcardv2.BlockClosed
					} else if ret[id] != flashcardv2.BlockClosed {
						ret[id] = flashcardv2.BlockPresent
					}
				}
			}
			for _, child := range node.Children {
				visit(child)
			}
		}
		visit(root)
	}
	after, err := flashcardCleanupInventory(ctx, dataDir)
	if err != nil {
		return ret, err
	}
	if !reflect.DeepEqual(before, after) {
		return ret, errors.New("notebook files changed during flashcard inspection")
	}
	if complete {
		for id, state := range ret {
			if state == flashcardv2.BlockUnknown {
				ret[id] = flashcardv2.BlockMissing
			}
		}
	}
	return ret, nil
}
