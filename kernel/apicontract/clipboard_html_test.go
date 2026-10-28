// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"strings"
	"testing"
)

func TestHTMLClipboardOptionalTypeCompatibility(t *testing.T) {
	request, err := HTML2BlockDOM.Decode(strings.NewReader(`{"dom":"  html  ","text":42,"notebook":{},"preflight":"true","skipLocalAssets":[],"skipBase64Assets":null,"preparedHTML":true}`))
	if err != nil || request.DOM != "  html  " || request.Text != "" || request.Notebook != "" || request.Preflight || request.SkipLocalAssets || request.SkipBase64Assets || !request.PreparedHTML {
		t.Fatalf("optional clipboard fields changed: %#v, %v", request, err)
	}
	for _, body := range []string{`{}`, `{"dom":null}`, `{"dom":42}`} {
		if _, err := HTML2BlockDOM.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("accepted invalid DOM: %s", body)
		}
	}
}
