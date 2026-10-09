// 包 elevator 执行 Windows 提权工具，并等待其返回最终结果。
package elevator

import (
	"fmt"
	"os/exec"
	"strings"

	"github.com/88250/gulu"
)

func Run(executable, workingDir, arguments string) error {
	script := commandScript(executable, workingDir, arguments)
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	gulu.CmdAttr(cmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("elevated helper failed: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func commandScript(executable, workingDir, arguments string) string {
	// 参数已按 Windows 命令行语法转义，单引号字符串仅负责保留 PowerShell 中的字面值
	return "$ErrorActionPreference = 'Stop'; try { $process = Start-Process -FilePath " + quotePowerShell(executable) +
		" -WorkingDirectory " + quotePowerShell(workingDir) + " -ArgumentList " + quotePowerShell(arguments) +
		" -Verb RunAs -WindowStyle Hidden -Wait -PassThru; " +
		"if ($null -eq $process.ExitCode) { throw 'Elevated helper exit code unavailable' }; " +
		"exit $process.ExitCode } catch { Write-Error $_; exit 1 }"
}

func quotePowerShell(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
