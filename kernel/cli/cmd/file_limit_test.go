package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/spf13/cobra"
)

func TestFileQueryLimits(t *testing.T) {
	workspace := t.TempDir()
	originalWorkspace, originalData, originalFormat := util.WorkspaceDir, util.DataDir, outputFormat
	util.WorkspaceDir, util.DataDir, outputFormat = workspace, filepath.Join(workspace, "data"), "json"
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir, outputFormat = originalWorkspace, originalData, originalFormat
	})
	query := filepath.Join(workspace, "query")
	if err := os.Mkdir(query, 0755); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 205; i++ {
		if err := os.WriteFile(filepath.Join(query, fmt.Sprintf("%03d.txt", i)), []byte("match\n"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	for _, command := range []*cobra.Command{fileFindCmd, fileGrepCmd} {
		limitFlag := command.Flags().Lookup("limit")
		originalLimit, originalChanged := limitFlag.Value.String(), limitFlag.Changed
		t.Cleanup(func() {
			_ = limitFlag.Value.Set(originalLimit)
			limitFlag.Changed = originalChanged
		})
		if command == fileGrepCmd {
			for name, value := range map[string]string{"path": "query", "pattern": "match"} {
				flag := command.Flags().Lookup(name)
				original, changed := flag.Value.String(), flag.Changed
				t.Cleanup(func() {
					_ = flag.Value.Set(original)
					flag.Changed = changed
				})
				if err := flag.Value.Set(value); err != nil {
					t.Fatal(err)
				}
			}
		}
		for _, limit := range []int{200, 0, -1, 3} {
			t.Run(command.Name()+"/"+strconv.Itoa(limit), func(t *testing.T) {
				if err := limitFlag.Value.Set(strconv.Itoa(limit)); err != nil {
					t.Fatal(err)
				}
				output, err := os.CreateTemp(workspace, "output-")
				if err != nil {
					t.Fatal(err)
				}
				originalStdout := os.Stdout
				os.Stdout = output
				defer func() { os.Stdout = originalStdout }()
				err = command.RunE(command, []string{"query"})
				os.Stdout = originalStdout
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
				var results []json.RawMessage
				if err = json.Unmarshal(data, &results); err != nil {
					t.Fatalf("invalid JSON: %v, %s", err, data)
				}
				want := limit
				if limit <= 0 {
					want = 205
				}
				if len(results) != want || strings.Contains(string(data), "output-") {
					t.Fatalf("returned %d results, want %d", len(results), want)
				}
			})
		}
	}
}
