package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
)

const readyInstallPackageDiagnosticLimit = 3

// 每次本地检查限制详细警告数量，不记录认证密钥、签名或元数据正文。
type readyInstallPackageDiagnostics struct {
	count int
}

func (d *readyInstallPackageDiagnostics) rejected(name string, err error) string {
	d.count++
	if d.count > readyInstallPackageDiagnosticLimit {
		return ""
	}
	return fmt.Sprintf("skip ready install package record [%q]: %s", name, readyInstallPackageFailureReason(err))
}

func readyInstallPackageFailureReason(err error) string {
	var syntaxError *json.SyntaxError
	var typeError *json.UnmarshalTypeError
	if errors.As(err, &syntaxError) || errors.As(err, &typeError) {
		// JSON 类型错误可能包含字段原文，诊断只记录固定分类。
		return "invalid install package metadata JSON"
	}
	var pathError *os.PathError
	if errors.As(err, &pathError) {
		return fmt.Sprintf("%s failed: %s", pathError.Op, pathError.Err)
	}
	return err.Error()
}

func (d *readyInstallPackageDiagnostics) summary() string {
	if d.count <= readyInstallPackageDiagnosticLimit {
		return ""
	}
	return fmt.Sprintf("ready install package check suppressed %d additional validation warnings",
		d.count-readyInstallPackageDiagnosticLimit)
}
