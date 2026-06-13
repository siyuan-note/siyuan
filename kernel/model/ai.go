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
	"bytes"
	"errors"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func ChatGPT(msg string) (ret string) {
	if !isOpenAIAPIEnabled() {
		return
	}

	return chatGPT(msg, false)
}

func ChatGPTWithAction(ids []string, action string) (ret string) {
	if !isOpenAIAPIEnabled() {
		return
	}

	if "Clear context" == action {
		// AI clear context action https://github.com/siyuan-note/siyuan/issues/10255
		cachedContextMsg = nil
		return
	}

	msg := getBlocksContent(ids)
	ret = chatGPTWithAction(msg, action, false)
	return
}

var cachedContextMsg []string

func chatGPT(msg string, cloud bool) (ret string) {
	if "Clear context" == msg {
		// AI clear context action https://github.com/siyuan-note/siyuan/issues/10255
		cachedContextMsg = nil
		return
	}

	ret, retCtxMsgs, err := chatGPTContinueWrite(msg, cachedContextMsg, cloud)
	if err != nil {
		return
	}
	cachedContextMsg = append(cachedContextMsg, retCtxMsgs...)
	return
}

func chatGPTWithAction(msg string, action string, cloud bool) (ret string) {
	action = strings.TrimSpace(action)
	if "" != action {
		msg = action + ":\n\n" + msg
	}
	ret, _, err := chatGPTContinueWrite(msg, nil, cloud)
	if err != nil {
		return
	}
	return
}

func chatGPTContinueWrite(msg string, contextMsgs []string, cloud bool) (ret string, retContextMsgs []string, err error) {
	util.PushEndlessProgress("Requesting...")
	defer util.ClearPushProgress(100)

	prov, m := Conf.AI.GetModel("")
	if nil == prov || nil == m {
		err = errors.New("no AI provider configured")
		return
	}

	if m.MaxContexts < len(contextMsgs) {
		contextMsgs = contextMsgs[len(contextMsgs)-m.MaxContexts:]
	}

	var gpt GPT
	if cloud {
		gpt = &CloudGPT{}
	} else {
		gpt = &OpenAIGPT{
			c:       util.NewOpenAIClient(string(prov.APIKey), prov.BaseURL),
			m:       m,
			timeout: prov.RequestTimeout,
		}
	}

	buf := &bytes.Buffer{}
	for i := 0; i < m.MaxContexts; i++ {
		part, stop, chatErr := gpt.chat(msg, contextMsgs)
		buf.WriteString(part)

		if stop || nil != chatErr {
			break
		}

		util.PushEndlessProgress("Continue requesting...")
	}

	ret = buf.String()
	ret = strings.TrimSpace(ret)
	if "" != ret {
		retContextMsgs = append(retContextMsgs, msg, ret)
	}
	return
}

func isOpenAIAPIEnabled() bool {
	if !Conf.AI.HasAnyProvider() {
		util.PushMsg(Conf.Language(193), 5000)
		return false
	}
	return true
}

func getBlocksContent(ids []string) string {
	var nodes []*ast.Node
	trees := map[string]*parse.Tree{}
	for _, id := range ids {
		bt := treenode.GetBlockTree(id)
		if nil == bt {
			continue
		}

		var tree *parse.Tree
		if tree = trees[bt.RootID]; nil == tree {
			tree, _ = LoadTreeByBlockID(bt.RootID)
			if nil == tree {
				continue
			}

			trees[bt.RootID] = tree
		}

		if node := treenode.GetNodeInTree(tree, id); nil != node {
			if ast.NodeDocument == node.Type {
				for child := node.FirstChild; nil != child; child = child.Next {
					nodes = append(nodes, child)
				}
			} else {
				nodes = append(nodes, node)
			}
		}
	}

	luteEngine := util.NewLute()
	buf := bytes.Buffer{}
	for _, node := range nodes {
		md := treenode.ExportNodeStdMd(node, luteEngine)
		buf.WriteString(md)
		buf.WriteString("\n\n")
	}
	return buf.String()
}

type GPT interface {
	chat(msg string, contextMsgs []string) (partRet string, stop bool, err error)
}

type OpenAIGPT struct {
	c       *openai.Client
	m       *conf.Model
	timeout int
}

func (gpt *OpenAIGPT) chat(msg string, contextMsgs []string) (partRet string, stop bool, err error) {
	return util.ChatGPT(msg, contextMsgs, gpt.c, gpt.m.Name, gpt.m.MaxTokens, gpt.m.Temperature, gpt.timeout)
}

type CloudGPT struct {
}

func (gpt *CloudGPT) chat(msg string, contextMsgs []string) (partRet string, stop bool, err error) {
	return CloudChatGPT(msg, contextMsgs)
}
