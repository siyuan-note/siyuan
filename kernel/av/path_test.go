// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"errors"
	"testing"

	"github.com/88250/lute/ast"
)

func TestRejectInvalidAttributeViewPathIDs(t *testing.T) {
	validID := ast.NewNodeID()
	invalidIDs := []string{
		"",
		"../outside",
		`..\outside`,
		"nested/outside",
		`nested\outside`,
	}

	for _, invalidID := range invalidIDs {
		t.Run(invalidID, func(t *testing.T) {
			if path := attributeViewDataPathByBox(invalidID, ""); path != "" {
				t.Fatalf("invalid attribute view ID [%s] produced path [%s]", invalidID, path)
			}
			if path := GetAttributeViewDataPath(invalidID); path != "" {
				t.Fatalf("invalid attribute view ID [%s] produced path [%s]", invalidID, path)
			}
			if path, boxID := FindAttributeViewPath(invalidID); path != "" || boxID != "" {
				t.Fatalf("invalid attribute view ID [%s] resolved to path [%s] in box [%s]", invalidID, path, boxID)
			}
			if path, boxID := FindAttributeViewPathInBox(invalidID, validID); path != "" || boxID != "" {
				t.Fatalf("invalid attribute view ID [%s] resolved to path [%s] in box [%s]", invalidID, path, boxID)
			}
			if _, err := ParseAttributeView(invalidID); !errors.Is(err, ErrInvalidAttributeViewID) {
				t.Fatalf("invalid attribute view ID [%s] returned error [%v]", invalidID, err)
			}
		})
	}

	if path := attributeViewDataPathByBox(validID, "../outside"); path != "" {
		t.Fatalf("invalid box ID produced path [%s]", path)
	}
	if _, err := ParseAttributeViewInBox(validID, "../outside"); !errors.Is(err, ErrInvalidBoxID) {
		t.Fatalf("invalid box ID returned error [%v]", err)
	}
}
