package ocr

import (
	"errors"
	"image"
	"image/color"
	"math"
	"sort"

	"github.com/disintegration/imaging"
)

type point struct{ x, y float64 }
type textBox [4]point

func (b textBox) bounds() (left, top, right, bottom float64) {
	left, top, right, bottom = b[0].x, b[0].y, b[0].x, b[0].y
	for _, p := range b[1:] {
		left = math.Min(left, p.x)
		top = math.Min(top, p.y)
		right = math.Max(right, p.x)
		bottom = math.Max(bottom, p.y)
	}
	return
}

func detectBoxes(result tensor, width, height int, config modelConfig) ([]textBox, error) {
	if len(result.shape) != 4 || result.shape[0] != 1 || result.shape[1] != 1 || result.shape[2] <= 0 || result.shape[3] <= 0 || result.shape[2]*result.shape[3] != int64(len(result.data)) {
		return nil, errors.New("unsupported OCR detector output shape")
	}
	w, h := int(result.shape[3]), int(result.shape[2])
	visited := make([]bool, w*h)
	var boxes []textBox
	for start, value := range result.data {
		if visited[start] || float64(value) <= config.PostProcess.Threshold {
			continue
		}
		visited[start] = true
		queue := []int{start}
		var boundary []point
		score := float64(0)
		for index := 0; index < len(queue); index++ {
			at := queue[index]
			x, y := at%w, at/w
			score += float64(result.data[at])
			edge := false
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					nx, ny := x+dx, y+dy
					if nx < 0 || nx >= w || ny < 0 || ny >= h {
						edge = true
						continue
					}
					next := ny*w + nx
					if float64(result.data[next]) <= config.PostProcess.Threshold {
						edge = true
						continue
					}
					if !visited[next] {
						visited[next] = true
						queue = append(queue, next)
					}
				}
			}
			if edge {
				boundary = append(boundary, point{float64(x), float64(y)})
			}
		}
		if len(boundary) < 4 || score/float64(len(queue)) < config.PostProcess.BoxThreshold {
			continue
		}
		hull := convexHull(boundary)
		box, bw, bh := minimumBox(hull)
		if math.Min(bw, bh) < 3 {
			continue
		}
		area, perimeter := float64(0), float64(0)
		for i, p := range hull {
			q := hull[(i+1)%len(hull)]
			area += p.x*q.y - q.x*p.y
			perimeter += math.Hypot(q.x-p.x, q.y-p.y)
		}
		if perimeter <= 0 {
			continue
		}
		distance := math.Abs(area) / 2 * config.PostProcess.Unclip / perimeter
		u := point{(box[1].x - box[0].x) / bw, (box[1].y - box[0].y) / bw}
		v := point{(box[3].x - box[0].x) / bh, (box[3].y - box[0].y) / bh}
		for i := range box {
			du, dv := -distance, -distance
			if i == 1 || i == 2 {
				du = distance
			}
			if i >= 2 {
				dv = distance
			}
			box[i].x = (box[i].x + du*u.x + dv*v.x) * float64(width) / float64(w)
			box[i].y = (box[i].y + du*u.y + dv*v.y) * float64(height) / float64(h)
		}
		boxes = append(boxes, box)
		if len(boxes) >= 3000 {
			break
		}
	}
	// 先按纵坐标排序，再将同一行按横坐标排列，避免比较器的不传递关系。
	sort.Slice(boxes, func(i, j int) bool { _, a, _, _ := boxes[i].bounds(); _, b, _, _ := boxes[j].bounds(); return a < b })
	for start := 0; start < len(boxes); {
		_, top, _, bottom := boxes[start].bounds()
		end := start + 1
		for end < len(boxes) {
			_, next, _, _ := boxes[end].bounds()
			if next-top > math.Max(10, (bottom-top)/2) {
				break
			}
			end++
		}
		sort.Slice(boxes[start:end], func(i, j int) bool {
			a, _, _, _ := boxes[start+i].bounds()
			b, _, _, _ := boxes[start+j].bounds()
			return a < b
		})
		start = end
	}
	return boxes, nil
}

func convexHull(points []point) []point {
	sort.Slice(points, func(i, j int) bool {
		if points[i].x == points[j].x {
			return points[i].y < points[j].y
		}
		return points[i].x < points[j].x
	})
	cross := func(a, b, c point) float64 { return (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x) }
	hull := make([]point, 0, len(points)*2)
	for _, p := range points {
		for len(hull) >= 2 && cross(hull[len(hull)-2], hull[len(hull)-1], p) <= 0 {
			hull = hull[:len(hull)-1]
		}
		hull = append(hull, p)
	}
	lower := len(hull)
	for i := len(points) - 2; i >= 0; i-- {
		for len(hull) > lower && cross(hull[len(hull)-2], hull[len(hull)-1], points[i]) <= 0 {
			hull = hull[:len(hull)-1]
		}
		hull = append(hull, points[i])
	}
	return hull[:len(hull)-1]
}

func minimumBox(hull []point) (textBox, float64, float64) {
	best := math.Inf(1)
	var result textBox
	var width, height float64
	for i, p := range hull {
		q := hull[(i+1)%len(hull)]
		angle := math.Atan2(q.y-p.y, q.x-p.x)
		// 保持第一条边尽量水平，使裁剪后的文字方向稳定。
		for angle > math.Pi/4 {
			angle -= math.Pi / 2
		}
		for angle < -math.Pi/4 {
			angle += math.Pi / 2
		}
		c, s := math.Cos(angle), math.Sin(angle)
		left, top, right, bottom := math.Inf(1), math.Inf(1), math.Inf(-1), math.Inf(-1)
		for _, v := range hull {
			x, y := v.x*c+v.y*s, -v.x*s+v.y*c
			left = math.Min(left, x)
			right = math.Max(right, x)
			top = math.Min(top, y)
			bottom = math.Max(bottom, y)
		}
		area := (right - left) * (bottom - top)
		if area >= best {
			continue
		}
		best = area
		width, height = right-left, bottom-top
		for j, v := range [4]point{{left, top}, {right, top}, {right, bottom}, {left, bottom}} {
			result[j] = point{v.x*c - v.y*s, v.x*s + v.y*c}
		}
	}
	return result, width, height
}

func cropBox(img image.Image, box textBox) image.Image {
	w := min(8192, max(1, int(math.Round(math.Hypot(box[1].x-box[0].x, box[1].y-box[0].y)))))
	h := min(8192, max(1, int(math.Round(math.Hypot(box[3].x-box[0].x, box[3].y-box[0].y)))))
	// 先缩放到识别高度，避免为大型倾斜文本框分配额外的原始分辨率图像。
	scale := math.Min(1, 48/float64(min(w, h)))
	w, h = max(1, int(float64(w)*scale)), max(1, int(float64(h)*scale))
	source, ok := img.(*image.NRGBA)
	if !ok {
		source = imaging.Clone(img)
	}
	result := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			u, v := (float64(x)+.5)/float64(w), (float64(y)+.5)/float64(h)
			sx, sy := box[0].x+u*(box[1].x-box[0].x)+v*(box[3].x-box[0].x), box[0].y+u*(box[1].y-box[0].y)+v*(box[3].y-box[0].y)
			ix, iy := int(math.Floor(sx)), int(math.Floor(sy))
			fx, fy := sx-float64(ix), sy-float64(iy)
			var channels [4]float64
			for dy := 0; dy < 2; dy++ {
				for dx := 0; dx < 2; dx++ {
					weight := ((1-fx)*float64(1-dx) + fx*float64(dx)) * ((1-fy)*float64(1-dy) + fy*float64(dy))
					pixel := source.NRGBAAt(max(0, min(source.Bounds().Dx()-1, ix+dx)), max(0, min(source.Bounds().Dy()-1, iy+dy)))
					for c, value := range [4]uint8{pixel.R, pixel.G, pixel.B, pixel.A} {
						channels[c] += float64(value) * weight
					}
				}
			}
			result.SetNRGBA(x, y, color.NRGBA{uint8(channels[0]), uint8(channels[1]), uint8(channels[2]), uint8(channels[3])})
		}
	}
	if h >= w*3/2 {
		return imaging.Rotate90(result)
	}
	return result
}
