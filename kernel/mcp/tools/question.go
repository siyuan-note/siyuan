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

package tools

var QuestionTool = &Tool{
	Name:        "question",
	Description: "Ask the user questions to clarify needs/preferences (do NOT use for plain-text option lists). questions[]: each {header, question, options[] {label, description}, multiple?, custom?}. For official plugin development use workflow.action=choose with questions=[]; the server supplies the exact Yes/No question. After successful official skill load, workflow.action=plan freezes and displays the proposed scope for confirmation. Workflow answers never authorize installation or enabling.",
	AgentOnly:   true,
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"workflow": {Type: "object", Description: "Reserved official plugin workflow; actual consent is recorded only from the user's answer", Properties: map[string]Property{
				"action":         {Type: "string", Enum: []string{"choose", "plan", "recover", "cancel"}},
				"taskId":         {Type: "string", Description: "Server taskId returned by choose; required for plan/cancel"},
				"newTask":        {Type: "boolean", Description: "choose only: a separate plugin requested by the user"},
				"reconsider":     {Type: "boolean", Description: "choose only: the user explicitly changed the earlier workflow choice"},
				"proposal":       {Type: "string", Description: "Short complete proposal, at most 2000 characters"},
				"packageName":    {Type: "string", Description: "Exact plugin package name"},
				"frontend":       {Type: "string", Enum: []string{"desktop", "desktop-window", "browser-desktop", "mobile", "browser-mobile"}},
				"dataEffects":    {Type: "string", Description: "Data reads/writes and repeated-action semantics, at most 1000 characters"},
				"deliverables":   {Type: "string", Description: "Source/build/package deliverables and unverified steps; installation is separate"},
				"sourcePath":     {Type: "string", Description: "Optional exact existing workspace-relative source directory to import read-only"},
				"sourceRevision": {Type: "string", Description: "Exact source tree revision from project_status; required with sourcePath"},
				"files":          {Type: "array", Items: &Property{Type: "string"}, Description: "1-200 exact relative source/output file paths, including plugin.json and index.js"},
			}, Required: []string{"action"}},
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
