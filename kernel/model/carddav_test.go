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
