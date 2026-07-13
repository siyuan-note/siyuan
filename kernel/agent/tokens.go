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

package agent

import (
	"encoding/json"
	"sync"

	"github.com/pkoukk/tiktoken-go"
	loader "github.com/pkoukk/tiktoken-go-loader"
	"github.com/sashabaranov/go-openai"
	tools "github.com/siyuan-note/siyuan/kernel/mcp/tools"
)

// tokenCounter 用 tiktoken 对文本进行 BPE 分词计数。encoder 单例化避免重复加载编码表。
type tokenCounter struct {
	enc *tiktoken.Tiktoken
}

var (
	tokenCounterOnce sync.Once
	globalCounter    *tokenCounter
	tokenCounterErr  error
)

// getTokenCounter 懒初始化全局单例 counter。modelName 用于选编码（GPT-4o→o200k_base，
// 其他→cl100k_base），失败回退 cl100k_base。首次调用注册离线 BPE loader（embed 编码表），
// 避免 SiYuan 桌面端在离线/内网环境联网下载编码表失败。
func getTokenCounter(modelName string) (*tokenCounter, error) {
	tokenCounterOnce.Do(func() {
		tiktoken.SetBpeLoader(loader.NewOfflineLoader())
		enc, err := tiktoken.EncodingForModel(modelName)
		if err != nil {
			// 模型名未识别，回退到 cl100k_base（覆盖 GPT-3.5/4 系，最通用的编码）。
			enc, err = tiktoken.GetEncoding("cl100k_base")
			if err != nil {
				tokenCounterErr = err
				return
			}
		}
		globalCounter = &tokenCounter{enc: enc}
	})
	return globalCounter, tokenCounterErr
}

// count 返回 text 的 token 数。counter 为 nil 时回退到字符近似估算。
func (c *tokenCounter) count(text string) int {
	if c == nil || c.enc == nil {
		return estimateTokensByChars(text)
	}
	return len(c.enc.Encode(text, nil, nil))
}

// estimateTokensByChars 字符近似估算：中文按 ~1.5 字符/token，其他按 ~4 字符/token。
// 仅在 tiktoken 不可用时降级使用。
func estimateTokensByChars(text string) int {
	if text == "" {
		return 0
	}
	cjk := 0
	other := 0
	for _, r := range text {
		if r >= 0x4E00 && r <= 0x9FFF || r >= 0x3040 && r <= 0x30FF || r >= 0xAC00 && r <= 0xD7AF {
			cjk++
		} else {
			other++
		}
	}
	return cjk*2/3 + other/4
}

// toolSource 按工具注册时标记的 Source 字段判断来源（native/plugin/mcp）。
// 工具名无前缀区分（原生工具名是 block/document 等普通字符串），必须查 Tool.Source。
// 兼容兜底：plugin__ 前缀的旧工具名也识别为 plugin；查不到工具的按 mcp 处理。
func toolSource(name string) string {
	if t := tools.GetTool(name); t != nil {
		if t.Source != "" {
			return t.Source
		}
	}
	// 兜底：plugin__ 前缀（历史兼容，理论上 plugin 工具已标记 Source）。
	if len(name) > 8 && name[:8] == "plugin__" {
		return "plugin"
	}
	// 查不到工具（可能是已卸载的工具），按 mcp 归类（最少见的情况）。
	return "mcp"
}

// computeTokenBreakdown 按 10 个分类估算上下文 token 用量。
// messages：发给 LLM 的完整消息列表；tools：函数定义列表；skillsTokens：system prompt 中
// <available_skills> 段单独的 token 数；realPromptTokens：OpenAI 返回的真实 prompt tokens。
// 返回的 map 包含 system/skills/messages/nativeToolsDef/pluginToolsDef/mcpToolsDef/
// nativeTool/pluginTool/mcpTool/other 共 10 个 key，other = realPromptTokens - 前 9 类之和。
func computeTokenBreakdown(counter *tokenCounter, messages []openai.ChatCompletionMessage, tools []openai.Tool, skillsTokens, realPromptTokens int) map[string]int {
	breakdown := map[string]int{
		"system":         0,
		"skills":         skillsTokens,
		"messages":       0,
		"nativeToolsDef": 0,
		"pluginToolsDef": 0,
		"mcpToolsDef":    0,
		"nativeTool":     0,
		"pluginTool":     0,
		"mcpTool":        0,
		"other":          0,
	}

	// 统计 messages：按 role 分类。system 类累加所有 system 消息（含 doom-loop 警告等运行时追加），
	// 最后减去 skillsTokens（skills 段单独成类）。
	// 按 OpenAI cookbook 公式补算 chat 格式的结构开销：每条消息 +4 token（role 标记 + 边界），
	// 整个对话 +3 token（priming）。这些结构开销计入对应类别的 token 数，减少 "其他" 残差。
	systemTotal := 0
	// tool 消息需通过 ToolCallID 关联回前一条 assistant 的 tool_call 拿工具名。
	// 维护 idToToolName 映射（assistant 带 tool_calls 时填充）。
	idToToolName := map[string]string{}
	const perMessageOverhead = 4 // 每条消息的结构 overhead（OpenAI chat 格式固定开销）
	for _, msg := range messages {
		switch msg.Role {
		case openai.ChatMessageRoleSystem:
			systemTotal += counter.count(msg.Content) + perMessageOverhead
		case openai.ChatMessageRoleUser:
			breakdown["messages"] += counter.count(msg.Content) + perMessageOverhead
		case openai.ChatMessageRoleAssistant:
			breakdown["messages"] += counter.count(msg.Content) + perMessageOverhead
			// 助手消息的推理内容（deepseek-reasoner 等）也计入对话消息。
			if msg.ReasoningContent != "" {
				breakdown["messages"] += counter.count(msg.ReasoningContent)
			}
			for _, tc := range msg.ToolCalls {
				name := tc.Function.Name
				idToToolName[tc.ID] = name
				// tool_call 的函数名 + 参数计入对应工具调用类。
				// 每个 tool_call 结构额外有 id/type/function 的 JSON 结构开销（约 7 token）。
				callTokens := counter.count(name) + counter.count(tc.Function.Arguments) + 7
				switch toolSource(name) {
				case "native":
					breakdown["nativeTool"] += callTokens
				case "plugin":
					breakdown["pluginTool"] += callTokens
				default:
					breakdown["mcpTool"] += callTokens
				}
			}
		case openai.ChatMessageRoleTool:
			// tool 结果按关联的工具名归类。
			name := idToToolName[msg.ToolCallID]
			resultTokens := counter.count(msg.Content) + perMessageOverhead
			switch toolSource(name) {
			case "native":
				breakdown["nativeTool"] += resultTokens
			case "plugin":
				breakdown["pluginTool"] += resultTokens
			default:
				breakdown["mcpTool"] += resultTokens
			}
		}
	}
	breakdown["system"] = max(systemTotal-skillsTokens, 0)

	// 统计 tools 定义（函数签名）：序列化每个 Function 的 Name+Description+Parameters JSON 计数。
	// OpenAI 对每个 function 定义有固定结构开销（约 10 token：type/function 包装 + 字段名），
	// 予以补算以减少与真实计费的偏差。
	const perToolDefOverhead = 10
	for _, t := range tools {
		if t.Function == nil {
			continue
		}
		defText := t.Function.Name + " " + t.Function.Description
		if paramsJSON, err := json.Marshal(t.Function.Parameters); err == nil {
			defText += " " + string(paramsJSON)
		}
		defTokens := counter.count(defText) + perToolDefOverhead
		switch toolSource(t.Function.Name) {
		case "native":
			breakdown["nativeToolsDef"] += defTokens
		case "plugin":
			breakdown["pluginToolsDef"] += defTokens
		default:
			breakdown["mcpToolsDef"] += defTokens
		}
	}

	// OpenAI 对整个对话有固定 priming overhead（约 3 token），计入 messages 类。
	if len(messages) > 0 {
		breakdown["messages"] += 3
	}

	// 估算之和与真实 prompt tokens 对齐，保证各类百分比相加 = 100%。
	// 估算 < 真实：差额计入 other（吸收低估残差）。
	// 估算 > 真实：按比例等比压缩前 9 类（吸收高估残差），整数舍入残差计入 other（不污染本应为 0 的类）。
	// 不归一化会导致前端各类百分比之和 > 100%（tiktoken 估算/overhead 补偿可能高估）。
	estimated := 0
	for k, v := range breakdown {
		if k == "other" {
			continue
		}
		estimated += v
	}
	if realPromptTokens > estimated {
		breakdown["other"] = realPromptTokens - estimated
	} else if estimated > realPromptTokens && realPromptTokens > 0 {
		scale := float64(realPromptTokens) / float64(estimated)
		allocated := 0
		// 等比缩放前 9 类，原值为 0 的类保持 0（不因残差变成假正值）。
		keys := []string{"system", "skills", "messages",
			"nativeToolsDef", "pluginToolsDef", "mcpToolsDef",
			"nativeTool", "pluginTool", "mcpTool"}
		for _, k := range keys {
			scaled := int(float64(breakdown[k]) * scale)
			breakdown[k] = scaled
			allocated += scaled
		}
		// 整数舍入残差计入 other（可能为正或负，clamp≥0）。
		breakdown["other"] = max(realPromptTokens-allocated, 0)
	}
	return breakdown
}
