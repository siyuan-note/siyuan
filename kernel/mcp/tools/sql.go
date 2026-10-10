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

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

const sqlQueryDefaultLimit = 100

var SQLTool = &Tool{
	Name:        "sql",
	Description: "Read-only SQL on SiYuan's database. Actions: schema() for table definitions, type codes, hierarchy and search examples; query(stmt) for statistics, arbitrary projections and structural searches. Results include raw structured rows and verified block links. Results default to at most 100 rows; use explicit LIMIT and OFFSET for pagination. For the frontend SQL search interface, use SELECT b.* FROM blocks b to return complete block rows; ordinary search filters do not apply to SQL.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":   {Type: "string", Description: "Operation", Enum: []string{"query", "schema"}},
			"stmt":     {Type: "string", Description: "SQL SELECT statement. Results default to at most 100 rows; use LIMIT and OFFSET for pagination"},
			"notebook": {Type: "string", Description: "Optional notebook ID used to query an encrypted notebook"},
		},
		Required: []string{"action"},
	},
	EffectScope: EffectScopeLocal,
	ActionEffects: map[string]ToolEffects{
		"":       {LocalRead: true},
		"query":  {LocalRead: true},
		"schema": {LocalRead: true},
	},
	Handler: sqlHandler,
}

func init() {
	register(SQLTool)
}

func sqlHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	if action == "schema" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: sqlSchemaGuide}}}, nil
	}
	if action != "query" {
		if stmt, ok := args["stmt"].(string); ok && stmt != "" {
			return sqlQuery(args)
		}
		return CallToolResult{
			Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected 'query' or 'schema'"}},
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

	return sqlQueryResult(rows, possiblyTruncated, boxID), nil
}

func sqlQueryResult(rows []map[string]any, possiblyTruncated bool, boxID string) CallToolResult {
	if rows == nil {
		rows = []map[string]any{}
	}
	columns, candidateIDs := map[string]bool{}, map[string]bool{}
	for _, row := range rows {
		for column, value := range row {
			columns[column] = true
			if column == "id" || column == "block_id" || column == "root_id" || column == "parent_id" {
				if id, ok := value.(string); ok && ast.IsNodeIDPattern(id) {
					candidateIDs[id] = true
				}
			}
		}
	}
	columnNames, ids := []string{}, []string{}
	for column := range columns {
		columnNames = append(columnNames, column)
	}
	for id := range candidateIDs {
		ids = append(ids, id)
	}
	sort.Strings(columnNames)
	sort.Strings(ids)
	links := []map[string]string{}
	if len(ids) > 0 {
		var blocks []*sql.Block
		if boxID == "" {
			blocks = sql.GetBlocks(ids)
		} else {
			blocks = sql.GetBlocksInBox(ids, boxID)
		}
		for _, block := range blocks {
			if block != nil {
				links = append(links, map[string]string{"id": block.ID, "url": "siyuan://blocks/" + block.ID})
			}
		}
	}
	text := "no results"
	if len(rows) > 0 {
		text = formatSQLRows(rows, possiblyTruncated)
	}
	if len(links) > 0 {
		text += "\nBlocks:\n"
		for _, link := range links {
			text += "- [" + link["id"] + "](" + link["url"] + ")\n"
		}
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: text}},
		StructuredContent: map[string]any{"rows": rows, "columns": columnNames,
			"rowCount": len(rows), "possiblyTruncated": possiblyTruncated, "defaultLimit": sqlQueryDefaultLimit,
			"blocks": links},
		StructuredContentSet: true,
	}
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
			value := fmt.Sprintf("%v", row[k])
			value = strings.ReplaceAll(value, "|", "\\|")
			value = strings.ReplaceAll(strings.ReplaceAll(value, "\r\n", "\n"), "\n", "<br>")
			vals = append(vals, value)
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
