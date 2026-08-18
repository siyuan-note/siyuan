//go:build arm64 && !noasm

package heic

//go:noescape
func convertRow4NEON(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint8, n int, c *rowConsts)

//go:noescape
func convertRow444NEON(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint8, n int, c *rowConsts)

func rowFn(ssHor int) convertRow {
	if ssHor == 0 {
		return convertRow444NEONRow
	}

	return convertRowNEON
}

func convertRow444NEONRow(dst []uint8, yf, u0, u1, v0, v1 []float32, a []uint8,
	n int, c *rowConsts,
) {
	if n4 := n &^ 3; n4 > 0 {
		convertRow444NEON(&dst[0], &yf[0], &u0[0], &u1[0], &v0[0], &v1[0], &a[0], n4, c)
		if n4 == n {
			return
		}
		dst, yf, a, n = dst[4*n4:], yf[n4:], a[n4:], n-n4
		u0, u1, v0, v1 = u0[n4:], u1[n4:], v0[n4:], v1[n4:]
	}

	convertRow444Go(dst, yf, u0, u1, v0, v1, a, n, c)
}

func convertRowNEON(dst []uint8, yf, u0, u1, v0, v1 []float32, a []uint8,
	n int, c *rowConsts,
) {
	if n4 := n &^ 3; n4 > 0 {
		convertRow4NEON(&dst[0], &yf[0], &u0[0], &u1[0], &v0[0], &v1[0], &a[0], n4, c)
		if n4 == n {
			return
		}
		dst, yf, a, n = dst[4*n4:], yf[n4:], a[n4:], n-n4
		u0, u1 = u0[n4/2:], u1[n4/2:]
		v0, v1 = v0[n4/2:], v1[n4/2:]
	}

	convertRowGo(dst, yf, u0, u1, v0, v1, a, n, c)
}

//go:noescape
func convertRow16x4NEON(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint16, n int, c *rowConsts)

//go:noescape
func convertRow16x444NEON(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint16, n int, c *rowConsts)

func rowFn16(ssHor int) convertRow16 {
	if ssHor == 0 {
		return convertRow16x444NEONRow
	}

	return convertRow16NEON
}

func convertRow16x444NEONRow(dst []uint8, yf, u0, u1, v0, v1 []float32, a []uint16,
	n int, c *rowConsts,
) {
	if n4 := n &^ 3; n4 > 0 {
		convertRow16x444NEON(&dst[0], &yf[0], &u0[0], &u1[0], &v0[0], &v1[0], &a[0], n4, c)
		if n4 == n {
			return
		}
		dst, yf, a, n = dst[8*n4:], yf[n4:], a[n4:], n-n4
		u0, u1, v0, v1 = u0[n4:], u1[n4:], v0[n4:], v1[n4:]
	}

	convertRow16x444Go(dst, yf, u0, u1, v0, v1, a, n, c)
}

func convertRow16NEON(dst []uint8, yf, u0, u1, v0, v1 []float32, a []uint16,
	n int, c *rowConsts,
) {
	if n4 := n &^ 3; n4 > 0 {
		convertRow16x4NEON(&dst[0], &yf[0], &u0[0], &u1[0], &v0[0], &v1[0], &a[0], n4, c)
		if n4 == n {
			return
		}
		dst, yf, a, n = dst[8*n4:], yf[n4:], a[n4:], n-n4
		u0, u1 = u0[n4/2:], u1[n4/2:]
		v0, v1 = v0[n4/2:], v1[n4/2:]
	}

	convertRow16Go(dst, yf, u0, u1, v0, v1, a, n, c)
}

//go:noescape
func normRow8NEON(dst *float32, src *uint8, n int, bias, rng float32)

func normRow(dst []float32, src []uint8, bias, rng float32) {
	if n8 := len(dst) &^ 7; n8 > 0 {
		normRow8NEON(&dst[0], &src[0], n8, bias, rng)
		if n8 == len(dst) {
			return
		}
		dst, src = dst[n8:], src[n8:]
	}

	normRowGo(dst, src, bias, rng)
}

func normRow16(dst []float32, src []uint16, maxCh uint16, bias, rng float32) {
	normRow16Go(dst, src, maxCh, bias, rng)
}
