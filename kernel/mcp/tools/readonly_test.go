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

import "testing"

// TestReadsOnlyClassifiesReadActions 覆盖只读判定：读取动作放行，写入动作一律拒绝。
func TestReadsOnlyClassifiesReadActions(t *testing.T) {
	tests := []struct {
		tool      *Tool
		action    string
		readsOnly bool
	}{
		{SearchTool, "fulltext", true},
		{SearchTool, "semantic", true},
		{SearchTool, "asset", true},
		{SQLTool, "query", true},
		{SQLTool, "", true},
		{BlockTool, "get", true},
		{BlockTool, "get_kramdown", true},
		{BlockTool, "batch_get", true},
		{BlockTool, "insert", false},
		{BlockTool, "update", false},
		{BlockTool, "delete", false},
		{BlockTool, "move", false},
		{DocumentTool, "get", true},
		{DocumentTool, "list", true},
		{DocumentTool, "search_docs", true},
		{DocumentTool, "create", false},
		{DocumentTool, "rename", false},
		{DocumentTool, "duplicate", false},
		{OutlineTool, "get", true},
		{HistoryTool, "get", true},
		{HistoryTool, "rollback", false},
		{HistoryTool, "clear", false},
		{AttrTool, "get", true},
		{AttrTool, "batch-get", true},
		{AttrTool, "set", false},
		{NotebookTool, "list", true},
		{NotebookTool, "create", false},
		{NotebookTool, "remove", false},
		{WebFetchTool, "", true},
		{WebSearchTool, "", true},
		{AgentLogTool, "tail", true},
		{WorkspaceTool, "list", true},
		{SystemTool, "version", true},
		{SkillTool, "load", true},
		{SkillTool, "list", true},
		{SkillTool, "save", false},
		{SkillTool, "remove", false},
		{BazaarTool, "list", true},
		{BazaarTool, "install", false},
		{BazaarTool, "uninstall", false},
		{DatabaseTool, "get", true},
		{DatabaseTool, "item_add", false},
		{ImageTool, "list", true},
		{ImageTool, "generate", false},
		{AssetTool, "stat", true},
		{AssetTool, "clean", false},
		{ExportTool, "md", true},
		{ExportTool, "preview", true},
		{ExportTool, "data", false},
		{ImportTool, "sy", false},
		{UnzipTool, "", false},
		{SyncTool, "status", true},
		{SyncTool, "perform", false},
		{RepoTool, "list", true},
		{RepoTool, "create", false},
		{TemplateTool, "get", true},
		{TemplateTool, "create", false},
		{TagTool, "list", true},
		{TagTool, "remove", false},
		{BookmarkTool, "list", true},
		{BookmarkTool, "remove", false},
		{FileTool, "read", true},
		{FileTool, "grep", true},
		{FileTool, "write", false},
		{FileTool, "delete", false},
		{HTTPRequestTool, "", false},
		{HTTPRequestTool, "get", true},
		{HTTPRequestTool, "post", false},
		{HTTPRequestTool, "delete", false},
		{DailynoteTool, "create", false},
		{InboxTool, "get", true},
		{InboxTool, "convert", false},
	}
	for _, test := range tests {
		if actual := test.tool.ReadsOnly(test.action); actual != test.readsOnly {
			t.Errorf("unexpected read-only result for [%s.%s]: got %v, want %v", test.tool.Name, test.action, actual, test.readsOnly)
		}
	}
}

// TestReadsOnlyRejectsWriteActionsSharingReadNames 守住 action 白名单契约：写操作不得因重名被放行。
func TestReadsOnlyRejectsWriteActionsSharingReadNames(t *testing.T) {
	if ImportTool.ReadsOnly("md") {
		t.Fatal("import.md writes into the workspace and must not be treated as read-only")
	}
}

// TestReadsOnlyTreatsUnknownActionAsWrite 未在白名单中的 action 与空工具按写操作处理。
func TestReadsOnlyTreatsUnknownActionAsWrite(t *testing.T) {
	if (&Tool{Name: "unknown"}).ReadsOnly("insert") {
		t.Fatal("unknown action must not be treated as read-only")
	}
	if (&Tool{Name: "unknown"}).ReadsOnly("") {
		t.Fatal("unknown tool without action must not be treated as read-only")
	}
	if (*Tool)(nil).ReadsOnly("get") {
		t.Fatal("nil tool must not be treated as read-only")
	}
}
