package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBazaarMCPPagination(t *testing.T) {
	oldConf, oldDataDir := model.Conf, util.DataDir
	model.Conf = model.NewAppConf()
	model.Conf.Bazaar = &conf.Bazaar{}
	util.DataDir = t.TempDir()
	t.Cleanup(func() { model.Conf, util.DataDir = oldConf, oldDataDir })
	for i := 0; i < 23; i++ {
		name := fmt.Sprintf("widget-%02d", i)
		dir := filepath.Join(util.DataDir, "widgets", name)
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		for file, content := range map[string]string{
			"widget.json": fmt.Sprintf(`{"name":%q,"version":"1.0.0"}`, name),
			"README.md":   strings.Repeat("README_CONTENT", 4000),
		} {
			if err := os.WriteFile(filepath.Join(dir, file), []byte(content), 0644); err != nil {
				t.Fatal(err)
			}
		}
	}
	server, httpServer := newTestHTTPServer(t)
	syncTool(server, "bazaar", tools.BazaarTool)
	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "test-client", Version: "1.0.0"}, nil)
	session, err := client.Connect(t.Context(), &mcpsdk.StreamableClientTransport{Endpoint: httpServer.URL}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { session.Close() })
	for _, offset := range []int{0, 20} {
		result, err := session.CallTool(t.Context(), &mcpsdk.CallToolParams{
			Name: "bazaar", Arguments: map[string]any{"action": "installed", "pkgType": "widgets", "offset": offset},
		})
		if err != nil || result.IsError || len(result.Content) != 1 {
			t.Fatalf("MCP call failed: %+v, %v", result, err)
		}
		content := result.Content[0].(*mcpsdk.TextContent).Text
		if len([]rune(content)) >= util.MaxToolOutputChars || strings.Contains(content, "README_CONTENT") {
			t.Fatal("MCP must return compact pages without relying on Agent truncation")
		}
		var page struct {
			Packages []struct {
				Name string `json:"name"`
			} `json:"packages"`
			Total   int  `json:"total"`
			HasMore bool `json:"hasMore"`
		}
		if err = json.Unmarshal([]byte(content), &page); err != nil {
			t.Fatal(err)
		}
		if page.Total != 23 || len(page.Packages) != min(20, 23-offset) || page.HasMore != (offset == 0) ||
			page.Packages[0].Name != fmt.Sprintf("widget-%02d", offset) {
			t.Fatalf("incorrect MCP page: %+v", page)
		}
	}
}
