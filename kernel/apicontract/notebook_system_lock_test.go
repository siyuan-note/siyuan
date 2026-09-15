package apicontract

import (
	"strings"
	"testing"
)

func TestNotebookSystemLockContract(t *testing.T) {
	for _, body := range []string{`{"enabled":true}`, `{"enabled":false}`} {
		if _, err := SetEncryptedNotebookFollowSystemLock.Decode(strings.NewReader(body)); err != nil {
			t.Fatal(err)
		}
	}
	for _, body := range []string{`{}`, `{"enabled":null}`, `{"enabled":1}`, `{"enabled":"true"}`} {
		if _, err := SetEncryptedNotebookFollowSystemLock.Decode(strings.NewReader(body)); err == nil {
			t.Fatalf("accepted invalid setting: %s", body)
		}
	}
	if _, err := LockEncryptedNotebooksOnSystemLock.Decode(strings.NewReader(`{}`)); err != nil {
		t.Fatal(err)
	}
}
