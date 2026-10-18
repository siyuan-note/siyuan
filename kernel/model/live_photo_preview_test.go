package model

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/livephoto"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestEncryptedLivePhotoPreviewCompatibilityAndLock(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(map[bool]string{false: "current", true: "legacy"}[legacy], func(t *testing.T) {
			boxID, _, dek := setupEncryptedCleanupTest(t)
			cache := t.TempDir()
			previous := LivePhotoPreviews
			LivePhotoPreviews = livephoto.NewManager(func() string { return cache })
			t.Cleanup(func() { LivePhotoPreviews.Clear(""); LivePhotoPreviews = previous })
			source := testutil.LivePhotoMOV(t)
			var ciphertext []byte
			if legacy {
				ciphertext = legacyEncryptedAssetFixture(t, boxID, "live.mov", "original.mov", dek, source)
			} else {
				var err error
				ciphertext, err = EncryptAsset(boxID, "live.mov", "original.mov", dek, source)
				if err != nil {
					t.Fatal(err)
				}
			}
			path := filepath.Join(util.DataDir, boxID, "assets", "live.mov")
			writeEncryptedCleanupFile(t, path, ciphertext)
			session, err := StartLivePhotoPreview("assets/live.mov?box="+boxID, false)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			preview, err := LivePhotoPreviews.Result(ctx, session.ID)
			if err != nil || len(preview) == 0 {
				t.Fatalf("preview: %d, %v", len(preview), err)
			}
			clear(preview)
			entries, _ := os.ReadDir(cache)
			if len(entries) != 0 {
				t.Fatal("encrypted preview written to disk")
			}
			beginEncryptedBoxLock(boxID)
			if _, err := LivePhotoPreviews.Result(ctx, session.ID); err == nil {
				t.Fatal("locked notebook retained preview")
			}
			if _, err := StartLivePhotoPreview("assets/live.mov?box="+boxID, false); err == nil {
				t.Fatal("locked notebook admitted preview")
			}
			setEncryptedBoxState(boxID, EncryptedBoxStateUnlocked)
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(after, ciphertext) {
				t.Fatal("ciphertext changed")
			}
			corrupt := bytes.Clone(ciphertext)
			corrupt[len(corrupt)-1] ^= 1
			writeEncryptedCleanupFile(t, path, corrupt)
			if _, err := StartLivePhotoPreview("assets/live.mov?box="+boxID, false); err == nil {
				t.Fatal("unauthenticated source accepted")
			}
			after, err = os.ReadFile(path)
			if err != nil || !bytes.Equal(after, corrupt) {
				t.Fatal("corrupt source changed")
			}
		})
	}
}
