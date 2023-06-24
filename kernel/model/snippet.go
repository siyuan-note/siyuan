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

package model

import (
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

func RemoveSnippet(id string) (ret *conf.Snippet, err error) {
	snippetsLock.Lock()
	defer snippetsLock.Unlock()

	snippets, err := loadSnippets()
	if nil != err {
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
	return
}

func SetSnippet(snippets []*conf.Snippet) (err error) {
	snippetsLock.Lock()
	defer snippetsLock.Unlock()

	err = writeSnippetsConf(snippets)
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
	if !gulu.File.IsExist(confPath) {
		return
	}

	data, err := filelock.ReadFile(confPath)
	if nil != err {
		logging.LogErrorf("load js snippets failed: %s", err)
		return
	}

	if err = gulu.JSON.UnmarshalJSON(data, &ret); nil != err {
		logging.LogErrorf("unmarshal js snippets failed: %s", err)
		return
	}

	needRewrite := false
	for _, snippet := range ret {
		if "" == snippet.ID {
			snippet.ID = ast.NewNodeID()
			needRewrite = true
		}
	}
	if needRewrite {
		writeSnippetsConf(ret)
	}
	return
}

func writeSnippetsConf(snippets []*conf.Snippet) (err error) {
	data, err := gulu.JSON.MarshalIndentJSON(snippets, "", "  ")
	if nil != err {
		logging.LogErrorf("marshal snippets failed: %s", err)
		return
	}

	if err = os.MkdirAll(util.SnippetsPath, 0755); nil != err {
		return
	}

	confPath := filepath.Join(util.SnippetsPath, "conf.json")
	err = filelock.WriteFile(confPath, data)
	return
}
