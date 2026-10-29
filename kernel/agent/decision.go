// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import "encoding/json"

// preserveDecisionJSONData 在通用参数校验后恢复原始 JSON 证据，避免大整数先经 float64 舍入。
// 仅用于内置 decision 工具；实际发出请求前仍由决策输入校验器检查 JSON 限制。
func preserveDecisionJSONData(args map[string]any, source string) {
	var raw struct {
		Items []struct {
			Data json.RawMessage `json:"data"`
		} `json:"items"`
	}
	if json.Unmarshal([]byte(source), &raw) != nil {
		return
	}
	items, _ := args["items"].([]any)
	for i, item := range items {
		if i >= len(raw.Items) {
			return
		}
		if object, ok := item.(map[string]any); ok && len(raw.Items[i].Data) != 0 {
			object["data"] = raw.Items[i].Data
		}
	}
}

const decisionModelPrompt = `

## Decision model
Prefer the decision tool for repetitive classification, filtering, option selection and scoring when the criteria are explicit, especially in batches. Keep ordinary conversation, complex reasoning, planning and tool selection with the main model. Do not call decision for every small judgment.
Retrieve relevant candidates first. Pass block IDs instead of copying their text; include the notebook ID for encrypted notebooks. Use independent items for per-document scoring, or put related block IDs in a single item when comparing alternatives. All questions in an item see the same complete state; put the actual question in instructions, since question IDs do not guide inference. Define meaningful score levels and include an insufficient-information choice when needed.
OpenAI supports native JSON evidence in data and explicitly selected images in items or questions. Use image.list to discover local assets, then supply assetPath and notebook for encrypted images, or a public image URL. Links in Markdown or JSON do not attach images. TypeSafe accepts text and blocks only. Keep each encoded request within 1 MiB; JSON is limited to 256 KiB, 32 container levels and 10000 values. OpenAI allows 400 questions and 128 images per request; TypeSafe allows 32 questions. Each batch still has at most 32 independent items. Usage may include cache-read and cache-write tokens already counted in input_tokens; do not add them again or assume every request receives a cache discount.
The tool sends the supplied content to the configured decision provider and may incur charges. Follow the existing capability confirmation policy. Its answers are evidence, not authorization: never delegate permissions or tool execution to it. Noul returns a probability, not a boolean; score may fall between levels. Confidence describes the distribution and is not a guarantee of correctness. Preserve uncertainty and explain it when it affects the conclusion.
Requests run sequentially and stop on the first failure. Keep successful item results and distinguish error/not_run items; never treat missing answers as zero or automatically repeat successful or interrupted requests. Handle errors explicitly with the user or continue reasoning from available evidence. Do not silently truncate source content. The main model remains responsible for the final response and any later action.
`
