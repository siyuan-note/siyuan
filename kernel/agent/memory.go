package agent

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/util"
	"io"
	"os"

	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// 注册仅供内核读取的已提交用户来源，避免 model 反向依赖 agent。
func init() { kernelModel.AIMemoryConversationReader = readMemoryConversation }
func readMemoryConversation(ctx context.Context, sessionID, entryID string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if !isValidSessionID(sessionID) || entryID == "" {
		return "", errors.New("invalid conversation identity")
	}
	lock := sessionLock(sessionID)
	lock.Lock()
	defer lock.Unlock()
	root, err := os.OpenRoot(util.DataDir)
	if err != nil {
		return "", err
	}
	for _, part := range []string{"storage", "ai", "agent", "sessions", sessionID} {
		info, statErr := root.Lstat(part)
		if statErr != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			root.Close()
			return "", errors.New("conversation source path is unavailable")
		}
		next, openErr := root.OpenRoot(part)
		root.Close()
		if openErr != nil {
			return "", openErr
		}
		root = next
	}
	defer root.Close()
	info, err := root.Lstat("session.json")
	if err != nil || !info.Mode().IsRegular() || info.Size() > 2*1024*1024 {
		return "", errors.New("conversation source is unavailable or exceeds budget")
	}
	file, err := root.Open("session.json")
	if err != nil {
		return "", err
	}
	defer file.Close()
	encoded, err := io.ReadAll(io.LimitReader(file, 2*1024*1024+1))
	if err != nil || len(encoded) > 2*1024*1024 {
		return "", errors.New("conversation source exceeds budget")
	}
	var checkpoint agentCheckpoint
	if err = json.Unmarshal(encoded, &checkpoint); err != nil {
		return "", err
	}
	if checkpoint.LastCommittedTurnID == "" {
		return "", errors.New("conversation has no committed turn")
	}
	for _, entry := range checkpoint.Entries {
		if entry.ID != entryID {
			continue
		}
		if entry.Type != "user" || entry.Content == "" {
			return "", errors.New("memory source must be a user utterance")
		}
		if entry.EditorContext != nil && kernelModel.IsEncryptedBox(entry.EditorContext.NotebookID) {
			return "", errors.New("encrypted conversation context is excluded")
		}
		if entry.EditorContext != nil {
			ids := append([]string{}, entry.EditorContext.SelectedBlockIDs...)
			ids = append(ids, entry.EditorContext.ActiveDocID, entry.EditorContext.FocusedBlockID)
			for _, id := range ids {
				if id == "" {
					continue
				}
				bt := treenode.GetBlockTree(id)
				if bt == nil || kernelModel.IsEncryptedBox(bt.BoxID) {
					return "", errors.New("restricted editor context is excluded")
				}
			}
		}
		for _, ref := range entry.References {
			bt := treenode.GetBlockTree(ref.ID)
			if bt == nil || kernelModel.IsEncryptedBox(bt.BoxID) {
				return "", errors.New("restricted conversation reference is excluded")
			}
		}
		evidence, err := json.Marshal(struct {
			SessionID string `json:"sessionID"`
			EntryID   string `json:"entryID"`
			Role      string `json:"role"`
			Content   string `json:"content"`
			Timestamp int64  `json:"timestamp"`
		}{sessionID, entryID, "user", entry.Content, entry.Timestamp})
		return string(evidence), err
	}
	return "", errors.New("conversation source was removed")
}

// 派生记忆只加在请求副本，绝不进入 checkpoint、变量解析或用户来源。
func withAIMemoryMessages(messages []openai.ChatCompletionMessage, content string) []openai.ChatCompletionMessage {
	if content == "" {
		return messages
	}
	result := append([]openai.ChatCompletionMessage{}, messages...)
	return append(result, openai.ChatCompletionMessage{Role: openai.ChatMessageRoleUser, Content: content})
}
func withAIMemoryResponseInput(input []any, content string) []any {
	if content == "" {
		return input
	}
	result := append([]any{}, input...)
	return append(result, util.ChatMessagesToOpenAIResponseInput([]openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: content}})...)
}

// 记忆是可选背景；不能挤占当前任务或绕过压缩后的请求预算。
func fitAIMemoryContext(model string, messages []openai.ChatCompletionMessage, tools []openai.Tool, content string, contextLimit, maxCompletionTokens int) string {
	if content == "" || contextLimit <= 0 {
		return content
	}
	budget := contextInputBudget(contextLimit, maxCompletionTokens)
	if budget > 0 && estimateChatRequestTokens(model, withAIMemoryMessages(messages, content), tools) <= budget {
		return content
	}
	omitted := "<untrusted_memory>Memory was not loaded because the request has insufficient context budget; do not infer that no relevant memory exists.</untrusted_memory>"
	if budget > 0 && estimateChatRequestTokens(model, withAIMemoryMessages(messages, omitted), tools) <= budget {
		return omitted
	}
	return ""
}
