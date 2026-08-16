//go:build arm64 && !noasm

#include "textflag.h"

#define FMUL(Vd, Vn, Vm)   WORD $(0x6E20DC00 | ((Vm) << 16) | ((Vn) << 5) | (Vd))
#define FADD(Vd, Vn, Vm)   WORD $(0x4E20D400 | ((Vm) << 16) | ((Vn) << 5) | (Vd))
#define FSUB(Vd, Vn, Vm)   WORD $(0x4EA0D400 | ((Vm) << 16) | ((Vn) << 5) | (Vd))
#define FDIV(Vd, Vn, Vm)   WORD $(0x6E20FC00 | ((Vm) << 16) | ((Vn) << 5) | (Vd))
#define FMAX(Vd, Vn, Vm)   WORD $(0x4E20F400 | ((Vm) << 16) | ((Vn) << 5) | (Vd))
#define FMIN(Vd, Vn, Vm)   WORD $(0x4EA0F400 | ((Vm) << 16) | ((Vn) << 5) | (Vd))
#define FCVTZS(Vd, Vn)     WORD $(0x4EA1B800 | ((Vn) << 5) | (Vd))

DATA rowSelC<>+0(SB)/8, $0x0706050407060504
DATA rowSelC<>+8(SB)/8, $0x0b0a09080b0a0908
GLOBL rowSelC<>(SB), RODATA|NOPTR, $16

DATA rowSelN<>+0(SB)/8, $0x0b0a090803020100
DATA rowSelN<>+8(SB)/8, $0x0f0e0d0c07060504
GLOBL rowSelN<>(SB), RODATA|NOPTR, $16

DATA rowSelP<>+0(SB)/8, $0x3424140430201000
DATA rowSelP<>+8(SB)/8, $0x3c2c1c0c38281808
GLOBL rowSelP<>(SB), RODATA|NOPTR, $16

#define CHROMA(P0, P1, OUT, VOUT)    \
	VLD1 (P0), [V4.S4];          \
	VTBL V16.B16, [V4.B16], V5.B16; \
	VTBL V17.B16, [V4.B16], V6.B16; \
	FMUL(OUT, 5, 20);            \
	FMUL(6, 6, 21);              \
	FADD(OUT, OUT, 6);           \
	VLD1 (P1), [V4.S4];          \
	VTBL V16.B16, [V4.B16], V5.B16; \
	VTBL V17.B16, [V4.B16], V6.B16; \
	FMUL(5, 5, 21);              \
	FADD(OUT, OUT, 5);           \
	FMUL(6, 6, 22);              \
	FADD(OUT, OUT, 6)

#define CHROMA444(P0, P1, OUT, VOUT) \
	ADD  $4, P0, R9;             \
	VLD1 (R9), [VOUT]

#define PIXEL(V)          \
	FMAX(V, V, 24);   \
	FMIN(V, V, 25);   \
	FMUL(V, V, 26);   \
	FADD(V, V, 27);   \
	FCVTZS(V, V)

#define ROW8(CH, UVSTEP) \
	MOVD dst+0(FP), R0; \
	MOVD yf+8(FP), R1; \
	MOVD u0+16(FP), R2; \
	MOVD u1+24(FP), R3; \
	MOVD v0+32(FP), R4; \
	MOVD v1+40(FP), R5; \
	MOVD a+48(FP), R6; \
	MOVD n+56(FP), R7; \
	MOVD c+64(FP), R8; \
	MOVD $rowSelC<>(SB), R9; \
	VLD1 (R9), [V16.B16]; \
	MOVD $rowSelN<>(SB), R9; \
	VLD1 (R9), [V17.B16]; \
	MOVD $rowSelP<>(SB), R9; \
	VLD1 (R9), [V18.B16]; \
	MOVW 0(R8), R9; \
	VDUP R9, V20.S4; \
	MOVW 4(R8), R9; \
	VDUP R9, V21.S4; \
	MOVW 8(R8), R9; \
	VDUP R9, V22.S4; \
	MOVW 12(R8), R9; \
	VDUP R9, V23.S4; \
	MOVW 16(R8), R9; \
	VDUP R9, V28.S4; \
	MOVW 20(R8), R9; \
	VDUP R9, V29.S4; \
	MOVW 24(R8), R9; \
	VDUP R9, V30.S4; \
	MOVW 28(R8), R9; \
	VDUP R9, V31.S4; \
	MOVW 32(R8), R9; \
	VDUP R9, V26.S4; \
	MOVW 36(R8), R9; \
	VDUP R9, V25.S4; \
	MOVW 40(R8), R9; \
	VDUP R9, V27.S4; \
	VEOR V24.B16, V24.B16, V24.B16; \
loop: \
	VLD1 (R1), [V0.S4]; \
	CH(R2, R3, 1, V1.S4); \
	CH(R4, R5, 2, V2.S4); \
	FMUL(7, 2, 23); \
	FADD(7, 0, 7); \
	FMUL(8, 1, 28); \
	FADD(8, 0, 8); \
	FMUL(9, 2, 29); \
	FMUL(10, 1, 30); \
	FADD(9, 9, 10); \
	FADD(9, 9, 9); \
	FDIV(9, 9, 31); \
	FSUB(9, 0, 9); \
	PIXEL(7); \
	PIXEL(9); \
	PIXEL(8); \
	VLD1   (R6), [V10.B8]; \
	VUSHLL $0, V10.B8, V10.H8; \
	VUSHLL $0, V10.H4, V10.S4; \
	VMOV V7.B16, V12.B16; \
	VMOV V9.B16, V13.B16; \
	VMOV V8.B16, V14.B16; \
	VMOV V10.B16, V15.B16; \
	VTBL V18.B16, [V12.B16, V13.B16, V14.B16, V15.B16], V11.B16; \
	VST1 [V11.B16], (R0); \
	ADD  $16, R1; \
	ADD  $UVSTEP, R2; \
	ADD  $UVSTEP, R3; \
	ADD  $UVSTEP, R4; \
	ADD  $UVSTEP, R5; \
	ADD  $4, R6; \
	ADD  $16, R0; \
	SUB  $4, R7; \
	CBNZ R7, loop

#define ROW16(CH, UVSTEP) \
	MOVD dst+0(FP), R0; \
	MOVD yf+8(FP), R1; \
	MOVD u0+16(FP), R2; \
	MOVD u1+24(FP), R3; \
	MOVD v0+32(FP), R4; \
	MOVD v1+40(FP), R5; \
	MOVD a+48(FP), R6; \
	MOVD n+56(FP), R7; \
	MOVD c+64(FP), R8; \
	MOVD $rowSelC<>(SB), R9; \
	VLD1 (R9), [V16.B16]; \
	MOVD $rowSelN<>(SB), R9; \
	VLD1 (R9), [V17.B16]; \
	MOVD $rowSelD<>(SB), R9; \
	VLD1 (R9), [V18.B16]; \
	MOVD $rowSelE<>(SB), R9; \
	VLD1 (R9), [V19.B16]; \
	MOVW 0(R8), R9; \
	VDUP R9, V20.S4; \
	MOVW 4(R8), R9; \
	VDUP R9, V21.S4; \
	MOVW 8(R8), R9; \
	VDUP R9, V22.S4; \
	MOVW 12(R8), R9; \
	VDUP R9, V23.S4; \
	MOVW 16(R8), R9; \
	VDUP R9, V28.S4; \
	MOVW 20(R8), R9; \
	VDUP R9, V29.S4; \
	MOVW 24(R8), R9; \
	VDUP R9, V30.S4; \
	MOVW 28(R8), R9; \
	VDUP R9, V31.S4; \
	MOVW 32(R8), R9; \
	VDUP R9, V26.S4; \
	MOVW 36(R8), R9; \
	VDUP R9, V25.S4; \
	MOVW 40(R8), R9; \
	VDUP R9, V27.S4; \
	VEOR V24.B16, V24.B16, V24.B16; \
loop16: \
	VLD1 (R1), [V0.S4]; \
	CH(R2, R3, 1, V1.S4); \
	CH(R4, R5, 2, V2.S4); \
	FMUL(7, 2, 23); \
	FADD(7, 0, 7); \
	FMUL(8, 1, 28); \
	FADD(8, 0, 8); \
	FMUL(9, 2, 29); \
	FMUL(10, 1, 30); \
	FADD(9, 9, 10); \
	FADD(9, 9, 9); \
	FDIV(9, 9, 31); \
	FSUB(9, 0, 9); \
	PIXEL(7); \
	PIXEL(9); \
	PIXEL(8); \
	VLD1   (R6), [V10.H4]; \
	VUSHLL $0, V10.H4, V10.S4; \
	VMOV V7.B16, V12.B16; \
	VMOV V9.B16, V13.B16; \
	VMOV V8.B16, V14.B16; \
	VMOV V10.B16, V15.B16; \
	VTBL V18.B16, [V12.B16, V13.B16, V14.B16, V15.B16], V11.B16; \
	VST1.P [V11.B16], 16(R0); \
	VTBL V19.B16, [V12.B16, V13.B16, V14.B16, V15.B16], V11.B16; \
	VST1.P [V11.B16], 16(R0); \
	ADD  $16, R1; \
	ADD  $UVSTEP, R2; \
	ADD  $UVSTEP, R3; \
	ADD  $UVSTEP, R4; \
	ADD  $UVSTEP, R5; \
	ADD  $8, R6; \
	SUB  $4, R7; \
	CBNZ R7, loop16

DATA rowSelD<>+0(SB)/8, $0x3031202110110001
DATA rowSelD<>+8(SB)/8, $0x3435242514150405
GLOBL rowSelD<>(SB), RODATA|NOPTR, $16

DATA rowSelE<>+0(SB)/8, $0x3839282918190809
DATA rowSelE<>+8(SB)/8, $0x3c3d2c2d1c1d0c0d
GLOBL rowSelE<>(SB), RODATA|NOPTR, $16

// func convertRow4NEON(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint8, n int, c *rowConsts)
TEXT ·convertRow4NEON(SB), NOSPLIT, $0-72
	ROW8(CHROMA, 8)
	RET

// func convertRow444NEON(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint8, n int, c *rowConsts)
TEXT ·convertRow444NEON(SB), NOSPLIT, $0-72
	ROW8(CHROMA444, 16)
	RET

// func convertRow16x4NEON(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint16, n int, c *rowConsts)
TEXT ·convertRow16x4NEON(SB), NOSPLIT, $0-72
	ROW16(CHROMA, 8)
	RET

// func convertRow16x444NEON(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint16, n int, c *rowConsts)
TEXT ·convertRow16x444NEON(SB), NOSPLIT, $0-72
	ROW16(CHROMA444, 16)
	RET

#define UCVTF(Vd, Vn)      WORD $(0x6E21D800 | ((Vn) << 5) | (Vd))
#define UMINH(Vd, Vn, Vm)  WORD $(0x6E606C00 | ((Vm) << 16) | ((Vn) << 5) | (Vd))

// func normRow8NEON(dst *float32, src *uint8, n int, bias, rng float32)
TEXT ·normRow8NEON(SB), NOSPLIT, $0-32
	MOVD dst+0(FP), R0
	MOVD src+8(FP), R1
	MOVD n+16(FP), R2
	MOVW bias+24(FP), R3
	VDUP R3, V1.S4
	MOVW rng+28(FP), R3
	VDUP R3, V2.S4

loop8:
	VLD1.P  8(R1), [V0.B8]
	VUSHLL  $0, V0.B8, V0.H8
	VUSHLL  $0, V0.H4, V3.S4
	VUSHLL2 $0, V0.H8, V4.S4
	UCVTF(3, 3)
	UCVTF(4, 4)
	FSUB(3, 3, 1)
	FSUB(4, 4, 1)
	FDIV(3, 3, 2)
	FDIV(4, 4, 2)
	VST1.P  [V3.S4, V4.S4], 32(R0)
	SUB     $8, R2
	CBNZ    R2, loop8

	RET
