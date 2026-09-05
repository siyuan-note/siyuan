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
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func EnabledUserSkills() []string {
	if Conf == nil || Conf.AI == nil || Conf.AI.Agent == nil || Conf.AI.Agent.Skills == nil {
		return nil
	}
	return append([]string(nil), Conf.AI.Agent.Skills.UserEnabled...)
}

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

	ret, retCtxMsgs, err := chatGPTComplete(msg, cachedContextMsg, cloud)
	if err != nil {
		return
	}
	cachedContextMsg = append(cachedContextMsg, retCtxMsgs...)
	return
}

func chatGPTWithAction(msg string, action string, cloud bool) (ret string) {
	msg = BuildAIEditorPrompt(msg, action)
	ret, _, err := chatGPTComplete(msg, nil, cloud)
	if err != nil {
		return
	}
	return
}

// BuildAIEditorPrompt 将编辑器输入填充到操作模板中。没有占位符时保持现有的操作前缀格式。
func BuildAIEditorPrompt(input, action string) string {
	action = strings.TrimSpace(action)
	if "" == action {
		return input
	}
	if strings.Contains(action, "{{input}}") {
		return strings.ReplaceAll(action, "{{input}}", input)
	}
	return action + ":\n\n" + input
}

const aiEditorSystemPrompt = `You are an inline editing engine, not a conversational assistant.
Complete the user's request directly and output only the final content to insert.
Never ask the user for clarification or additional information.
If the request is ambiguous or information is incomplete, choose a reasonable interpretation and produce the best possible result using only the supplied content.
Do not explain your process, mention missing context, add conversational preambles, or offer follow-up help.
Preserve the source language and Markdown structure unless the user requests otherwise.
Questions are allowed when they are part of the requested output; do not ask questions to clarify the task.`

type AIEditorMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

func buildAIEditorMessages(prompt string, history []AIEditorMessage, maxHistoryMessages int) []openai.ChatCompletionMessage {
	if maxHistoryMessages < len(history) {
		history = history[len(history)-maxHistoryMessages:]
	}
	messages := make([]openai.ChatCompletionMessage, 0, len(history)+2)
	messages = append(messages, openai.ChatCompletionMessage{Role: openai.ChatMessageRoleSystem, Content: aiEditorSystemPrompt})
	for _, item := range history {
		role := strings.TrimSpace(item.Role)
		content := strings.TrimSpace(item.Content)
		if "" == content || (openai.ChatMessageRoleUser != role && openai.ChatMessageRoleAssistant != role) {
			continue
		}
		messages = append(messages, openai.ChatCompletionMessage{Role: role, Content: content})
	}
	return append(messages, openai.ChatCompletionMessage{Role: openai.ChatMessageRoleUser, Content: prompt})
}

type AIEditorChatStream struct {
	stream      *util.OpenAICompletionStream
	cancel      context.CancelFunc
	idleTimeout time.Duration
}

func (stream *AIEditorChatStream) Recv() (response openai.ChatCompletionStreamResponse, err error) {
	timer, timerDone := startAIEditorCancelTimer(stream.idleTimeout, stream.cancel)
	response, err = stream.stream.Recv()
	if stopAIEditorCancelTimer(timer, timerDone) {
		err = errors.New("AI editor stream idle timeout")
	}
	return
}

func (stream *AIEditorChatStream) Close() {
	stream.cancel()
	stream.stream.Close()
}

// NewAIEditorChatStream 创建绑定到编辑器请求生命周期的模型流。
func NewAIEditorChatStream(ctx context.Context, ids []string, input, action string, history []AIEditorMessage) (*AIEditorChatStream, error) {
	if !Conf.AI.HasAnyProvider() {
		return nil, errors.New("no AI provider configured")
	}

	prov, m := Conf.AI.GetEditingModel()
	if nil == prov || nil == m {
		return nil, errors.New("no AI editing model configured")
	}
	editing := Conf.AI.Editing
	if nil == editing {
		return nil, errors.New("no AI editing config")
	}

	if "" == input && 0 < len(ids) {
		input = getBlocksContent(ids)
	}
	prompt := BuildAIEditorPrompt(input, action)
	if "" == strings.TrimSpace(prompt) {
		return nil, errors.New("AI editor input is empty")
	}

	messages := buildAIEditorMessages(prompt, history, editing.MaxHistoryMessages)

	req := openai.ChatCompletionRequest{
		Model:               m.Name,
		MaxCompletionTokens: editing.MaxCompletionTokens,
		Temperature:         float32(editing.Temperature),
		Messages:            messages,
		Stream:              true,
	}
	streamCtx, cancel := context.WithCancel(ctx)
	streamCtx = util.ContextWithOpenAIResponsesBaseURL(streamCtx, prov.BaseURL)
	requestTimeout := time.Duration(prov.RequestTimeout) * time.Second
	requestTimer, requestTimerDone := startAIEditorCancelTimer(requestTimeout, cancel)
	client := util.NewOpenAIClientWithModel(prov.APIKey, prov.BaseURL, m.Name)
	completionStream, err := util.CreateOpenAICompletionStream(streamCtx, client, prov.Protocol, req, nil)
	requestTimedOut := stopAIEditorCancelTimer(requestTimer, requestTimerDone)
	if requestTimedOut {
		err = errors.New("AI editor request timeout")
	}
	if nil != err {
		cancel()
		return nil, err
	}
	if nil == completionStream {
		cancel()
		return nil, errors.New("AI editor model returned nil stream")
	}
	return &AIEditorChatStream{
		stream:      completionStream,
		cancel:      cancel,
		idleTimeout: 120 * time.Second,
	}, nil
}

func startAIEditorCancelTimer(timeout time.Duration, cancel context.CancelFunc) (*time.Timer, <-chan struct{}) {
	if 0 >= timeout {
		return nil, nil
	}
	done := make(chan struct{})
	timer := time.AfterFunc(timeout, func() {
		cancel()
		close(done)
	})
	return timer, done
}

func stopAIEditorCancelTimer(timer *time.Timer, done <-chan struct{}) bool {
	if nil == timer {
		return false
	}
	if timer.Stop() {
		return false
	}
	<-done
	return true
}

func IsAIEditorStreamDone(err error) bool {
	return errors.Is(err, io.EOF)
}

func chatGPTComplete(msg string, contextMsgs []string, cloud bool) (ret string, retContextMsgs []string, err error) {
	util.PushEndlessProgress("Requesting...")
	defer util.ClearPushProgress(100)

	prov, m := Conf.AI.GetEditingModel()
	if nil == prov || nil == m {
		err = errors.New("no AI provider configured")
		return
	}

	editing := Conf.AI.Editing
	if nil == editing {
		err = errors.New("no AI editing config")
		return
	}

	if editing.MaxHistoryMessages < len(contextMsgs) {
		contextMsgs = contextMsgs[len(contextMsgs)-editing.MaxHistoryMessages:]
	}

	var gpt GPT
	if cloud {
		gpt = &CloudGPT{}
	} else {
		gpt = &OpenAIGPT{
			c:                   util.NewOpenAIClientWithModel(prov.APIKey, prov.BaseURL, m.Name),
			apiBaseURL:          prov.BaseURL,
			m:                   m,
			protocol:            prov.Protocol,
			timeout:             prov.RequestTimeout,
			maxCompletionTokens: editing.MaxCompletionTokens,
			temperature:         editing.Temperature,
		}
	}

	part, stop, chatErr := gpt.chat(msg, contextMsgs)
	if nil != chatErr {
		err = chatErr
		return
	}

	// stop==false means finish_reason=length: the output was truncated at
	// MaxCompletionTokens. Retrying the same prompt would almost certainly hit
	// the same limit again, so we return whatever was produced and notify the
	// user instead of silently looping. See https://github.com/siyuan-note/siyuan/issues/17797
	if !stop {
		util.PushMsg(Conf.Language(297), 5000)
	}

	ret = strings.TrimSpace(part)
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
	c                   *openai.Client
	apiBaseURL          string
	m                   *conf.Model
	protocol            string
	timeout             int
	maxCompletionTokens int
	temperature         float64
}

func (gpt *OpenAIGPT) chat(msg string, contextMsgs []string) (partRet string, stop bool, err error) {
	return util.ChatGPT(msg, contextMsgs, gpt.c, gpt.apiBaseURL, gpt.protocol, gpt.m.Name, gpt.maxCompletionTokens,
		gpt.temperature, gpt.timeout)
}

type CloudGPT struct {
}

func (gpt *CloudGPT) chat(msg string, contextMsgs []string) (partRet string, stop bool, err error) {
	return CloudChatGPT(msg, contextMsgs)
}
