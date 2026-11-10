// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
)

func TestBazaarContractPackageMetadataHTTP(t *testing.T) {
	bundle, err := apicontract.BuildBundle()
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name, created string
		unsupported   bool
	}{
		{name: "known", created: "2026-11-01T12:34:56Z", unsupported: true},
		{name: "unknown"},
	} {
		t.Run(test.name, func(t *testing.T) {
			pkg := &bazaar.Package{
				Name: "sample", Created: test.created, Updated: "2026-11-07T10:00:00Z",
				InstallTime: 1234, UpdateTime: 5678, BazaarVersionUnsupported: test.unsupported,
			}
			path := "/api/bazaar/getBazaarPlugin"
			engine := gin.New()
			engine.POST(path, contractHandler(apicontract.GetBazaarPlugin, func(_ *gin.Context, _ apicontract.GetBazaarPluginRequest) apicontract.Response[apicontract.BazaarPackagesData] {
				return apicontract.Success(apicontract.BazaarPackagesData{Packages: bazaarPackages([]*bazaar.Package{pkg})})
			}))
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{"frontend":"desktop"}`)))
			if err = bundle.ValidateHTTPResponse(http.MethodPost, path, recorder.Code, recorder.Header().Get("Content-Type"), recorder.Body.Bytes()); err != nil {
				t.Fatal(err)
			}
			var response struct {
				Code int
				Data struct {
					Packages []map[string]json.RawMessage
				}
			}
			if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Code != 0 || len(response.Data.Packages) != 1 {
				t.Fatalf("unexpected response %s", recorder.Body.Bytes())
			}
			fields := response.Data.Packages[0]
			if created, exists := fields["created"]; exists != (test.created != "") || exists && string(created) != `"`+test.created+`"` {
				t.Fatalf("unexpected created %s in %s", created, recorder.Body.Bytes())
			}
			if unsupported, exists := fields["bazaarVersionUnsupported"]; exists != test.unsupported || exists && string(unsupported) != "true" {
				t.Fatalf("unexpected bazaarVersionUnsupported %s in %s", unsupported, recorder.Body.Bytes())
			}
			if string(fields["updated"]) != `"`+pkg.Updated+`"` || string(fields["installTime"]) != "1234" || string(fields["updateTime"]) != "5678" {
				t.Fatalf("existing timestamps changed: %s", recorder.Body.Bytes())
			}
		})
	}
}
