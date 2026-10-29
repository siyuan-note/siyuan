// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package elevator

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"time"
)

const diagnosticTimeout = 2 * time.Second

// ProcessError 保留进程错误，并单独提供辅助程序返回的诊断信息。
type ProcessError struct {
	Err         error
	Diagnostics string
}

func (err *ProcessError) Error() string { return err.Err.Error() }
func (err *ProcessError) Unwrap() error { return err.Err }

type diagnosticReport struct {
	Token string `json:"token"`
	Error string `json:"error"`
}

type diagnosticReceiver struct {
	listener net.Listener
	token    string
	result   chan string
}

func newDiagnosticReceiver() (*diagnosticReceiver, error) {
	var token [32]byte
	if _, err := rand.Read(token[:]); err != nil {
		return nil, err
	}
	// 仅在本机临时接收本次调用的诊断，避免提权进程向用户指定的文件路径写入数据。
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	receiver := &diagnosticReceiver{listener: listener, token: hex.EncodeToString(token[:]), result: make(chan string, 1)}
	go receiver.receive()
	return receiver, nil
}

func (receiver *diagnosticReceiver) receive() {
	for {
		connection, err := receiver.listener.Accept()
		if err != nil {
			return
		}
		_ = connection.SetReadDeadline(time.Now().Add(diagnosticTimeout))
		var report diagnosticReport
		// 限制单条诊断大小，并拒绝不属于本次调用的消息。
		err = json.NewDecoder(io.LimitReader(connection, 256*1024)).Decode(&report)
		_ = connection.Close()
		if err != nil || subtle.ConstantTimeCompare([]byte(report.Token), []byte(receiver.token)) != 1 {
			continue
		}
		receiver.result <- report.Error
		return
	}
}

func (receiver *diagnosticReceiver) arguments() string {
	return " --report " + receiver.listener.Addr().String() + " " + receiver.token
}

func (receiver *diagnosticReceiver) read() string {
	select {
	case result := <-receiver.result:
		return result
	case <-time.After(diagnosticTimeout):
		return "helper diagnostics unavailable: no authenticated report received"
	}
}

func runWithDiagnostics(executable, workingDir, arguments string, start func(*shellExecuteInfo) error) error {
	receiver, err := newDiagnosticReceiver()
	if err != nil {
		// 诊断通道不可用时沿用原有调用，不能因日志采集失败阻止添加排除项。
		diagnostics := fmt.Sprintf("helper diagnostics unavailable: %v", err)
		if err = run(executable, workingDir, arguments, start); err != nil {
			return &ProcessError{Err: err, Diagnostics: diagnostics}
		}
		return nil
	}
	defer receiver.listener.Close()
	started := false
	err = run(executable, workingDir, arguments+receiver.arguments(), func(info *shellExecuteInfo) error {
		err := start(info)
		started = err == nil && info.process != 0
		return err
	})
	if !started {
		return err
	}
	diagnostics := receiver.read()
	if err != nil {
		return &ProcessError{Err: err, Diagnostics: diagnostics}
	}
	return nil
}
