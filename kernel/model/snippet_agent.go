package model

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// SnippetRevision 覆盖完整片段，确认期间的内容和开关变化都使修改失效。
func SnippetRevision(snippet *conf.Snippet) string {
	data, _ := json.Marshal(snippet)
	return fmt.Sprintf("%x", sha256.Sum256(data))
}

// AgentSnippetEdit 用字段是否出现区分保留原值和写入空内容。
type AgentSnippetEdit struct {
	Type    string  `json:"type"`
	Name    *string `json:"name"`
	Content *string `json:"content"`
	OldText *string `json:"oldText"`
	NewText *string `json:"newText"`
}

// MutateAgentSnippet 与已有全量保存共用锁，在校验版本后只修改指定片段，保留其他片段及顺序。
// 新片段默认禁用且不在发布服务中加载，更新不隐式改变类型或执行范围。
func MutateAgentSnippet(action, id, revision string, value *AgentSnippetEdit) (*conf.Snippet, error) {
	if util.ReadOnly || Conf == nil || Conf.ReadOnly {
		return nil, fmt.Errorf("snippet changes are unavailable in read-only mode")
	}
	snippetsLock.Lock()
	defer snippetsLock.Unlock()
	snippets, err := loadSnippets()
	if err != nil {
		return nil, err
	}
	index := -1
	seen := map[string]bool{}
	for i, snippet := range snippets {
		if snippet == nil || seen[snippet.ID] {
			return nil, fmt.Errorf("invalid snippet configuration; original data preserved")
		}
		seen[snippet.ID] = true
		if snippet.ID == id {
			index = i
		}
	}
	var result *conf.Snippet
	if action == "create" {
		if value == nil || value.Name == nil || value.Content == nil || (value.Type != "css" && value.Type != "js") {
			return nil, fmt.Errorf("type, name and content are required")
		}
		result = &conf.Snippet{ID: ast.NewNodeID(), Type: value.Type, Name: *value.Name, Content: *value.Content, DisabledInPublish: true}
	} else {
		if index < 0 {
			return nil, fmt.Errorf("snippet not found; list snippets again")
		}
		if revision == "" || SnippetRevision(snippets[index]) != revision {
			return nil, fmt.Errorf("snippet changed; read it again before requesting confirmation")
		}
		copy := *snippets[index]
		result = &copy
		switch action {
		case "update":
			if value == nil || (value.Name == nil && value.Content == nil) {
				return nil, fmt.Errorf("name or content is required")
			}
			if value.Name != nil {
				result.Name = *value.Name
			}
			if value.Content != nil {
				result.Content = *value.Content
			}
		case "replace":
			if value == nil || value.OldText == nil || value.NewText == nil || *value.OldText == "" ||
				len(*value.OldText) > 65536 || len(*value.NewText) > 65536 {
				return nil, fmt.Errorf("oldText must be nonempty; newText is required; each must be at most 65536 bytes")
			}
			start := strings.Index(result.Content, *value.OldText)
			if start < 0 || strings.Contains(result.Content[start+1:], *value.OldText) {
				return nil, fmt.Errorf("oldText must match exactly once; no changes made")
			}
			result.Content = result.Content[:start] + *value.NewText + result.Content[start+len(*value.OldText):]
		case "enable":
			result.Enabled = true
		case "disable":
			result.Enabled = false
		case "remove":
		default:
			return nil, fmt.Errorf("unknown snippet operation")
		}
	}
	contentChanged := action == "create" || index >= 0 && result.Content != snippets[index].Content
	nameChanged := action == "create" || index >= 0 && result.Name != snippets[index].Name
	if nameChanged && (strings.TrimSpace(result.Name) == "" || len(result.Name) > 256) {
		return nil, fmt.Errorf("name must contain 1-256 bytes")
	}
	if contentChanged && action != "replace" && len(result.Content) > 65536 {
		return nil, fmt.Errorf("replacement content must not exceed 65536 bytes; use replace for a local edit")
	}
	if contentChanged || action == "enable" {
		if result.Type != "css" && result.Type != "js" {
			return nil, fmt.Errorf("unsupported snippet type")
		}
		content := strings.ToLower(result.Content)
		if result.Type == "css" && (strings.Contains(content, "</style") || strings.Contains(content, "<script")) {
			return nil, fmt.Errorf("invalid css snippet content")
		}
	}
	switch action {
	case "create":
		snippets = append(snippets, result)
	case "remove":
		snippets = append(snippets[:index], snippets[index+1:]...)
	default:
		snippets[index] = result
	}
	if err = writeSnippetsConf(snippets); err != nil {
		return nil, err
	}
	IncSyncIfNeeded(filepath.Join(util.SnippetsPath, "conf.json"))
	return result, nil
}
