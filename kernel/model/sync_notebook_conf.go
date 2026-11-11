// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const notebookConfSyncSuffix = "/.siyuan/conf.json"

type syncedNotebookConfChange struct {
	unindex, index, closed bool
	name, icon, sort       bool
}

func syncNotebookConfBoxID(path string) string {
	boxID, ok := strings.CutSuffix(strings.TrimPrefix(path, "/"), notebookConfSyncSuffix)
	if ok && ast.IsNodeIDPattern(boxID) {
		return boxID
	}
	return ""
}

func snapshotSyncNotebookConfs(files []*entity.File, previous map[string][]byte) {
	for _, file := range files {
		boxID := syncNotebookConfBoxID(file.Path)
		if boxID == "" {
			continue
		}
		data, err := filelock.ReadFile(filepath.Join(util.DataDir, boxID, notebookConfSyncSuffix))
		if err != nil {
			delete(previous, boxID)
			continue
		}
		previous[boxID] = data
	}
}

func decodeSyncNotebookConf(data []byte) *conf.BoxConf {
	data = bytes.TrimSpace(data)
	if len(data) == 0 || data[0] != '{' {
		return nil
	}
	boxConf := conf.NewBoxConf()
	if err := json.Unmarshal(data, boxConf); err != nil {
		return nil
	}
	return boxConf
}

func classifySyncedNotebookConf(boxID string, previous []byte) syncedNotebookConfChange {
	rebuild := syncedNotebookConfChange{unindex: true, index: true}
	before := decodeSyncNotebookConf(previous)
	if before == nil {
		return rebuild
	}
	data, err := filelock.ReadFile(filepath.Join(util.DataDir, boxID, notebookConfSyncSuffix))
	if err != nil {
		return rebuild
	}
	after := decodeSyncNotebookConf(data)
	if after == nil || before.Encrypted != after.Encrypted || !reflect.DeepEqual(before.BoxCrypt, after.BoxCrypt) {
		return rebuild
	}
	if after.Encrypted {
		if err := validateBoxEncryption(after.BoxCrypt); err != nil {
			return rebuild
		}
		if dek, ok := cachedDEKCopy(boxID); ok {
			defer zeroAndClear(dek)
			verified := *after
			if err := decryptBoxMetadata(boxID, &verified, dek); err != nil {
				return rebuild
			}
		}
	} else if after.BoxCrypt != nil || IsEncryptedBox(boxID) {
		return rebuild
	}
	if before.Closed != after.Closed {
		closed := !after.Encrypted && after.Closed
		return syncedNotebookConfChange{unindex: true, index: !closed, closed: closed}
	}
	if !reflect.DeepEqual(before.Extra, after.Extra) {
		before.Extra, after.Extra = nil, nil
		if reflect.DeepEqual(before, after) {
			logging.LogDebugf("synced unknown notebook configuration fields [box=%s]", boxID)
		}
	}
	return syncedNotebookConfChange{
		closed: !after.Encrypted && after.Closed,
		name:   before.Name != after.Name,
		icon:   !after.Encrypted && filterBoxIcon(before.Icon) != filterBoxIcon(after.Icon),
		sort:   !after.Encrypted && before.Sort != after.Sort,
	}
}
