"""人体図（scripts/source/body-diagram.jpg）から、BodyModel 用のテクスチャを作る。
出力: src/assets/body-front.png, body-back.png
  R = 明るさ（線と筋肉の形。写真の赤・ピンクも白扱い）
  G = 部位ID（regions.ts の REGIONS の順番 + 1。0 は部位なし）
使い方: python scripts/make-body-textures.py
※ 連結成分の番号は写真が同じなら毎回同じ。写真を差し替えたら番号を取り直すこと。
"""
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

im = Image.open('scripts/source/body-diagram.jpg').convert('RGB')
a = np.asarray(im).astype(int)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
mask = (a.min(axis=2) > 120) | ((r > 150) & (r - g > 60))
mask = ndi.binary_opening(mask, iterations=1)
lab, n = ndi.label(mask)
lum = np.clip((a.max(axis=2) - 50) / 150.0, 0, 1)

def build(parts, outline, out):
    reg = np.zeros(lab.shape, np.uint8)
    keep = np.zeros(lab.shape, bool)
    # 各成分を3px広げて縁（アンチエイリアス）まで部位に含める
    dist, (iy, ix) = ndi.distance_transform_edt(~np.isin(lab, list(parts) + NEUTRAL + [outline]), return_indices=True)
    near = lab[iy, ix]
    zone = (dist <= 3) & np.isin(near, list(parts) + NEUTRAL + [outline])
    keep |= zone
    for k, name in parts.items():
        reg[zone & (near == k)] = ID[name]
    L = np.where(keep, lum, 0)
    # 部位の中は写真の色ムラ（赤など）を消して真っ白にする
    inner = np.isin(lab, list(parts) + NEUTRAL)
    inner = ndi.binary_erosion(inner, iterations=2)
    L[inner] = 1
    ys, xs = np.where(lab == outline)
    x0, x1, y0, y1 = xs.min() - 8, xs.max() + 8, ys.min() - 8, ys.max() + 8
    Lc, Rc = L[y0:y1, x0:x1], reg[y0:y1, x0:x1]
    H = 1060
    s = H / Lc.shape[0]
    w = round(Lc.shape[1] * s)
    Li = Image.fromarray((Lc * 255).astype('uint8')).resize((w, H), Image.LANCZOS)
    Ri = Image.fromarray(Rc).resize((w, H), Image.NEAREST)
    W, CH = 520, 1100
    canvas = np.zeros((CH, W, 4), np.uint8)
    ox, oy = (W - w) // 2, (CH - H) // 2
    canvas[oy:oy + H, ox:ox + w, 0] = np.asarray(Li)
    canvas[oy:oy + H, ox:ox + w, 1] = np.asarray(Ri)
    canvas[..., 3] = 255
    Image.fromarray(canvas, 'RGBA').save(out, optimize=True)
    print(out, canvas.shape)

build(BACK, OUTLINE_BACK, 'src/assets/body-back.png')
build(FRONT, OUTLINE_FRONT, 'src/assets/body-front.png')
