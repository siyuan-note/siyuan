// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"
	"testing"
)

func TestValidateCreateDocRejectsMalformedPaths(t *testing.T) {
	previous := Conf
	Conf = NewAppConf()
	t.Cleanup(func() { Conf = previous })
	const id = "20261105120000-abcdefg"
	for _, p := range []string{"", "/tmp-av-probe", id + ".sy", "/" + id,
		"/" + id + ".sy/", "/invalid/" + id + ".sy", "/../" + id + ".sy",
		"//" + id + ".sy", "/" + id + "//" + id + ".sy", "/" + id + ".sy.sy"} {
		t.Run(p, func(t *testing.T) {
			result, err := validateCreateDoc(id, p, "Title", false)
			if result != nil || err == nil || !strings.Contains(err.Error(), "invalid document path") {
				t.Fatalf("path %q reached notebook access: result=%v, error=%v", p, result, err)
			}
		})
	}
	for _, p := range []string{"/" + id + ".sy", "/" + id + "/" + id + ".sy"} {
		_, err := validateCreateDoc(id, p, "Title", false)
		if err == nil || strings.Contains(err.Error(), "invalid document path") {
			t.Fatalf("valid path %q did not reach notebook validation: %v", p, err)
		}
	}
}
