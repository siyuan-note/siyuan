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

package api

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestPreserveImportedAISecrets(t *testing.T) {
	currentMCP := &conf.MCP{Servers: []conf.MCPServer{{ID: "server", Headers: map[string]string{"Authorization": "secret"}}}}
	current := &conf.AI{
		Providers: []*conf.Provider{
			{ID: "matching", APIKey: "local-key", BaseURL: "https://example.com", Protocol: "openai"},
			{ID: "changed-endpoint", APIKey: "endpoint-key", BaseURL: "https://local.example.com"},
			{ID: "removed", APIKey: "removed-key"},
		},
		Embedding: &conf.Embedding{ID: "embedding", APIKey: "embedding-key", BaseURL: "https://embedding.example.com"},
		Rerank:    &conf.Rerank{ID: "rerank", APIKey: "rerank-key", Endpoint: "https://local.example.com/rerank"},
		MCP:       currentMCP,
	}
	imported := &conf.AI{
		Providers: []*conf.Provider{
			{ID: "matching", BaseURL: "https://example.com", Protocol: "openai"},
			{ID: "changed-endpoint", BaseURL: "https://imported.example.com"},
			{ID: "different"},
			{ID: "provided", APIKey: "imported-key"},
		},
		Embedding: &conf.Embedding{ID: "embedding", BaseURL: "https://embedding.example.com"},
		Rerank:    &conf.Rerank{ID: "rerank", Endpoint: "https://imported.example.com/rerank"},
	}

	preserveImportedAISecrets(imported, current)

	if imported.Providers[0].APIKey != "local-key" {
		t.Fatalf("matching provider key = %q, want local key", imported.Providers[0].APIKey)
	}
	if imported.Providers[1].APIKey != "" {
		t.Fatalf("changed endpoint provider key = %q, want empty", imported.Providers[1].APIKey)
	}
	if imported.Providers[2].APIKey != "" {
		t.Fatalf("different provider key = %q, want empty", imported.Providers[2].APIKey)
	}
	if imported.Providers[3].APIKey != "imported-key" {
		t.Fatalf("provided provider key = %q, want imported key", imported.Providers[3].APIKey)
	}
	if imported.Embedding.APIKey != "embedding-key" {
		t.Fatalf("embedding key = %q, want local key", imported.Embedding.APIKey)
	}
	if imported.Rerank.APIKey != "" {
		t.Fatalf("different rerank key = %q, want empty", imported.Rerank.APIKey)
	}
	if imported.MCP != currentMCP {
		t.Fatal("local MCP configuration was not preserved")
	}

	matchingRerank := &conf.AI{Rerank: &conf.Rerank{ID: "rerank", Endpoint: "https://local.example.com/rerank"}}
	preserveImportedAISecrets(matchingRerank, current)
	if matchingRerank.Rerank.APIKey != "rerank-key" {
		t.Fatalf("matching rerank key = %q, want local key", matchingRerank.Rerank.APIKey)
	}
}

func TestPreserveImportedMCPConfiguration(t *testing.T) {
	currentMCP := &conf.MCP{Servers: []conf.MCPServer{{ID: "current"}}}
	importedMCP := &conf.MCP{Servers: []conf.MCPServer{{ID: "imported"}}}
	imported := &conf.AI{MCP: importedMCP}

	preserveImportedAISecrets(imported, &conf.AI{MCP: currentMCP})

	if imported.MCP != importedMCP {
		t.Fatal("imported MCP configuration should take precedence")
	}
}
