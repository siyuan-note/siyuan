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

package filesys

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/lute"
	"github.com/88250/lute/parse"
	"github.com/88250/protyle"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func LoadTree(boxID, p string, luteEngine *lute.Lute) (ret *parse.Tree, err error) {
	filePath := filepath.Join(util.DataDir, boxID, p)
	data, err := filelock.LockFileRead(filePath)
	if nil != err {
		return
	}
	ret = parseJSON2Tree(boxID, p, data, luteEngine)
	if nil == ret {
		ret = recoverParseJSON2Tree(boxID, p, filePath, luteEngine)
		if nil == ret {
			return nil, errors.New("parse tree failed")
		}
	}
	ret.Path = p
	ret.Root.Path = p

	parts := strings.Split(p, "/")
	parts = parts[1 : len(parts)-1] // 去掉开头的斜杆和结尾的自己
	if 1 > len(parts) {
		ret.HPath = "/" + ret.Root.IALAttr("title")
		ret.Hash = treenode.NodeHash(ret.Root, ret, luteEngine)
		return
	}

	// 构造 HPath
	hPathBuilder := bytes.Buffer{}
	hPathBuilder.WriteString("/")
	for i, _ := range parts {
		var parentPath string
		if 0 < i {
			parentPath = strings.Join(parts[:i+1], "/")
		} else {
			parentPath = parts[0]
		}
		parentPath += ".sy"
		parentPath = filepath.Join(util.DataDir, boxID, parentPath)
		parentData, readErr := filelock.LockFileRead(parentPath)
		if nil != readErr {
			util.LogWarnf("read tree data [%s] failed: %s", parentPath, readErr)
			hPathBuilder.WriteString("Untitled/")
			continue
		}
		parentTree, parseErr := protyle.ParseJSONWithoutFix(luteEngine, parentData)
		if nil != parseErr {
			util.LogWarnf("parse tree [%s] failed: %s", parentPath, parseErr)
			hPathBuilder.WriteString("Untitled/")
			continue
		}
		hPathBuilder.WriteString(parentTree.Root.IALAttr("title"))
		hPathBuilder.WriteString("/")
	}
	hPathBuilder.WriteString(ret.Root.IALAttr("title"))
	ret.HPath = hPathBuilder.String()
	ret.Hash = treenode.NodeHash(ret.Root, ret, luteEngine)
	return
}

func WriteTree(tree *parse.Tree) (err error) {
	luteEngine := util.NewLute() // 不关注用户的自定义解析渲染选项

	if nil == tree.Root.FirstChild {
		newP := protyle.NewParagraph()
		tree.Root.AppendChild(newP)
		tree.Root.SetIALAttr("updated", util.TimeFromID(newP.ID))
	}

	renderer := protyle.NewJSONRenderer(tree, luteEngine.RenderOptions)
	output := renderer.Render()

	// .sy 文档数据使用格式化好的 JSON 而非单行 JSON
	buf := bytes.Buffer{}
	buf.Grow(4096)
	if err = json.Indent(&buf, output, "", "\t"); nil != err {
		return
	}
	output = buf.Bytes()

	filePath := filepath.Join(util.DataDir, tree.Box, tree.Path)
	if err = os.MkdirAll(filepath.Dir(filePath), 0755); nil != err {
		return
	}
	if err = filelock.LockFileWrite(filePath, output); nil != err {
		msg := fmt.Sprintf("write data [%s] failed: %s", filePath, err)
		util.LogErrorf(msg)
		return errors.New(msg)
	}

	docIAL := parse.IAL2MapUnEsc(tree.Root.KramdownIAL)
	cache.PutDocIAL(tree.Path, docIAL)
	return
}

func recoverParseJSON2Tree(boxID, p, filePath string, luteEngine *lute.Lute) (ret *parse.Tree) {
	// 尝试从临时文件恢复
	tmp := util.LatestTmpFile(filePath)
	if "" == tmp {
		util.LogWarnf("recover tree [%s] not found tmp", filePath)
		return
	}

	stat, err := os.Stat(filePath)
	if nil != err {
		util.LogErrorf("stat tmp [%s] failed: %s", tmp, err)
		return
	}

	if stat.ModTime().Before(time.Now().Add(-time.Hour * 24)) {
		util.LogWarnf("tmp [%s] is too old, remove it", tmp)
		os.RemoveAll(tmp)
		return
	}

	data, err := filelock.NoLockFileRead(tmp)
	if nil != err {
		util.LogErrorf("recover tree read from tmp [%s] failed: %s", tmp, err)
		return
	}
	if err = filelock.NoLockFileWrite(filePath, data); nil != err {
		util.LogErrorf("recover tree write [%s] from tmp [%s] failed: %s", filePath, tmp, err)
		return
	}

	ret = parseJSON2Tree(boxID, p, data, luteEngine)
	if nil == ret {
		util.LogErrorf("recover tree from tmp [%s] parse failed, remove it", tmp)
		os.RemoveAll(tmp)
		return
	}
	util.LogInfof("recovered tree [%s] from [%s]", filePath, tmp)
	os.RemoveAll(tmp)
	return
}

func parseJSON2Tree(boxID, p string, jsonData []byte, luteEngine *lute.Lute) (ret *parse.Tree) {
	var err error
	var needFix bool
	ret, needFix, err = protyle.ParseJSON(luteEngine, jsonData)
	if nil != err {
		util.LogErrorf("parse json [%s] to tree failed: %s", boxID+p, err)
		return
	}

	ret.Box = boxID
	ret.Path = p
	if needFix {
		renderer := protyle.NewJSONRenderer(ret, luteEngine.RenderOptions)
		output := renderer.Render()

		buf := bytes.Buffer{}
		buf.Grow(4096)
		if err = json.Indent(&buf, output, "", "\t"); nil != err {
			return
		}
		output = buf.Bytes()

		filePath := filepath.Join(util.DataDir, ret.Box, ret.Path)
		if err = os.MkdirAll(filepath.Dir(filePath), 0755); nil != err {
			return
		}
		if err = filelock.LockFileWrite(filePath, output); nil != err {
			msg := fmt.Sprintf("write data [%s] failed: %s", filePath, err)
			util.LogErrorf(msg)
		}
	}
	return
}
