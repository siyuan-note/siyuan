// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestParseDocIALRetainsSourceChecksWithoutModes(t *testing.T) {
	for _, source := range []string{
		`{"Spec":"2","Properties":{"title":"A/B"}}`,
		`{"Spec":"2","Properties":{"title":"A/B","title":"Legacy"}}`,
		`{"Spec":"2","Properties":{"title":"A/B"},"Properties":{"title":"Legacy"}}`,
	} {
		if _, err := parseDocIAL(strings.NewReader(source)); err != nil {
			t.Fatal("supported slash title rejected", err)
		}
	}
	if _, err := parseDocIAL(strings.NewReader(`{"Spec":"999","Properties":{"title":"A/B"}}`)); !errors.Is(err, treenode.ErrSpecTooNew) {
		t.Fatal("Spec check lost", err)
	}
}

type failingDocIALReader struct {
	err error
}

func TestDocIALEncryptedAuthentication(t *testing.T) {
	originalDataDir, originalProvider := util.DataDir, DEKProvider
	originalAcquire, originalRelease := DEKLockAcquire, DEKLockRelease
	util.DataDir = t.TempDir()
	dek := bytes.Repeat([]byte{19}, 32)
	DEKProvider = func(string) ([]byte, error) { return bytes.Clone(dek), nil }
	DEKLockAcquire, DEKLockRelease = nil, nil
	t.Cleanup(func() {
		util.DataDir, DEKProvider = originalDataDir, originalProvider
		DEKLockAcquire, DEKLockRelease = originalAcquire, originalRelease
	})
	legacy, err := os.ReadFile("../treenode/testdata/table-cell-legacy.sy")
	if err != nil {
		t.Fatal(err)
	}
	const boxID = "20260908000000-box0001"
	const document = "/20260908000000-root001.sy"
	ciphertext, err := encryptDataWithDEK(boxID, document, legacy, dek)
	if err != nil {
		t.Fatal(err)
	}
	absPath := filepath.Join(util.DataDir, boxID, document)
	if err = os.MkdirAll(filepath.Dir(absPath), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(absPath, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	if ial, readErr := DocIAL(absPath); readErr != nil || len(ial) == 0 {
		t.Fatalf("supported encrypted document not readable: %v, %v", ial, readErr)
	}
	ciphertext[len(ciphertext)-1] ^= 1
	if err = os.WriteFile(absPath, ciphertext, 0600); err != nil {
		t.Fatal(err)
	}
	if ial, readErr := DocIAL(absPath); ial != nil || readErr == nil || errors.Is(readErr, ErrInvalidDocIAL) {
		t.Fatalf("authentication failure misclassified: %v, %v", ial, readErr)
	}
	retained, err := os.ReadFile(absPath)
	if err != nil || !bytes.Equal(retained, ciphertext) {
		t.Fatal("failed authentication changed the original ciphertext")
	}
}

func (r failingDocIALReader) Read([]byte) (int, error) {
	return 0, r.err
}

func TestParseDocIALDistinguishesReadFailure(t *testing.T) {
	readErr := errors.New("temporary read failure")
	for _, reader := range []io.Reader{
		failingDocIALReader{readErr},
		io.MultiReader(strings.NewReader(`{"Type":"NodeDocument","Properties":{`), failingDocIALReader{readErr}),
		io.MultiReader(strings.NewReader(`{"Properties":{"title":"Parent"},"Children":[`+strings.Repeat(" ", 1024)), failingDocIALReader{readErr}),
	} {
		ial, err := parseDocIAL(reader)
		if ial != nil || !errors.Is(err, readErr) || errors.Is(err, ErrInvalidDocIAL) {
			t.Fatalf("read failure misclassified: ial=%v err=%v", ial, err)
		}
	}
}

func TestParseDocIALCorruptionAndProperties(t *testing.T) {
	for _, data := range []string{
		`{"Type":"NodeDocument","broken":`,
		`{"Properties":{}}`,
		`{"Properties":{"title":`,
		`{"Properties":{"title":"Parent"},"Children":[`,
		`{"Properties":{"title":"Parent"}},`,
		`{"Properties":{"title":"Parent"}} {"Spec":"999"}`,
	} {
		ial, err := parseDocIAL(strings.NewReader(data))
		if ial != nil || !errors.Is(err, ErrInvalidDocIAL) {
			t.Fatalf("corruption misclassified: data=%q ial=%v err=%v", data, ial, err)
		}
	}
	ial, err := parseDocIAL(strings.NewReader(`{"Properties":{"title":"A &amp; B"},"Children":[]}`))
	if err != nil || ial["title"] != "A & B" {
		t.Fatalf("properties not decoded: ial=%v err=%v", ial, err)
	}
}

func TestParseDocIALChecksSpecAfterProperties(t *testing.T) {
	for _, data := range []string{
		`{"Spec":"999","Properties":{"title":"Future"}}`,
		`{"Properties":{"title":"Future"},"Spec":"999"}`,
		`{"Properties":{"title":"Future"},"Children":[{"Data":"` + strings.Repeat("x", 2048) + `"}],"Spec":"999"}`,
		`{"Spec":"999","Properties":{"title":"Future"},"Spec":"2"}`,
		`{"Properties":{"title":"Future"},"spec":"999"}`,
		`{"Properties":{"title":"Future"},"Sp\u0065c":"999"}`,
		`{"Properties":{"title":"Future"},"":[],"Spec":"999"}`,
		`{"Properties":[{"title":"Future"}],"Spec":"999"}`,
		`{"Properties":"future format","Spec":"999"}`,
		`{"Properties":{"title":{"text":"Future"}},"Spec":"999"}`,
		"\xef\xbb\xbf" + `{"Properties":{"title":"Future"},"Spec":"999"}`,
	} {
		ial, err := parseDocIAL(strings.NewReader(data))
		if ial != nil || !errors.Is(err, treenode.ErrSpecTooNew) || errors.Is(err, ErrInvalidDocIAL) {
			t.Fatalf("unsupported spec did not preserve version error: ial=%v err=%v", ial, err)
		}
	}
}

func TestParseDocIALRetainsSupportedSpecs(t *testing.T) {
	for _, spec := range []string{"", "1", "2", "3", "4", "5"} {
		t.Run("spec="+spec, func(t *testing.T) {
			data := `{"Properties":{"title":"A &amp; B"},"Spec":"` + spec + `","Children":[]}`
			ial, err := parseDocIAL(strings.NewReader(data))
			if err != nil || ial["title"] != "A & B" {
				t.Fatalf("supported properties changed: ial=%v err=%v", ial, err)
			}
		})
	}
	for _, data := range []string{
		`{"Properties":{"title":"Parent"},"":[],"Spec":"2"}`,
		`{"Properties":{"title":"Parent"},"Spec":null}`,
		`{"Properties":{"title":"Parent"},"Children":[{"Spec":"999"}],"Spec":"2"}`,
	} {
		ial, err := parseDocIAL(strings.NewReader(data))
		if err != nil || ial["title"] != "Parent" {
			t.Fatalf("compatible root properties changed: ial=%v err=%v", ial, err)
		}
	}
	for _, spec := range []string{`"0"`, `"-1"`, `"invalid"`, `999`, `{}`, `false`} {
		ial, err := parseDocIAL(strings.NewReader(`{"Properties":{"title":"Invalid"},"Spec":` + spec + `}`))
		if ial != nil || err == nil || errors.Is(err, ErrInvalidDocIAL) {
			t.Fatalf("invalid spec was accepted or treated as repairable properties: spec=%q ial=%v err=%v", spec, ial, err)
		}
	}
	_, err := parseDocIAL(strings.NewReader(`{"Properties":{"title":"private-title"},"Spec":{"secret":"private-spec"}}`))
	if err == nil || strings.Contains(err.Error(), "private-") {
		t.Fatalf("invalid version exposed source content: %v", err)
	}
}

func TestDocIALPreservesUnsupportedSources(t *testing.T) {
	legacy, err := os.ReadFile("../treenode/testdata/table-cell-legacy.sy")
	if err != nil {
		t.Fatal(err)
	}
	var future map[string]json.RawMessage
	if err = json.Unmarshal(legacy, &future); err != nil {
		t.Fatal(err)
	}
	future["Spec"] = json.RawMessage(`"999"`)
	unsupported, err := json.Marshal(future)
	if err != nil {
		t.Fatal(err)
	}
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "ordinary", true: "encrypted"}[encrypted], func(t *testing.T) {
			originalDataDir, originalProvider := util.DataDir, DEKProvider
			originalAcquire, originalRelease := DEKLockAcquire, DEKLockRelease
			util.DataDir = t.TempDir()
			DEKProvider, DEKLockAcquire, DEKLockRelease = nil, nil, nil
			t.Cleanup(func() {
				util.DataDir, DEKProvider = originalDataDir, originalProvider
				DEKLockAcquire, DEKLockRelease = originalAcquire, originalRelease
			})
			var dek []byte
			if encrypted {
				dek = bytes.Repeat([]byte{23}, 32)
				DEKProvider = func(string) ([]byte, error) { return bytes.Clone(dek), nil }
			}
			const boxID = "20260908000000-box0001"
			const document = "/20260908000000-root001.sy"
			absPath := filepath.Join(util.DataDir, boxID, document)
			if err := os.MkdirAll(filepath.Dir(absPath), 0700); err != nil {
				t.Fatal(err)
			}
			readers := map[string]func() (map[string]string, error){
				"attributes": func() (map[string]string, error) { return DocIAL(absPath) },
				"parent":     func() (map[string]string, error) { return readParentDocIAL(absPath) },
				"path": func() (map[string]string, error) {
					_, properties, err := ReadDocHPath(boxID, document)
					return properties, err
				},
			}
			for _, source := range [][]byte{legacy, unsupported} {
				data, err := encryptDataWithDEK(boxID, document, source, dek)
				if err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(absPath, data, 0600); err != nil {
					t.Fatal(err)
				}
				for name, read := range readers {
					ial, readErr := read()
					if bytes.Equal(source, legacy) {
						if readErr != nil || len(ial) == 0 {
							t.Fatalf("%s rejected supported historical source: ial=%v err=%v", name, ial, readErr)
						}
					} else if ial != nil || !errors.Is(readErr, treenode.ErrSpecTooNew) || errors.Is(readErr, ErrInvalidDocIAL) {
						t.Errorf("%s accepted unsupported source or lost version error: ial=%v err=%v", name, ial, readErr)
					}
				}
				retained, err := os.ReadFile(absPath)
				if err != nil || !bytes.Equal(retained, data) {
					t.Fatal("attribute reads changed the original source")
				}
			}
		})
	}
}
