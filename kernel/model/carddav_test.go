// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// TestCardDAVAddressDataFiltering 验证 address-data 中列出属性时只返回这些属性和 VERSION（RFC 6352 §10.4.2）。
func TestCardDAVAddressDataFiltering(t *testing.T) {
	_, cardDAV := newDAVHandlerFixture(t)
	book := CardDavDefaultAddressBookPath
	if response := davTestRequest(cardDAV, http.MethodPut, book+"/carol.vcf", davVCardHeader, davTestCard("carol", "Carol")); response.Code != http.StatusCreated {
		t.Fatalf("PUT: status = %d", response.Code)
	}
	response := davTestRequest(cardDAV, "REPORT", book, davXMLHeader,
		`<?xml version="1.0"?><C:addressbook-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><D:prop><D:getetag/><C:address-data><C:prop name="FN"/></C:address-data></D:prop><D:href>`+book+`/carol.vcf</D:href></C:addressbook-multiget>`)
	body := response.Body.String()
	if response.Code != http.StatusMultiStatus || !strings.Contains(body, "FN:Carol") || !strings.Contains(body, "VERSION:3.0") {
		t.Fatalf("multiget: status = %d; body = %s", response.Code, body)
	}
	if strings.Contains(body, "EMAIL") || strings.Contains(body, "UID:carol") {
		t.Fatalf("multiget returned properties that were not requested: %s", body)
	}
	if get := davTestRequest(cardDAV, http.MethodGet, book+"/carol.vcf", nil, ""); !strings.Contains(get.Body.String(), "EMAIL:carol@example.com") {
		t.Fatalf("GET must still return the full card: %s", get.Body.String())
	}
}

// TestCardDAVQuery 验证 addressbook-query 的过滤、默认 Depth 和结果数限制（RFC 6352 §8.6、§10.5、§10.6）。
func TestCardDAVQuery(t *testing.T) {
	_, cardDAV := newDAVHandlerFixture(t)
	book := CardDavDefaultAddressBookPath
	for _, uid := range []string{"anna", "bert", "carl"} {
		if response := davTestRequest(cardDAV, http.MethodPut, book+"/"+uid+".vcf", davVCardHeader, davTestCard(uid, strings.ToUpper(uid[:1])+uid[1:])); response.Code != http.StatusCreated {
			t.Fatalf("PUT %s: status = %d", uid, response.Code)
		}
	}
	query := func(filter, limit string) string {
		return `<?xml version="1.0"?><C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><D:prop><D:getetag/><C:address-data><C:prop name="FN"/></C:address-data></D:prop>` +
			filter + limit + `</C:addressbook-query>`
	}
	for _, test := range []struct {
		name, filter, limit string
		header              map[string]string
		want                []string
		truncated           bool
	}{
		{"starts-with", `<C:filter><C:prop-filter name="FN"><C:text-match match-type="starts-with">BE</C:text-match></C:prop-filter></C:filter>`, "", davXMLHeader, []string{"/bert.vcf"}, false},
		{"allof", `<C:filter test="allof"><C:prop-filter name="EMAIL"><C:text-match>example.com</C:text-match></C:prop-filter><C:prop-filter name="FN"><C:text-match match-type="equals">carl</C:text-match></C:prop-filter></C:filter>`, "", davXMLHeader, []string{"/carl.vcf"}, false},
		{"no filter", "", "", davXMLHeader, []string{"/anna.vcf", "/bert.vcf", "/carl.vcf"}, false},
		{"Depth defaults to 0", "", "", davTestXMLOnly, nil, false},
		{"limit", `<C:filter/>`, `<C:limit><C:nresults>2</C:nresults></C:limit>`, davXMLHeader, []string{"/anna.vcf", "/bert.vcf"}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := davTestRequest(cardDAV, "REPORT", book, test.header, query(test.filter, test.limit))
			body := response.Body.String()
			responses := len(test.want)
			if test.truncated {
				responses++
			}
			if response.Code != http.StatusMultiStatus || strings.Count(body, "<response") != responses {
				t.Fatalf("status = %d, responses = %d, want %v; body = %s", response.Code, strings.Count(body, "<response"), test.want, body)
			}
			for _, want := range test.want {
				if !strings.Contains(body, want+"<") {
					t.Fatalf("result lacks %s: %s", want, body)
				}
			}
			if test.truncated != (strings.Contains(body, "507 Insufficient Storage") && strings.Contains(body, "number-of-matches-within-limits")) {
				t.Fatalf("truncation must be reported with 507: %s", body)
			}
			if 0 < len(test.want) && (!strings.Contains(body, "FN:") || strings.Contains(body, "EMAIL")) {
				t.Fatalf("address-data must only contain FN: %s", body)
			}
		})
	}
}

// TestCardDAVSplitsMultiCardFiles 验证包含多张卡片的 .vcf 拆分后每张卡片都能访问，
// 且不同设备拆分同一文件得到相同文件名，同步后不会出现重复联系人。
func TestCardDAVSplitsMultiCardFiles(t *testing.T) {
	multi := davTestCard("u1", "Alice") + davTestCard("u2", "Bob")
	var names [][]string
	for range 2 {
		_, cardDAV := newDAVHandlerFixture(t)
		dir := DavPath2DirectoryPath(CardDavDefaultAddressBookPath)
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "multi.vcf"), []byte(multi), 0644); err != nil {
			t.Fatal(err)
		}
		propfind := davTestRequest(cardDAV, "PROPFIND", CardDavDefaultAddressBookPath, map[string]string{"Depth": "1"}, "")
		if count := strings.Count(propfind.Body.String(), "<response"); count != 3 {
			t.Fatalf("PROPFIND responses = %d, want the collection and two cards; body = %s", count, propfind.Body.String())
		}
		entries, err := os.ReadDir(dir)
		if err != nil {
			t.Fatal(err)
		}
		var files []string
		bodies := map[string]bool{}
		for _, entry := range entries {
			files = append(files, entry.Name())
			get := davTestRequest(cardDAV, http.MethodGet, CardDavDefaultAddressBookPath+"/"+entry.Name(), nil, "")
			if get.Code != http.StatusOK {
				t.Fatalf("GET %s: status = %d", entry.Name(), get.Code)
			}
			bodies[get.Body.String()] = true
		}
		sort.Strings(files)
		if len(files) != 2 || len(bodies) != 2 {
			t.Fatalf("split produced files %v with %d distinct cards", files, len(bodies))
		}
		names = append(names, files)
	}
	if strings.Join(names[0], ",") != strings.Join(names[1], ",") {
		t.Fatalf("splitting the same file produced different names: %v and %v", names[0], names[1])
	}
}
