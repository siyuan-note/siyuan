//go:build amd64 && !noasm

package heic

var hasAVX2 = cpuidAVX2()

func cpuidAVX2() bool
