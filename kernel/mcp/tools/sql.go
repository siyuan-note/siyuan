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

import (
	"fmt"
	"sort"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/sql"
)

const sqlQueryDefaultLimit = 100

var SQLTool = &Tool{
	Name:        "sql",
	Description: "Read-only SQL on SiYuan's database. Action: query(stmt) — SELECT only. Results default to at most 100 rows; use explicit LIMIT and OFFSET clauses for pagination.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":   {Type: "string", Description: "Operation", Enum: []string{"query"}},
			"stmt":     {Type: "string", Description: "SQL SELECT statement. Results default to at most 100 rows; use LIMIT and OFFSET for pagination"},
			"notebook": {Type: "string", Description: "Optional notebook ID used to query an encrypted notebook"},
		},
		Required: []string{"action", "stmt"},
	},
	EffectScope: EffectScopeLocal,
	ActionEffects: map[string]ToolEffects{
		"":      {LocalRead: true},
		"query": {LocalRead: true},
	},
	Handler: sqlHandler,
}

func init() {
	register(SQLTool)
}

func sqlHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	if action != "query" {
		if stmt, ok := args["stmt"].(string); ok && stmt != "" {
			return sqlQuery(args)
		}
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected 'query'"}},
			IsError: true,
		}, nil
	}
	return sqlQuery(args)
}

func sqlQuery(args map[string]any) (CallToolResult, error) {
	stmt, _ := args["stmt"].(string)
	if stmt == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "stmt is required"}}, IsError: true}, nil
	}

	stmt = strings.TrimSpace(stmt)

	if err := sql.CheckSingleStatement(stmt); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "invalid SQL: " + err.Error()}}, IsError: true}, nil
	}

	boxID, _ := args["notebook"].(string)
	if boxID == "" {
		if err := sql.CheckReadonlyStatement(stmt); err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "readonly SQL required: " + err.Error()}}, IsError: true}, nil
		}
	} else if err := sql.CheckReadonlyStatementInBox(stmt, boxID); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "readonly SQL required: " + err.Error()}}, IsError: true}, nil
	}

	var rows []map[string]any
	var possiblyTruncated bool
	var err error
	if boxID == "" {
		rows, err = sql.Query(stmt, sqlQueryDefaultLimit)
		possiblyTruncated = len(rows) == sqlQueryDefaultLimit
	} else {
		rows, err = sql.QueryNoLimitInBox(stmt, boxID)
		if len(rows) > sqlQueryDefaultLimit {
			possiblyTruncated = true
			rows = rows[:sqlQueryDefaultLimit]
		}
	}
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "query failed: " + err.Error()}}, IsError: true}, nil
	}

	if len(rows) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no results"}}}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: formatSQLRows(rows, possiblyTruncated)}}}, nil
}

func formatSQLRows(rows []map[string]any, possiblyTruncated bool) string {
	columns := keysOf(rows[0])
	sort.Strings(columns)

	var sb strings.Builder
	if possiblyTruncated {
		sb.WriteString(fmt.Sprintf("Query results (%d rows; the %d-row limit may have truncated the result. Use an explicit LIMIT with OFFSET to paginate):\n\n", len(rows), sqlQueryDefaultLimit))
	} else {
		sb.WriteString(fmt.Sprintf("Query results (%d rows):\n\n", len(rows)))
	}
	sb.WriteString("| " + strings.Join(columns, " | ") + " |\n")
	sb.WriteString("|" + strings.Repeat("---|", len(columns)) + "\n")
	for _, row := range rows {
		vals := make([]string, 0, len(columns))
		for _, k := range columns {
			vals = append(vals, fmt.Sprintf("%v", row[k]))
		}
		sb.WriteString("| " + strings.Join(vals, " | ") + " |\n")
	}
	return sb.String()
}

func keysOf(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
