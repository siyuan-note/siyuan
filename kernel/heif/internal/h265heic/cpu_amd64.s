//go:build amd64 && !noasm

#include "textflag.h"

// cpuidAVX2 reports whether the CPU has AVX2 and the OS saves the YMM state.
TEXT ·cpuidAVX2(SB), NOSPLIT, $0-1
	MOVL $0, AX
	CPUID
	CMPL AX, $7
	JL   no

	MOVL $1, AX
	MOVL $0, CX
	CPUID
	BTL  $27, CX // OSXSAVE
	JNC  no

	MOVL   $0, CX
	XGETBV
	ANDL   $6, AX // XMM and YMM state
	CMPL   AX, $6
	JNE    no

	MOVL $7, AX
	MOVL $0, CX
	CPUID
	BTL  $5, BX // AVX2
	JNC  no

	MOVB $1, ret+0(FP)
	RET

no:
	MOVB $0, ret+0(FP)
	RET
