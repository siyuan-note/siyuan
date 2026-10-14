//go:build fts5

package cmd

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/spf13/cobra"
)

func TestSQLCommandRowLimit(t *testing.T) {
	const childEnv = "SIYUAN_TEST_CLI_SQL_LIMIT"
	if os.Getenv(childEnv) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestSQLCommandRowLimit$", "-test.timeout=30s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("SQL command regression failed: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.DBPath = filepath.Join(root, "siyuan.db")
	util.HistoryDBPath = filepath.Join(root, "history.db")
	util.AssetContentDBPath = filepath.Join(root, "asset_content.db")
	util.BlockTreeDBPath = filepath.Join(root, "blocktree.db")
	util.QueueDir = filepath.Join(root, "queue")
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	const query = "WITH RECURSIVE items(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM items WHERE n<105) SELECT n FROM items"
	for _, tc := range []struct {
		name, statement, format string
		limit, count            int
		truncated               bool
	}{
		{"default JSON", query, "json", 100, 100, true},
		{"explicit SQL limit", query + " LIMIT 5", "json", 3, 3, true},
		{"equal limit", query + " LIMIT 3", "json", 3, 3, false},
		{"small result", query + " LIMIT 2", "json", 3, 2, false},
		{"table", query, "table", 3, 3, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			command := &cobra.Command{}
			command.Flags().Int("limit", tc.limit, "")
			var warning bytes.Buffer
			command.SetErr(&warning)
			output, err := os.CreateTemp(root, "output-")
			if err != nil {
				t.Fatal(err)
			}
			previousStdout := os.Stdout
			os.Stdout = output
			defer func() { os.Stdout = previousStdout }()
			outputFormat = tc.format
			err = sqlCmd.RunE(command, []string{tc.statement})
			os.Stdout = previousStdout
			if closeErr := output.Close(); closeErr != nil {
				t.Fatal(closeErr)
			}
			if err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(output.Name())
			if err != nil {
				t.Fatal(err)
			}
			if tc.format == "json" {
				var rows []json.RawMessage
				if err = json.Unmarshal(data, &rows); err != nil || len(rows) != tc.count {
					t.Fatalf("invalid or unbounded JSON: %s %v", data, err)
				}
			} else if !strings.Contains(string(data), "3 row(s)") {
				t.Fatalf("unexpected table summary: %s", data)
			}
			if strings.Contains(warning.String(), "truncated") != tc.truncated {
				t.Fatalf("unexpected truncation warning: %q", warning.String())
			}
		})
	}
}
