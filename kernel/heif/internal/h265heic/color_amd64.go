//go:build amd64 && !noasm

package heic

//go:noescape
func convertRow8AVX2(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint8, n int, c *rowConsts)

//go:noescape
func convertRow444AVX2(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint8, n int, c *rowConsts)

func rowFn(ssHor int) convertRow {
	if ssHor == 0 {
		if !hasAVX2 {
			return convertRow444Go
		}

		return convertRow444AVX2Row
	}
	if !hasAVX2 {
		return convertRowGo
	}

	return convertRowAVX2
}

func convertRow444AVX2Row(dst []uint8, yf, u0, u1, v0, v1 []float32, a []uint8,
	n int, c *rowConsts,
) {
	if n8 := n &^ 7; n8 > 0 {
		convertRow444AVX2(&dst[0], &yf[0], &u0[0], &u1[0], &v0[0], &v1[0], &a[0], n8, c)
		if n8 == n {
			return
		}
		dst, yf, a, n = dst[4*n8:], yf[n8:], a[n8:], n-n8
		u0, u1, v0, v1 = u0[n8:], u1[n8:], v0[n8:], v1[n8:]
	}

	convertRow444Go(dst, yf, u0, u1, v0, v1, a, n, c)
}

func convertRowAVX2(dst []uint8, yf, u0, u1, v0, v1 []float32, a []uint8,
	n int, c *rowConsts,
) {
	if n8 := n &^ 7; n8 > 0 {
		convertRow8AVX2(&dst[0], &yf[0], &u0[0], &u1[0], &v0[0], &v1[0], &a[0], n8, c)
		if n8 == n {
			return
		}
		dst, yf, a, n = dst[4*n8:], yf[n8:], a[n8:], n-n8
		u0, u1 = u0[n8/2:], u1[n8/2:]
		v0, v1 = v0[n8/2:], v1[n8/2:]
	}

	convertRowGo(dst, yf, u0, u1, v0, v1, a, n, c)
}

//go:noescape
func convertRow16x8AVX2(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint16, n int, c *rowConsts)

//go:noescape
func convertRow16x444AVX2(dst *uint8, yf, u0, u1, v0, v1 *float32, a *uint16, n int, c *rowConsts)

func rowFn16(ssHor int) convertRow16 {
	if ssHor == 0 {
		if !hasAVX2 {
			return convertRow16x444Go
		}

		return convertRow16x444AVX2Row
	}
	if !hasAVX2 {
		return convertRow16Go
	}

	return convertRow16AVX2
}

func convertRow16x444AVX2Row(dst []uint8, yf, u0, u1, v0, v1 []float32, a []uint16,
	n int, c *rowConsts,
) {
	if n8 := n &^ 7; n8 > 0 {
		convertRow16x444AVX2(&dst[0], &yf[0], &u0[0], &u1[0], &v0[0], &v1[0], &a[0], n8, c)
		if n8 == n {
			return
		}
		dst, yf, a, n = dst[8*n8:], yf[n8:], a[n8:], n-n8
		u0, u1, v0, v1 = u0[n8:], u1[n8:], v0[n8:], v1[n8:]
	}

	convertRow16x444Go(dst, yf, u0, u1, v0, v1, a, n, c)
}

func convertRow16AVX2(dst []uint8, yf, u0, u1, v0, v1 []float32, a []uint16,
	n int, c *rowConsts,
) {
	if n8 := n &^ 7; n8 > 0 {
		convertRow16x8AVX2(&dst[0], &yf[0], &u0[0], &u1[0], &v0[0], &v1[0], &a[0], n8, c)
		if n8 == n {
			return
		}
		dst, yf, a, n = dst[8*n8:], yf[n8:], a[n8:], n-n8
		u0, u1 = u0[n8/2:], u1[n8/2:]
		v0, v1 = v0[n8/2:], v1[n8/2:]
	}

	convertRow16Go(dst, yf, u0, u1, v0, v1, a, n, c)
}

//go:noescape
func normRow8AVX2(dst *float32, src *uint8, n int, bias, rng float32)

func normRow(dst []float32, src []uint8, bias, rng float32) {
	if n8 := len(dst) &^ 7; hasAVX2 && n8 > 0 {
		normRow8AVX2(&dst[0], &src[0], n8, bias, rng)
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
