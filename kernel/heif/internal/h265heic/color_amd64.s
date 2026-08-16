//go:build amd64 && !noasm

#include "textflag.h"

DATA rowPermC<>+0(SB)/8, $0x0000000100000001
DATA rowPermC<>+8(SB)/8, $0x0000000200000002
DATA rowPermC<>+16(SB)/8, $0x0000000300000003
DATA rowPermC<>+24(SB)/8, $0x0000000400000004
GLOBL rowPermC<>(SB), RODATA|NOPTR, $32

DATA rowPermN<>+0(SB)/8, $0x0000000200000000
DATA rowPermN<>+8(SB)/8, $0x0000000300000001
DATA rowPermN<>+16(SB)/8, $0x0000000400000002
DATA rowPermN<>+24(SB)/8, $0x0000000500000003
GLOBL rowPermN<>(SB), RODATA|NOPTR, $32

DATA rowShuf<>+0(SB)/8, $0x0d0905010c080400
DATA rowShuf<>+8(SB)/8, $0x0f0b07030e0a0602
GLOBL rowShuf<>(SB), RODATA|NOPTR, $16

#define CHROMA(P0, P1, OUT)          \
	VMOVUPS  (P0), Y3;           \
	VPERMPS  Y3, Y13, Y4;        \
	VPERMPS  Y3, Y14, Y5;        \
	VMULPS   Y8, Y4, OUT;        \
	VMULPS   Y9, Y5, Y5;         \
	VADDPS   Y5, OUT, OUT;       \
	VMOVUPS  (P1), Y3;           \
	VPERMPS  Y3, Y13, Y4;        \
	VPERMPS  Y3, Y14, Y5;        \
	VMULPS   Y9, Y4, Y4;         \
	VADDPS   Y4, OUT, OUT;       \
	VMULPS   Y10, Y5, Y5;        \
	VADDPS   Y5, OUT, OUT

#define CHROMA444(P0, P1, OUT) \
	VMOVUPS 4(P0), OUT

#define PIXEL(V)                     \
	VMAXPS Y1, V, V;             \
	VMINPS Y2, V, V;             \
	VMULPS Y6, V, V;             \
	VADDPS Y7, V, V;             \
	VCVTTPS2DQ V, V

DATA rowSwap<>+0(SB)/8, $0x0607040502030001
DATA rowSwap<>+8(SB)/8, $0x0e0f0c0d0a0b0809
GLOBL rowSwap<>(SB), RODATA|NOPTR, $16

#define ROW8(CH, UVSTEP) \
	MOVQ dst+0(FP), DI; \
	MOVQ yf+8(FP), SI; \
	MOVQ u0+16(FP), R8; \
	MOVQ u1+24(FP), R9; \
	MOVQ v0+32(FP), R10; \
	MOVQ v1+40(FP), R11; \
	MOVQ a+48(FP), R12; \
	MOVQ n+56(FP), DX; \
	MOVQ c+64(FP), CX; \
	VBROADCASTSS   0(CX), Y8; \
	VBROADCASTSS   4(CX), Y9; \
	VBROADCASTSS   8(CX), Y10; \
	VBROADCASTSS   12(CX), Y11; \
	VBROADCASTSS   16(CX), Y12; \
	VMOVDQU        rowPermC<>(SB), Y13; \
	VMOVDQU        rowPermN<>(SB), Y14; \
	VBROADCASTI128 rowShuf<>(SB), Y15; \
loop:; \
	VMOVUPS (SI), Y0; \
	CH(R8, R9, Y1); \
	CH(R10, R11, Y2); \
	VMULPS Y11, Y2, Y3; \
	VADDPS Y3, Y0, Y3; \
	VMULPS Y12, Y1, Y4; \
	VADDPS Y4, Y0, Y4; \
	VBROADCASTSS 20(CX), Y5; \
	VMULPS       Y5, Y2, Y5; \
	VBROADCASTSS 24(CX), Y6; \
	VMULPS       Y6, Y1, Y6; \
	VADDPS       Y6, Y5, Y5; \
	VADDPS       Y5, Y5, Y5; \
	VBROADCASTSS 28(CX), Y6; \
	VDIVPS       Y6, Y5, Y5; \
	VSUBPS       Y5, Y0, Y5; \
	VPXOR        Y1, Y1, Y1; \
	VBROADCASTSS 36(CX), Y2; \
	VBROADCASTSS 32(CX), Y6; \
	VBROADCASTSS 40(CX), Y7; \
	PIXEL(Y3); \
	PIXEL(Y5); \
	PIXEL(Y4); \
	VPMOVZXBD (R12), Y1; \
	VPACKUSDW Y5, Y3, Y3; \
	VPACKUSDW Y1, Y4, Y4; \
	VPACKUSWB Y4, Y3, Y3; \
	VPSHUFB   Y15, Y3, Y3; \
	VMOVDQU   Y3, (DI); \
	ADDQ $32, SI; \
	ADDQ $UVSTEP, R8; \
	ADDQ $UVSTEP, R9; \
	ADDQ $UVSTEP, R10; \
	ADDQ $UVSTEP, R11; \
	ADDQ $8, R12; \
	ADDQ $32, DI; \
	SUBQ $8, DX; \
	JNZ  loop; \
	VZEROUPPER

#define ROW16(CH, UVSTEP) \
	MOVQ dst+0(FP), DI; \
	MOVQ yf+8(FP), SI; \
	MOVQ u0+16(FP), R8; \
	MOVQ u1+24(FP), R9; \
	MOVQ v0+32(FP), R10; \
	MOVQ v1+40(FP), R11; \
	MOVQ a+48(FP), R12; \
	MOVQ n+56(FP), DX; \
	MOVQ c+64(FP), CX; \
	VBROADCASTSS   0(CX), Y8; \
	VBROADCASTSS   4(CX), Y9; \
	VBROADCASTSS   8(CX), Y10; \
	VBROADCASTSS   12(CX), Y11; \
	VBROADCASTSS   16(CX), Y12; \
	VMOVDQU        rowPermC<>(SB), Y13; \
	VMOVDQU        rowPermN<>(SB), Y14; \
	VBROADCASTI128 rowSwap<>(SB), Y15; \
loop16:; \
	VMOVUPS (SI), Y0; \
	CH(R8, R9, Y1); \
	CH(R10, R11, Y2); \
	VMULPS Y11, Y2, Y3; \
	VADDPS Y3, Y0, Y3; \
	VMULPS Y12, Y1, Y4; \
	VADDPS Y4, Y0, Y4; \
	VBROADCASTSS 20(CX), Y5; \
	VMULPS       Y5, Y2, Y5; \
	VBROADCASTSS 24(CX), Y6; \
	VMULPS       Y6, Y1, Y6; \
	VADDPS       Y6, Y5, Y5; \
	VADDPS       Y5, Y5, Y5; \
	VBROADCASTSS 28(CX), Y6; \
	VDIVPS       Y6, Y5, Y5; \
	VSUBPS       Y5, Y0, Y5; \
	VPXOR        Y1, Y1, Y1; \
	VBROADCASTSS 36(CX), Y2; \
	VBROADCASTSS 32(CX), Y6; \
	VBROADCASTSS 40(CX), Y7; \
	PIXEL(Y3); \
	PIXEL(Y5); \
	PIXEL(Y4); \
	VPMOVZXWD (R12), Y1; \
	VPACKUSDW  Y5, Y3, Y3; \
	VPACKUSDW  Y1, Y4, Y4; \
	VPUNPCKLWD Y4, Y3, Y0; \
	VPUNPCKHWD Y4, Y3, Y2; \
	VPUNPCKLWD Y2, Y0, Y5; \
	VPUNPCKHWD Y2, Y0, Y6; \
	VPERM2I128 $0x20, Y6, Y5, Y7; \
	VPERM2I128 $0x31, Y6, Y5, Y1; \
	VPSHUFB    Y15, Y7, Y7; \
	VPSHUFB    Y15, Y1, Y1; \
	VMOVDQU    Y7, (DI); \
	VMOVDQU    Y1, 32(DI); \
	ADDQ $32, SI; \
	ADDQ $UVSTEP, R8; \
	ADDQ $UVSTEP, R9; \
	ADDQ $UVSTEP, R10; \
	ADDQ $UVSTEP, R11; \
	ADDQ $16, R12; \
	ADDQ $64, DI; \
	SUBQ $8, DX; \
	JNZ  loop16; \
	VZEROUPPER

// func convertRow8AVX2(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint8, n int, c *rowConsts)
TEXT ·convertRow8AVX2(SB), NOSPLIT, $0-72
	ROW8(CHROMA, 16)
	RET

// func convertRow444AVX2(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint8, n int, c *rowConsts)
TEXT ·convertRow444AVX2(SB), NOSPLIT, $0-72
	ROW8(CHROMA444, 32)
	RET

// func convertRow16x8AVX2(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint16, n int, c *rowConsts)
TEXT ·convertRow16x8AVX2(SB), NOSPLIT, $0-72
	ROW16(CHROMA, 16)
	RET

// func convertRow16x444AVX2(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint16, n int, c *rowConsts)
TEXT ·convertRow16x444AVX2(SB), NOSPLIT, $0-72
	ROW16(CHROMA444, 32)
	RET

// func normRow8AVX2(dst *float32, src *uint8, n int, bias, rng float32)
TEXT ·normRow8AVX2(SB), NOSPLIT, $0-32
	MOVQ         dst+0(FP), DI
	MOVQ         src+8(FP), SI
	MOVQ         n+16(FP), DX
	VBROADCASTSS bias+24(FP), Y1
	VBROADCASTSS rng+28(FP), Y2

loop8:
	VPMOVZXBD (SI), Y0
	VCVTDQ2PS Y0, Y0
	VSUBPS    Y1, Y0, Y0
	VDIVPS    Y2, Y0, Y0
	VMOVUPS   Y0, (DI)
	ADDQ      $8, SI
	ADDQ      $32, DI
	SUBQ      $8, DX
	JNZ       loop8
	VZEROUPPER
	RET
