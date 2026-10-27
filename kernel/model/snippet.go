// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var snippetsLock = sync.Mutex{}

var ErrSnippetConflict = errors.New("snippet revision conflict")

// SnippetsRevision 包含顺序和全部字段；缺失配置与空列表表示相同的初始状态。
func SnippetsRevision(snippets []*conf.Snippet) string {
	if snippets == nil {
		snippets = []*conf.Snippet{}
	}
	data, _ := json.Marshal(snippets)
	return fmt.Sprintf("%x", sha256.Sum256(data))
}

func RemoveSnippet(id string) (ret *conf.Snippet, err error) {
	snippetsLock.Lock()
	defer snippetsLock.Unlock()

	snippets, err := loadSnippets()
	if err != nil {
		return
	}

	for i, s := range snippets {
		if s.ID == id {
			ret = s
			snippets = append(snippets[:i], snippets[i+1:]...)
			break
		}
	}
	err = writeSnippetsConf(snippets)
	if err == nil {
		IncSyncIfNeeded(filepath.Join(util.SnippetsPath, "conf.json"))
	}
	return
}

// SetSnippet 的可选版本参数用于全量保存的并发校验；省略时保留历史接口行为。
func SetSnippet(snippets []*conf.Snippet, expectedRevision ...string) (err error) {
	snippetsLock.Lock()
	defer snippetsLock.Unlock()
	if len(expectedRevision) > 0 {
		current, loadErr := loadSnippets()
		if loadErr != nil {
			return loadErr
		}
		if expectedRevision[0] != SnippetsRevision(current) {
			return ErrSnippetConflict
		}
	}

	err = writeSnippetsConf(snippets)
	if err == nil {
		IncSyncIfNeeded(filepath.Join(util.SnippetsPath, "conf.json"))
	}
	return
}

func LoadSnippets() (ret []*conf.Snippet, err error) {
	snippetsLock.Lock()
	defer snippetsLock.Unlock()
	return loadSnippets()
}

func loadSnippets() (ret []*conf.Snippet, err error) {
	ret = []*conf.Snippet{}
	confPath := filepath.Join(util.SnippetsPath, "conf.json")
	if !filelock.IsExist(confPath) {
		return
	}

	data, err := filelock.ReadFile(confPath)
	if err != nil {
		logging.LogErrorf("load snippets failed: %s", err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, &ret); err != nil {
		logging.LogErrorf("unmarshal snippets failed: %s", err)
		return
	}
	for _, snippet := range ret {
		if snippet == nil {
			return nil, fmt.Errorf("invalid null snippet; original configuration preserved")
		}
	}

	needRewrite := false
	var cssTotal, cssEnabled, jsTotal, jsEnabled int
	for _, snippet := range ret {
		if "" == snippet.ID {
			snippet.ID = ast.NewNodeID()
			needRewrite = true
		}
		switch snippet.Type {
		case "css":
			cssTotal++
			if snippet.Enabled {
				cssEnabled++
			}
		case "js":
			jsTotal++
			if snippet.Enabled {
				jsEnabled++
			}
		}
	}
	if needRewrite {
		writeSnippetsConf(ret)
	}
	logging.LogDebugf("loaded snippets [css %d/%d, js %d/%d]", cssEnabled, cssTotal, jsEnabled, jsTotal)
	return
}

func writeSnippetsConf(snippets []*conf.Snippet) (err error) {
	data, err := gulu.JSON.MarshalIndentJSON(snippets, "", "  ")
	if err != nil {
		logging.LogErrorf("marshal snippets failed: %s", err)
		return
	}

	if err = os.MkdirAll(util.SnippetsPath, 0755); err != nil {
		return
	}

	confPath := filepath.Join(util.SnippetsPath, "conf.json")
	oldData, _ := filelock.ReadFile(confPath)
	if string(oldData) == string(data) {
		return
	}
	err = filelock.WriteFile(confPath, data)
	return
}
