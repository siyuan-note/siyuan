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
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/lex"
	"github.com/88250/lute/parse"
	"github.com/araddon/dateparse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func SetBlockReminder(id string, timed string) (err error) {
	if !IsSubscriber() {
		if "ios" == util.Container {
			return errors.New(Conf.Language(122))
		}
		return errors.New(Conf.Language(29))
	}

	var timedMills int64
	if "0" != timed {
		t, e := dateparse.ParseIn(timed, time.Now().Location())
		if nil != e {
			return e
		}
		timedMills = t.UnixMilli()
	}

	attrs := GetBlockAttrs(id) // 获取属性是会等待树写入
	tree, err := loadTreeByBlockID(id)
	if nil != err {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return errors.New(fmt.Sprintf(Conf.Language(15), id))
	}

	if ast.NodeDocument != node.Type && node.IsContainerBlock() {
		node = treenode.FirstLeafBlock(node)
	}
	content := treenode.NodeStaticContent(node)
	content = gulu.Str.SubStr(content, 128)
	err = SetCloudBlockReminder(id, content, timedMills)
	if nil != err {
		return
	}

	attrName := "custom-reminder-wechat"
	if "0" == timed {
		delete(attrs, attrName)
		old := node.IALAttr(attrName)
		oldTimedMills, e := dateparse.ParseIn(old, time.Now().Location())
		if nil == e {
			util.PushMsg(fmt.Sprintf(Conf.Language(109), oldTimedMills.Format("2006-01-02 15:04")), 3000)
		}
		node.RemoveIALAttr(attrName)
	} else {
		attrs[attrName] = timed
		node.SetIALAttr(attrName, timed)
		util.PushMsg(fmt.Sprintf(Conf.Language(101), time.UnixMilli(timedMills).Format("2006-01-02 15:04")), 5000)
	}
	if err = indexWriteJSONQueue(tree); nil != err {
		return
	}
	IncSync()
	cache.PutBlockIAL(id, attrs)
	return
}

func SetBlockAttrs(id string, nameValues map[string]string) (err error) {
	WaitForWritingFiles()

	tree, err := loadTreeByBlockID(id)
	if nil != err {
		return err
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return errors.New(fmt.Sprintf(Conf.Language(15), id))
	}

	for name, _ := range nameValues {
		for i := 0; i < len(name); i++ {
			if !lex.IsASCIILetterNumHyphen(name[i]) {
				return errors.New(fmt.Sprintf(Conf.Language(25), id))
			}
		}
	}

	for name, value := range nameValues {
		if "" == value {
			node.RemoveIALAttr(name)
		} else {
			node.SetIALAttr(name, html.EscapeAttrVal(value))
		}
	}

	if err = indexWriteJSONQueue(tree); nil != err {
		return
	}
	IncSync()
	cache.PutBlockIAL(id, parse.IAL2Map(node.KramdownIAL))
	return
}

func ResetBlockAttrs(id string, nameValues map[string]string) (err error) {
	tree, err := loadTreeByBlockID(id)
	if nil != err {
		return err
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return errors.New(fmt.Sprintf(Conf.Language(15), id))
	}

	for name, _ := range nameValues {
		for i := 0; i < len(name); i++ {
			if !lex.IsASCIILetterNumHyphen(name[i]) {
				return errors.New(fmt.Sprintf(Conf.Language(25), id))
			}
		}
	}

	node.ClearIALAttrs()
	for name, value := range nameValues {
		if "" != value {
			node.SetIALAttr(name, value)
		}
	}

	if err = indexWriteJSONQueue(tree); nil != err {
		return
	}
	IncSync()
	cache.RemoveBlockIAL(id)
	return
}

func GetBlockAttrs(id string) (ret map[string]string) {
	ret = map[string]string{}
	if cached := cache.GetBlockIAL(id); nil != cached {
		ret = cached
		return
	}

	WaitForWritingFiles()

	tree, err := loadTreeByBlockID(id)
	if nil != err {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	for _, kv := range node.KramdownIAL {
		ret[kv[0]] = html.UnescapeAttrVal(kv[1])
	}
	cache.PutBlockIAL(id, ret)
	return
}
