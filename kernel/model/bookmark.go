// SiYuan - Build Your Eternal Digital Garden
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
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func RemoveBookmark(bookmark string) (err error) {
	util.PushEndlessProgress(Conf.Language(116))

	bookmarks := sql.QueryBookmarkBlocksByKeyword(bookmark)
	treeBlocks := map[string][]string{}
	for _, tag := range bookmarks {
		if blocks, ok := treeBlocks[tag.RootID]; !ok {
			treeBlocks[tag.RootID] = []string{tag.ID}
		} else {
			treeBlocks[tag.RootID] = append(blocks, tag.ID)
		}
	}

	for treeID, blocks := range treeBlocks {
		util.PushEndlessProgress("[" + treeID + "]")
		tree, e := loadTreeByBlockID(treeID)
		if nil != e {
			util.PushClearProgress()
			return e
		}

		for _, blockID := range blocks {
			node := treenode.GetNodeInTree(tree, blockID)
			if nil == node {
				continue
			}

			if bookmarkAttrVal := node.IALAttr("bookmark"); bookmarkAttrVal == bookmark {
				node.RemoveIALAttr("bookmark")
				cache.PutBlockIAL(node.ID, parse.IAL2Map(node.KramdownIAL))
			}
		}

		util.PushEndlessProgress(fmt.Sprintf(Conf.Language(111), tree.Root.IALAttr("title")))
		if err = writeJSONQueue(tree); nil != err {
			util.ClearPushProgress(100)
			return
		}
		util.RandomSleep(50, 150)
	}

	util.ReloadUI()
	return
}

func RenameBookmark(oldBookmark, newBookmark string) (err error) {
	if treenode.ContainsMarker(newBookmark) {
		return errors.New(Conf.Language(112))
	}

	newBookmark = strings.TrimSpace(newBookmark)
	if "" == newBookmark {
		return errors.New(Conf.Language(126))
	}

	if oldBookmark == newBookmark {
		return
	}

	util.PushEndlessProgress(Conf.Language(110))

	bookmarks := sql.QueryBookmarkBlocksByKeyword(oldBookmark)
	treeBlocks := map[string][]string{}
	for _, tag := range bookmarks {
		if blocks, ok := treeBlocks[tag.RootID]; !ok {
			treeBlocks[tag.RootID] = []string{tag.ID}
		} else {
			treeBlocks[tag.RootID] = append(blocks, tag.ID)
		}
	}

	for treeID, blocks := range treeBlocks {
		util.PushEndlessProgress("[" + treeID + "]")
		tree, e := loadTreeByBlockID(treeID)
		if nil != e {
			util.ClearPushProgress(100)
			return e
		}

		for _, blockID := range blocks {
			node := treenode.GetNodeInTree(tree, blockID)
			if nil == node {
				continue
			}

			if bookmarkAttrVal := node.IALAttr("bookmark"); bookmarkAttrVal == oldBookmark {
				node.SetIALAttr("bookmark", newBookmark)
				cache.PutBlockIAL(node.ID, parse.IAL2Map(node.KramdownIAL))
			}
		}

		util.PushEndlessProgress(fmt.Sprintf(Conf.Language(111), tree.Root.IALAttr("title")))
		if err = writeJSONQueue(tree); nil != err {
			util.ClearPushProgress(100)
			return
		}
		util.RandomSleep(50, 150)
	}

	util.ReloadUI()
	return
}

type BookmarkLabel string
type BookmarkBlocks []*Block

type Bookmark struct {
	Name   BookmarkLabel `json:"name"`
	Blocks []*Block      `json:"blocks"`
	Type   string        `json:"type"` // "bookmark"
	Depth  int           `json:"depth"`
	Count  int           `json:"count"`
}

type Bookmarks []*Bookmark

func (s Bookmarks) Len() int           { return len(s) }
func (s Bookmarks) Swap(i, j int)      { s[i], s[j] = s[j], s[i] }
func (s Bookmarks) Less(i, j int) bool { return s[i].Name < s[j].Name }

func BookmarkLabels() (ret []string) {
	ret = sql.QueryBookmarkLabels()
	return
}

func BuildBookmark() (ret *Bookmarks) {
	WaitForWritingFiles()
	if !sql.IsEmptyQueue() {
		sql.WaitForWritingDatabase()
	}

	ret = &Bookmarks{}
	sqlBlocks := sql.QueryBookmarkBlocks()
	labelBlocks := map[BookmarkLabel]BookmarkBlocks{}
	blocks := fromSQLBlocks(&sqlBlocks, "", 0)
	for _, block := range blocks {
		label := BookmarkLabel(block.IAL["bookmark"])

		if "" != block.Name {
			// Blocks in the bookmark panel display their name instead of content https://github.com/siyuan-note/siyuan/issues/8514
			block.Content = block.Name
		}

		if bs, ok := labelBlocks[label]; ok {
			bs = append(bs, block)
			labelBlocks[label] = bs
		} else {
			labelBlocks[label] = []*Block{block}
		}
	}

	for label, bs := range labelBlocks {
		for _, b := range bs {
			b.Depth = 1
		}
		*ret = append(*ret, &Bookmark{Name: label, Blocks: bs, Type: "bookmark", Count: len(bs)})
	}

	sort.Sort(ret)
	return
}
