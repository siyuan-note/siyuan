// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"
)

func TestTextFileErrorPreservesCodeAndCause(t *testing.T) {
	cause := errors.New("source unavailable")
	for _, code := range []string{TextFileRevisionConflict, TextFileInvalidPath, TextFileUnsupportedEncoding,
		TextFileTooLarge, TextFileBackupFailed, TextFileResultUnknown} {
		t.Run(code, func(t *testing.T) {
			failure := NewTextFileError(code, cause)
			failure.Written = true
			wrapped := fmt.Errorf("project operation: %w", failure)
			if !IsTextFileError(wrapped, code) || !errors.Is(wrapped, cause) {
				t.Fatalf("错误码或原因丢失：%v", wrapped)
			}
			if got := textFileBeforeCommitError(wrapped); got != failure {
				t.Fatalf("备份错误未保留结构化状态：%#v", got)
			}
			data, err := json.Marshal(failure)
			want := fmt.Sprintf(`{"code":%q,"message":"source unavailable","written":true}`, code)
			if err != nil || string(data) != want {
				t.Fatalf("错误响应改变：%s，%v", data, err)
			}
		})
	}
}

func TestTextFileErrorIgnoresCodesInMessages(t *testing.T) {
	for _, message := range []string{"result_unknown-draft.md: permission denied", "result_unknown: plain diagnostic"} {
		err := errors.New(message)
		if IsTextFileError(err, TextFileResultUnknown) {
			t.Fatalf("错误文本被解释为结果码：%v", err)
		}
		failure := textFileBeforeCommitError(err)
		if !IsTextFileError(failure, TextFileBackupFailed) || !errors.Is(failure, err) {
			t.Fatalf("未保留备份失败阶段和原因：%v", failure)
		}
	}
	err := ValidatePluginProjectFile("../result_unknown-draft.md")
	if !IsTextFileError(err, TextFileInvalidPath) {
		t.Fatalf("项目路径校验未提供结构化错误：%v", err)
	}
}
