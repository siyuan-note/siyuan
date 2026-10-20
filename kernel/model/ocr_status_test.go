package model

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/ocr"
)

func TestOCRFailureStatus(t *testing.T) {
	setupAssetUploadTest(t)
	Conf.FileTree.Store(conf.NewFileTree())
	const path = "assets/ocr-status-fixture.png"
	for _, suffix := range []string{"", "?box=20261001021001-abcdefg", "?box=20261001021002-abcdefg"} {
		t.Cleanup(func() { clearOCRFailure(path + suffix) })
	}
	recordOCRFailure(path+"#preview", errors.New("inference failed"))
	if !HasOCRFailure(path) || !HasOCRFailure(path+"?width=100#preview") {
		t.Fatal("display parameters changed failure identity")
	}
	firstBox := path + "?box=20261001021001-abcdefg"
	secondBox := path + "?box=20261001021002-abcdefg"
	if HasOCRFailure(firstBox) || HasOCRFailure(secondBox) {
		t.Fatal("global failure leaked into notebook-scoped resources")
	}
	recordOCRFailure(firstBox, errors.New("inference failed"))
	if !HasOCRFailure(firstBox+"&width=100#preview") || HasOCRFailure(secondBox) {
		t.Fatal("notebook failure identity was not isolated")
	}
	clearOCRFailure(firstBox)
	if HasOCRFailure(firstBox) || !HasOCRFailure(path) {
		t.Fatal("clearing one resource changed another failure")
	}
	for _, err := range []error{nil, context.Canceled, fmt.Errorf("wrapped: %w", context.Canceled), ocr.ErrUnsupportedImage} {
		recordOCRFailure(secondBox, err)
		if HasOCRFailure(secondBox) {
			t.Fatalf("non-failure recorded: %v", err)
		}
	}
	recordOCRFailure("https://example.com/image.png", errors.New("not local"))
	if HasOCRFailure("https://example.com/image.png") {
		t.Fatal("external resource was recorded")
	}
}

func TestOCRFailureStatusBounded(t *testing.T) {
	setupAssetUploadTest(t)
	Conf.FileTree.Store(conf.NewFileTree())
	ocrFailures.Lock()
	previous := ocrFailures.paths
	ocrFailures.paths = map[string]time.Time{}
	ocrFailures.Unlock()
	t.Cleanup(func() {
		ocrFailures.Lock()
		ocrFailures.paths = previous
		ocrFailures.Unlock()
	})
	oldest := time.Unix(0, 0)
	for i := range ocrFailureLimit {
		path := fmt.Sprintf("assets/ocr-status-%04d.png", i)
		recordOCRFailure(path, errors.New("inference failed"))
		if !HasOCRFailure(path) {
			t.Fatalf("failure was not recorded: %s", path)
		}
		// 固定严格递增的更新时间，避免时钟精度和 map 遍历顺序影响最旧项选择。
		ocrFailures.Lock()
		ocrFailures.paths[path] = oldest.Add(time.Duration(i) * time.Second)
		ocrFailures.Unlock()
	}
	recordOCRFailure(fmt.Sprintf("assets/ocr-status-%04d.png", ocrFailureLimit), errors.New("inference failed"))
	ocrFailures.Lock()
	count := len(ocrFailures.paths)
	ocrFailures.Unlock()
	if count != ocrFailureLimit || HasOCRFailure("assets/ocr-status-0000.png") ||
		!HasOCRFailure(fmt.Sprintf("assets/ocr-status-%04d.png", ocrFailureLimit)) {
		t.Fatalf("failure cache limit: %d", count)
	}
	for i := 1; i <= ocrFailureLimit; i++ {
		if !HasOCRFailure(fmt.Sprintf("assets/ocr-status-%04d.png", i)) {
			t.Fatalf("failure cache evicted a newer entry: %d", i)
		}
	}
}
