// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
