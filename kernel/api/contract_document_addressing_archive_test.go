// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	archivezip "archive/zip"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractDocumentAddressingArchives(t *testing.T) {
	addressingAPIWorkspace(t)
	const document = "20261023000000-rawdoc1.sy"
	ordinary := `{"Spec":"2","Properties":{"title":"A&amp;#47;B"}}`
	future := `{"Spec":"999","Properties":{"title":"Future"}}`
	archive := filepath.Join(util.WorkspaceDir, "source.zip")
	write := func(entries [][2]string) {
		t.Helper()
		file, err := os.Create(archive)
		if err != nil {
			t.Fatal(err)
		}
		writer := archivezip.NewWriter(file)
		for _, entry := range entries {
			out, createErr := writer.Create(entry[0])
			if createErr != nil {
				t.Fatal(createErr)
			}
			if _, err = out.Write([]byte(entry[1])); err != nil {
				t.Fatal(err)
			}
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
		if err = file.Close(); err != nil {
			t.Fatal(err)
		}
	}
	name := addressingAPIBox + "/" + document
	for _, entries := range [][][2]string{
		{{"first.txt", "first"}, {name, future}},
		{{"first.txt", "first"}, {name, future}, {name, ordinary}},
	} {
		write(entries)
		result := callArchiveAPI(t, unzip, `{"zipPath":"source.zip","path":"data"}`)
		if result.Code == 0 {
			t.Fatal("unzip accepted unsupported source")
		}
		if _, err := os.Stat(filepath.Join(util.DataDir, "first.txt")); !os.IsNotExist(err) {
			t.Fatal("unzip wrote an earlier entry before checking the full batch", err)
		}
	}
	// A compatible archive is admitted based on source formats, without remembered modes.
	name = "20261023000001-rawbox2/" + document
	write([][2]string{{name, ordinary}, {"assets/" + document, "arbitrary attachment"}, {"empty/", ""}})
	if result := callArchiveAPI(t, unzip, `{"zipPath":"source.zip","path":"data"}`); result.Code != 0 {
		t.Fatalf("compatible archive rejected: %+v", result)
	}
	if data, err := os.ReadFile(filepath.Join(util.DataDir, name)); err != nil || string(data) != ordinary {
		t.Fatalf("unzip changed source bytes: %q, %v", data, err)
	}
	addressingAPIWrite(t, filepath.Join(util.DataDir, name), future)
	if result := callArchiveAPI(t, unzip, `{"zipPath":"source.zip","path":"data"}`); result.Code == 0 {
		t.Fatal("unzip overwrote unsupported existing document")
	}
	payload, _ := json.Marshal(map[string]string{"path": "data/assets", "zipPath": "data/" + name})
	if result := callArchiveAPI(t, zip, string(payload)); result.Code == 0 {
		t.Fatal("zip overwrote a document source")
	}
	if data, _ := os.ReadFile(filepath.Join(util.DataDir, name)); string(data) != future {
		t.Fatal("archive API modified protected source")
	}
}
