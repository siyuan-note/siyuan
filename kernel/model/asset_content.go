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
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var assetContentSearcher = NewAssetsSearcher()

func IndexAssetContent(absPath string) {
	assetsDir := util.GetDataAssetsAbsPath()

	ext := strings.ToLower(filepath.Ext(absPath))
	parser, found := assetContentSearcher.Parsers[ext]
	if !found {
		return
	}

	result := parser.Parse(absPath)
	if nil == result {
		return
	}

	info, err := os.Stat(absPath)
	if nil != err {
		logging.LogErrorf("stat [%s] failed: %s", absPath, err)
		return
	}

	p := "assets" + filepath.ToSlash(strings.TrimPrefix(absPath, assetsDir))

	assetContents := []*sql.AssetContent{
		{
			ID:      ast.NewNodeID(),
			Name:    filepath.Base(p),
			Ext:     filepath.Ext(p),
			Path:    p,
			Size:    info.Size(),
			Updated: info.ModTime().Unix(),
			Content: result.Content,
		},
	}

	sql.DeleteAssetContentsByPathQueue(p)
	sql.IndexAssetContentsQueue(assetContents)
}

func ReindexAssetContent() {
	task.AppendTask(task.AssetContentDatabaseIndexFull, fullReindexAssetContent)
	return
}

func fullReindexAssetContent() {
	util.PushMsg(Conf.Language(216), 7*1000)
	sql.InitAssetContentDatabase(true)

	assetContentSearcher.FullIndex()
	return
}

func init() {
	subscribeSQLAssetContentEvents()
}

func subscribeSQLAssetContentEvents() {
	eventbus.Subscribe(util.EvtSQLAssetContentRebuild, func() {
		ReindexAssetContent()
	})
}

var (
	AssetsSearchEnabled = true
)

type AssetsSearcher struct {
	Parsers map[string]AssetParser

	lock *sync.Mutex
}

func (searcher *AssetsSearcher) FullIndex() {
	assetsDir := util.GetDataAssetsAbsPath()
	if !gulu.File.IsDir(assetsDir) {
		return
	}

	var results []*AssetParseResult
	filepath.Walk(assetsDir, func(absPath string, info fs.FileInfo, err error) error {
		if nil != err {
			logging.LogErrorf("walk dir [%s] failed: %s", absPath, err)
			return err
		}

		if info.IsDir() {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(absPath))
		parser, found := searcher.Parsers[ext]
		if !found {
			return nil
		}

		result := parser.Parse(absPath)
		if nil == result {
			return nil
		}

		result.Path = "assets" + filepath.ToSlash(strings.TrimPrefix(absPath, assetsDir))
		result.Size = info.Size()
		result.Updated = info.ModTime().Unix()
		results = append(results, result)
		return nil
	})

	var assetContents []*sql.AssetContent
	for _, result := range results {
		assetContents = append(assetContents, &sql.AssetContent{
			ID:      ast.NewNodeID(),
			Name:    filepath.Base(result.Path),
			Ext:     filepath.Ext(result.Path),
			Path:    result.Path,
			Size:    result.Size,
			Updated: result.Updated,
			Content: result.Content,
		})
	}

	sql.IndexAssetContentsQueue(assetContents)
}

func NewAssetsSearcher() *AssetsSearcher {
	return &AssetsSearcher{
		Parsers: map[string]AssetParser{
			".txt":      &TxtAssetParser{},
			".md":       &TxtAssetParser{},
			".markdown": &TxtAssetParser{},
		},

		lock: &sync.Mutex{},
	}
}

type AssetParseResult struct {
	Path    string
	Size    int64
	Updated int64
	Content string
}

type AssetParser interface {
	Parse(absPath string) *AssetParseResult
}

type TxtAssetParser struct {
}

func (parser *TxtAssetParser) Parse(absPath string) (ret *AssetParseResult) {
	if !strings.HasSuffix(strings.ToLower(absPath), ".txt") {
		return
	}

	data, err := filelock.ReadFile(absPath)
	if nil != err {
		logging.LogErrorf("read file [%s] failed: %s", absPath, err)
		return
	}

	ret = &AssetParseResult{
		Content: string(data),
	}
	return
}
