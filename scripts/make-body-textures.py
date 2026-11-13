"""人体図（scripts/source/body-diagram.jpg）から、BodyModel（3D）用のデータを作る。
出力（src/assets/）:
  body-front.png / body-back.png : R=筋肉の形（なめらか）、G=部位ID（regions.ts の REGIONS の順番+1、0=部位なし）
  body-depth.png                 : R=正面の厚み、G=背面の厚み、B=体の内側（シルエット）。解像度は上の半分
  body-meta.json                 : 厚みの最大値・頭の位置など
体のシルエットから厚みを膨らませて3Dの体を作り、筋肉の模様を貼る。
使い方: python scripts/make-body-textures.py
※ 連結成分の番号は写真が同じなら毎回同じ。写真を差し替えたら番号を取り直すこと。
"""
import json
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ORDER = ['chest','shoulders','traps','lats','lowback','biceps','triceps','forearms','abs','obliques','glutes','quads','hamstrings','calves']
ID = {n: i + 1 for i, n in enumerate(ORDER)}

BACK = {1452:'traps',1442:'traps',1868:'traps',1871:'traps',1856:'shoulders',1858:'shoulders',
        1873:'triceps',1875:'triceps',1872:'lats',1877:'lats',1882:'lowback',1885:'forearms',1886:'forearms',
        1891:'glutes',1892:'glutes',1899:'hamstrings',1900:'hamstrings',
        1901:'calves',1902:'calves',1903:'calves',1904:'calves'}
FRONT = {1847:'traps',1850:'traps',1863:'shoulders',1862:'shoulders',1866:'chest',1864:'chest',
         1876:'biceps',1874:'biceps',1889:'forearms',1888:'forearms',1879:'obliques',1880:'obliques',
         1881:'abs',1878:'abs',1884:'abs',1883:'abs',1890:'abs',1887:'abs',1894:'abs',1893:'abs',
         1896:'quads',1895:'quads',1905:'calves',1906:'calves'}
NEUTRAL = [1897, 1898]  # 内転筋：部位なし（常に白）
OUTLINE_BACK, OUTLINE_FRONT = 730, 880

H = 1060            # 図の高さ（基準解像度）
W, CH = 520, 1100   # キャンバス
SS = 2              # 出力テクスチャは基準の2倍の解像度
A_DEPTH = 4.0       # 厚みの強さ（シルエットの内側への距離の平方根にかける）
RELIEF = 2.2        # 筋肉の盛り上がり（深度グリッドのpx）
DEPTH_MAX = 80.0    # 厚みのPNG化の最大値（グリッドpx）

im = Image.open('scripts/source/body-diagram.jpg').convert('RGB')
a = np.asarray(im).astype(int)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
mask = (a.min(axis=2) > 120) | ((r > 150) & (r - g > 60))
mask = ndi.binary_opening(mask, iterations=1)
lab, n = ndi.label(mask)

def crop_view(parts, outline, width_override=None, flip=False):
    """写真から1つの図を切り出し、基準サイズ(キャンバス W x CH)に並べる。戻り値: 筋肉の形(0..1)、部位ID、輪郭の内側(bool)"""
    keep_ids = list(parts) + NEUTRAL
    ys, xs = np.where(lab == outline)
    x0, x1, y0, y1 = xs.min() - 8, xs.max() + 8, ys.min() - 8, ys.max() + 8
    # 部位ID：各成分を3px広げて縁まで含める
    dist, (iy, ix) = ndi.distance_transform_edt(~np.isin(lab, keep_ids), return_indices=True)
    near = lab[iy, ix]
    zone = (dist <= 3) & np.isin(near, keep_ids)
    reg = np.zeros(lab.shape, np.uint8)
    for k, name in parts.items():
        reg[zone & (near == k)] = ID[name]
    # 筋肉の形：写真のギザギザを軽くぼかして整える
    fill = np.isin(lab, keep_ids).astype(float)
    # 輪郭の内側（頭・体の中身を塗りつぶした領域）
    ring = ndi.binary_dilation(lab == outline, iterations=3)
    body = ndi.binary_fill_holes(ring)
    sl = (slice(y0, y1), slice(x0, x1))
    fill, reg, body = fill[sl], reg[sl], body[sl]
    s = H / fill.shape[0]
    w = width_override or round(fill.shape[1] * s)
    def rs(arr, mode):
        return np.asarray(Image.fromarray((arr * 255).astype('uint8') if arr.dtype != np.uint8 else arr).resize((w, H), mode))
    fill_r = rs(ndi.gaussian_filter(fill, 1.2), Image.BICUBIC) / 255.0
    reg_r = rs(reg, Image.NEAREST)
    body_r = rs(body.astype(float), Image.BILINEAR) > 127
    out = []
    ox, oy = (W - w) // 2, (CH - H) // 2
    for arr, dt in ((fill_r, float), (reg_r, np.uint8), (body_r, bool)):
        c = np.zeros((CH, W), dt)
        c[oy:oy + H, ox:ox + w] = arr
        out.append(c[:, ::-1] if flip else c)
    return out, w

def straighten(arrs):
    """写真の傾きを取る：行ごとの体の中心をなめらかにつないで、全部の行を中央にそろえる（手の振りなど細かい形は残す）"""
    fill, reg, body = arrs
    rows = np.where(body.any(axis=1))[0]
    cx = np.full(CH, np.nan)
    for y in rows:
        xs = np.where(body[y])[0]
        cx[y] = (xs.min() + xs.max()) / 2
    # 腕の振りなどの影響を避けるため、広い範囲でなめらかにする
    idx = np.arange(CH)
    ok = ~np.isnan(cx)
    cx = np.interp(idx, idx[ok], cx[ok])
    cx = ndi.gaussian_filter1d(cx, 45, mode='nearest')
    out = [np.zeros_like(x) for x in arrs]
    for y in rows:
        sh = int(round(W / 2 - cx[y]))
        for o, x in zip(out, arrs):
            o[y] = np.roll(x[y], sh)
    return out

# 正面の幅に背面の幅をそろえる（背面は左右反転して「世界の座標」にそろえる）
fa, wf = crop_view(FRONT, OUTLINE_FRONT)
ba, wb = crop_view(BACK, OUTLINE_BACK, width_override=wf, flip=True)
f_fill, f_reg, f_body = straighten(fa)
b_fill, b_reg, b_body = straighten(ba)
print('width front/back', wf, 'IoU', (f_body & b_body).sum() / (f_body | b_body).sum())

# 頭と首：シルエットの幅が最も細い首のあたりで切る
union = f_body | b_body
widths = union.sum(axis=1)
ys_body = np.where(widths > 0)[0]
top = ys_body[0]
hs = ys_body[(ys_body > top + 60) & (ys_body < top + 260)]
neck_y = int(hs[np.argmin(ndi.uniform_filter1d(widths[hs].astype(float), 9))])
head_rows = np.arange(top, neck_y)
hw = widths[head_rows]
head_row = int(top + (neck_y - top) * 0.45)
head_xs = np.where(union[head_row])[0]
head_w = int(head_xs.max() - head_xs.min())
head_cx = float((head_xs.min() + head_xs.max()) / 2)
print('top', top, 'neck_y', neck_y, 'head_w', head_w, 'head_cx', head_cx)

# 深度グリッド（半分の解像度）
def half(m):
    return np.asarray(Image.fromarray((m * 255).astype('uint8')).resize((W // 2, CH // 2), Image.BILINEAR)) > 127
M = half(union)
M[: (neck_y - 10) // 2] = False  # 首の途中から下だけ体のメッシュにする（頭は別の立体）
d = ndi.distance_transform_edt(M)
inside = d >= 1
# 厚み：その場所の幅（半幅 w）に合わせた円形の断面。腕や脚は丸く、胴は少し平たく
w_loc = ndi.gaussian_filter(ndi.maximum_filter(d, size=45), 3)
w_loc = np.maximum(w_loc, d)
dd = np.maximum(d - 1, 0)
k = np.interp(w_loc, [12, 45], [1.0, 0.85])
t0 = k * np.sqrt(np.maximum(dd * (2 * w_loc - dd), 0))
t0 = ndi.gaussian_filter(t0, 1.6)
t0[~inside] = 0
t0[d <= 1] = 0
edge = np.clip((d - 1) / 3, 0, 1)

def relief(fill):
    f = half(fill > 0.5).astype(float)
    return ndi.gaussian_filter(f, 1.4) * edge * RELIEF

tF = np.clip(t0 + relief(f_fill), 0, DEPTH_MAX)
tB = np.clip(t0 + relief(b_fill), 0, DEPTH_MAX)
tF[~inside] = 0
tB[~inside] = 0
depth = np.zeros((CH // 2, W // 2, 4), np.uint8)
depth[..., 0] = tF / DEPTH_MAX * 255
depth[..., 1] = tB / DEPTH_MAX * 255
depth[..., 2] = inside * 255
depth[..., 3] = 255
Image.fromarray(depth, 'RGBA').save('src/assets/body-depth.png', optimize=True)

def save_tex(fill, reg, out):
    L = np.asarray(Image.fromarray((fill * 255).astype('uint8')).resize((W * SS, CH * SS), Image.BICUBIC)) / 255.0
    L = np.clip((L - 0.35) / 0.3, 0, 1)         # 輪郭をくっきりさせる
    L = L * L * (3 - 2 * L)
    R = np.asarray(Image.fromarray(reg).resize((W * SS, CH * SS), Image.NEAREST))
    px = np.zeros((CH * SS, W * SS, 4), np.uint8)
    px[..., 0] = (L * 255).astype('uint8')
    px[..., 1] = R
    px[..., 3] = 255
    Image.fromarray(px, 'RGBA').save(out, optimize=True)
save_tex(f_fill, f_reg, 'src/assets/body-front.png')
save_tex(b_fill, b_reg, 'src/assets/body-back.png')

ys2 = np.where(M.any(axis=1))[0]
meta = {
    'gridW': W // 2, 'gridH': CH // 2, 'depthMax': DEPTH_MAX,
    'bodyTop': int(ys2[0]), 'bodyBottom': int(ys2[-1]),   # 体メッシュの上端・下端（グリッド行）
    'headTop': int(top / 2), 'neckY': int((neck_y - 2) / 2), 'headW': head_w / 2, 'headCx': head_cx / 2,
}
json.dump(meta, open('src/assets/body-meta.json', 'w'), indent=1)
print(meta)
# 確認用
prev = np.zeros((CH, W, 3), np.uint8)
prev[..., 0] = (f_body * 90); prev[..., 1] = (b_body * 90)
prev[..., 2] = (f_fill > 0.5) * 255
Image.fromarray(prev).save(r'C:/Users/tanatatu/AppData/Local/Temp/claude/4791c11b855e5645/3d0efc53-9d55-4d93-a8a4-ec932f023faf/scratchpad/align.png')
