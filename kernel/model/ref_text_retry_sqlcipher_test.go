//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"context"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestEncryptedDynamicRefTextWriteFailureRetry(t *testing.T) {
	const helper = "SIYUAN_TEST_ENCRYPTED_REF_TEXT_RETRY"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestEncryptedDynamicRefTextWriteFailureRetry$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("encrypted reference refresh subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	password := "ref-retry-test-password"
	if err := EnableEncryptedNotebook(password); err != nil {
		t.Fatal(err)
	}
	boxID, err := CreateEncryptedBox("Encrypted", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = Mount(boxID); err != nil {
		t.Fatal(err)
	}
	testDynamicRefTextWriteFailureRetry(t, boxID)
}
