package api

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestContractMissingBlockMessage(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	ids := []string{"20260923000000-abcdefg"}
	check := func(expected string) {
		t.Helper()
		err := holdEncryptedBlockRequests(c, "", ids, false)
		if err == nil || err.Error() != expected {
			t.Fatalf("missing block message: %v, want %q", err, expected)
		}
		if err := holdEncryptedBlockRequests(c, "", ids, true); err != nil {
			t.Fatalf("allowMissing changed: %v", err)
		}
	}
	check("block not found")
	confDir := filepath.Join(util.DataDir, "20260923000000-hijklmn", ".siyuan")
	if err := os.MkdirAll(confDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(confDir, "conf.json"), []byte(`{"encrypted":true,"closed":true}`), 0644); err != nil {
		t.Fatal(err)
	}
	check("block not found or its encrypted notebook is locked")
}
