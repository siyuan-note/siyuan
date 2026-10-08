package elevator

import (
	"strings"
	"testing"
)

func TestElevatedCommandScript(t *testing.T) {
	for value, expected := range map[string]string{
		"": "''", `D:\Program Files\SiYuan`: `'D:\Program Files\SiYuan'`,
		`D:\O'Brien\$notes`: `'D:\O''Brien\$notes'`,
	} {
		if result := quotePowerShell(value); result != expected {
			t.Fatalf("literal changed: %q, expected %q", result, expected)
		}
	}
	script := commandScript(`D:\Program Files\SiYuan\elevator.exe`, `D:\Program Files\SiYuan`, `add-defender-exclusion "D:\Program Files\SiYuan" D:\notes`)
	for _, fragment := range []string{"$ErrorActionPreference = 'Stop'", "-Verb RunAs", "-WindowStyle Hidden", "-Wait -PassThru", "exit $process.ExitCode", "$null -eq $process.ExitCode"} {
		if !strings.Contains(script, fragment) {
			t.Fatalf("missing process requirement %q: %s", fragment, script)
		}
	}
}
