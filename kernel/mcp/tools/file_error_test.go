package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFileSafeErrorPreservesStructuredCodes(t *testing.T) {
	for _, code := range []string{util.TextFileRevisionConflict, util.TextFileInvalidPath,
		util.TextFileUnsupportedEncoding, util.TextFileTooLarge, util.TextFileBackupFailed, util.TextFileResultUnknown} {
		t.Run(code, func(t *testing.T) {
			failure := util.NewTextFileError(code, errors.New("operation failed"))
			failure.Written = true
			result, err := fileSafeError(fmt.Errorf("outer: %w", failure))
			var data util.TextFileError
			if err != nil || !result.IsError || json.Unmarshal([]byte(result.Content[0].Text), &data) != nil ||
				data.Code != code || data.Message != failure.Message || !data.Written ||
				result.ExecutionUnknown != (code == util.TextFileResultUnknown) {
				t.Fatalf("结构化文件错误丢失：%+v，%v", result, err)
			}
		})
	}
}

func TestFileSafeErrorClassifiesCausesWithoutParsingMessages(t *testing.T) {
	for _, tc := range []struct {
		err  error
		code string
	}{
		{errors.New("result_unknown-draft.md: permission denied"), "write_failed"},
		{errors.New("result_unknown: ordinary error text"), "write_failed"},
		{fmt.Errorf("cancelled read: %w", context.Canceled), "cancelled"},
		{fmt.Errorf("timed out: %w", context.DeadlineExceeded), "cancelled"},
		{fmt.Errorf("missing result_unknown-draft.md: %w", os.ErrNotExist), "invalid_path"},
	} {
		result, err := fileSafeError(tc.err)
		var data util.TextFileError
		if err != nil || json.Unmarshal([]byte(result.Content[0].Text), &data) != nil || data.Code != tc.code || result.ExecutionUnknown {
			t.Fatalf("普通文件错误分类错误：%+v，%v", result, err)
		}
	}
}

func TestBazaarProjectErrorUsesStructuredExecutionState(t *testing.T) {
	for _, tc := range []struct {
		err     error
		unknown bool
	}{
		{errors.New("result_unknown-draft.md: permission denied"), false},
		{util.NewTextFileError(util.TextFileInvalidPath, errors.New("result_unknown-draft.md")), false},
		{fmt.Errorf("outer: %w", util.NewTextFileError(util.TextFileResultUnknown, errors.New("partial replacement"))), true},
	} {
		for _, partial := range []any{nil, map[string]any{"revision": "observed"}} {
			result, err := bazaarProjectError(tc.err, partial)
			if err != nil || !result.IsError || result.ExecutionUnknown != tc.unknown {
				t.Fatalf("项目执行状态错误：%+v，%v", result, err)
			}
			if partial != nil || tc.unknown {
				var payload struct {
					ResultUnknown bool `json:"resultUnknown"`
				}
				if err = json.Unmarshal([]byte(result.Content[0].Text), &payload); err != nil || payload.ResultUnknown != tc.unknown {
					t.Fatalf("项目响应状态错误：%+v，%v", result, err)
				}
			}
		}
	}
}
