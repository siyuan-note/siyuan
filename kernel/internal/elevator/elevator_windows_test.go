package elevator

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestElevatedProcessResult(t *testing.T) {
	for _, result := range []string{"0", "7", "cancel", "missing"} {
		t.Run(result, func(t *testing.T) {
			receipt := filepath.Join(t.TempDir(), "arguments.json")
			// 替换提权边界，验证真实 PowerShell 的参数解析和退出码，不启动 UAC 或修改系统配置
			mock := `function Start-Process {
param($FilePath, $WorkingDirectory, $ArgumentList, $Verb, $WindowStyle, [switch]$Wait, [switch]$PassThru)
if ($Verb -ne 'RunAs' -or $WindowStyle -ne 'Hidden' -or -not $Wait -or -not $PassThru) { throw 'Missing process flags' }
[IO.File]::WriteAllText(` + quotePowerShell(receipt) + `, (ConvertTo-Json -Compress -InputObject @($FilePath, $WorkingDirectory, $ArgumentList)))
`
			if result == "cancel" {
				mock += "throw (New-Object System.ComponentModel.Win32Exception 1223)\n}"
			} else if result == "missing" {
				mock += "[pscustomobject]@{ExitCode=$null}\n}"
			} else {
				mock += "[pscustomobject]@{ExitCode=" + result + "}\n}"
			}
			executable := `D:\O'Brien\SiYuan\elevator.exe`
			workingDir := `D:\Program Files\SiYuan`
			arguments := `add-defender-exclusion "D:\Program Files\SiYuan" "D:\notes\\"`
			command := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", mock+"\n"+commandScript(executable, workingDir, arguments))
			output, err := command.CombinedOutput()
			if result == "0" && err != nil || result != "0" && err == nil {
				t.Fatalf("unexpected process result: %v: %s", err, output)
			}
			if result == "7" {
				if failure, ok := err.(*exec.ExitError); !ok || failure.ExitCode() != 7 {
					t.Fatalf("helper exit code was lost: %v", err)
				}
			}
			data, readErr := os.ReadFile(receipt)
			if readErr != nil {
				t.Fatal(readErr)
			}
			var actual []string
			if err := json.Unmarshal(data, &actual); err != nil {
				t.Fatal(err)
			}
			if strings.Join(actual, "\n") != strings.Join([]string{executable, workingDir, arguments}, "\n") {
				t.Fatalf("PowerShell changed process arguments: %q", actual)
			}
		})
	}
}

func TestElevatedProcessLaunchFailure(t *testing.T) {
	// 不存在的绝对路径在请求提权前失败，用于检查调用方接收真实进程错误
	err := Run(filepath.Join(t.TempDir(), "missing.exe"), t.TempDir(), "add-defender-exclusion install workspace")
	if err == nil {
		t.Fatal("launch failure was reported as success")
	}
}
