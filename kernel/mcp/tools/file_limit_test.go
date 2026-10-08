package tools

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func TestFileQueryLimits(t *testing.T) {
	workspace := setupProbeWorkspace(t)
	for i := 0; i < 205; i++ {
		writeProbeFile(t, filepath.Join(workspace, "data", "query", fmt.Sprintf("%03d.txt", i)), "match\n")
	}
	writeProbeFile(t, filepath.Join(workspace, "data", "lines.txt"), strings.Repeat("match\n", 205))
	for _, operation := range []string{"list", "find", "grep", "grep-file"} {
		for _, tc := range []struct {
			name  string
			limit any
			count int
		}{
			{"default", nil, 200},
			{"zero", float64(0), 205},
			{"negative", float64(-1), 205},
			{"positive", float64(3), 3},
		} {
			t.Run(operation+"/"+tc.name, func(t *testing.T) {
				args := map[string]any{"path": "data/query", "pattern": "match"}
				if tc.limit != nil {
					args["limit"] = tc.limit
				}
				var result CallToolResult
				var err error
				switch operation {
				case "list":
					result, err = fileList(args)
				case "find":
					result, err = fileFind(args)
				case "grep":
					result, err = fileGrep(args)
				case "grep-file":
					args["path"] = "data/lines.txt"
					result, err = fileGrep(args)
				}
				if err != nil || result.IsError {
					t.Fatalf("query failed: %v, %s", err, probeText(result))
				}
				text := probeText(result)
				marker := ".txt"
				if operation == "grep-file" {
					marker = " match"
				}
				if count := strings.Count(text, marker); count != tc.count {
					t.Fatalf("returned %d results, want %d: %s", count, tc.count, text)
				}
			})
		}
	}
}

func TestGrepUnlimitedContextAndAuthorization(t *testing.T) {
	workspace := setupProbeWorkspace(t)
	writeProbeFile(t, filepath.Join(workspace, "data", "query", "lines.txt"), strings.Repeat("before\nmatch\nafter\n", 100))
	writeProbeFile(t, filepath.Join(workspace, "conf", "conf.json"), `{"secret":"match"}`)
	for _, limit := range []float64{0, -1} {
		result, err := fileGrep(map[string]any{"path": "data/query", "pattern": "match", "context": float64(1), "limit": limit})
		if err != nil || result.IsError || strings.Count(probeText(result), ".txt:") != 300 {
			t.Fatalf("unlimited context query failed: %v, %s", err, probeText(result))
		}
		result, err = fileGrep(map[string]any{"path": "conf", "pattern": "match", "limit": limit})
		if err != nil || result.IsError || strings.Contains(probeText(result), "secret") {
			t.Fatalf("unlimited query exposed protected content: %v, %s", err, probeText(result))
		}
	}
}
