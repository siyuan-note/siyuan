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

package tools

var QuestionTool = &Tool{
	Name:        "question",
	Description: "Ask the user questions to clarify needs/preferences (do NOT use for plain-text option lists). questions[]: each {header (short label), question, options[] {label, description}, multiple?, custom?}.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"questions": {
				Type: "array", Description: "Array of questions to ask the user",
				Items: &Property{
					Type: "object",
					Properties: map[string]Property{
						"header":   {Type: "string", Description: "Very short label (max 30 chars)"},
						"question": {Type: "string", Description: "Complete question text"},
						"options": {
							Type: "array", Description: "Available choices for this question",
							Items: &Property{
								Type: "object",
								Properties: map[string]Property{
									"label":       {Type: "string", Description: "Display text (1-5 words, concise)"},
									"description": {Type: "string", Description: "Explanation of this choice"},
								},
								Required: []string{"label", "description"},
							},
						},
						"multiple": {Type: "boolean", Description: "Allow selecting multiple choices (default false)"},
						"custom":   {Type: "boolean", Description: "Allow typing custom answer (default true)"},
					},
					Required: []string{"header", "question", "options"},
				},
			},
		},
		Required: []string{"questions"},
	},
	Handler: questionHandler,
}

func init() {
	register(QuestionTool)
}

// questionHandler is intercepted by agent.go; this is a fallback.
func questionHandler(args map[string]any) (CallToolResult, error) {
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "question tool: should be intercepted by agent loop"}},
	}, nil
}
