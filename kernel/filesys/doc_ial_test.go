package filesys

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

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
	} {
		ial, err := parseDocIAL(reader)
		if ial != nil || !errors.Is(err, readErr) || errors.Is(err, ErrInvalidDocIAL) {
			t.Fatalf("read failure misclassified: ial=%v err=%v", ial, err)
		}
	}
}

func TestParseDocIALCorruptionAndProperties(t *testing.T) {
	for _, data := range []string{`{"Type":"NodeDocument","broken":`, `{"Properties":{}}`, `{"Properties":{"title":`} {
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
