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

package model

import "testing"

func TestDocDiffAttributeViewSignatureIncludesRichTextSource(t *testing.T) {
	left := []byte(`{
		"spec": 1,
		"id": "20260904010000-av00001",
		"keyValues": [{
			"key": {"id": "text", "type": "text"},
			"values": [{
				"type": "text",
				"text": {
					"content": "same projection",
					"rich": {"spec": 1, "format": "kramdown", "content": "**same projection**"}
				}
			}]
		}]
	}`)
	right := []byte(`{
		"spec": 1,
		"id": "20260904010000-av00001",
		"keyValues": [{
			"key": {"id": "text", "type": "text"},
			"values": [{
				"type": "text",
				"text": {
					"content": "same projection",
					"rich": {"spec": 1, "format": "kramdown", "content": "*same projection*"}
				}
			}]
		}]
	}`)

	if docDiffAttributeViewSignature(left) == docDiffAttributeViewSignature(right) {
		t.Fatal("expected rich text source changes to affect the attribute view history signature")
	}
}

func TestDocDiffAttributeViewSignatureKeepsLegacyAndRichTextDistinct(t *testing.T) {
	legacy := []byte(`{
		"spec": 1,
		"id": "20260904010000-av00001",
		"keyValues": [{
			"key": {"id": "text", "type": "text"},
			"values": [{"type": "text", "text": {"content": "**literal**"}}]
		}]
	}`)
	rich := []byte(`{
		"spec": 1,
		"id": "20260904010000-av00001",
		"keyValues": [{
			"key": {"id": "text", "type": "text"},
			"values": [{
				"type": "text",
				"text": {
					"content": "literal",
					"rich": {"spec": 1, "format": "kramdown", "content": "**literal**"}
				}
			}]
		}]
	}`)

	if docDiffAttributeViewSignature(legacy) == docDiffAttributeViewSignature(rich) {
		t.Fatal("expected legacy plain text and rich text payloads to remain distinct in attribute view history")
	}
}
