import sys, os
from PIL import Image, ImageChops
a, b = sys.argv[1], sys.argv[2]
bad = 0
for f in sorted(os.listdir(a)):
    if not f.endswith('.png'): continue
    pb = os.path.join(b, f)
    if not os.path.exists(pb): print('FALTA', f); bad += 1; continue
    ia, ib = Image.open(os.path.join(a, f)).convert('RGB'), Image.open(pb).convert('RGB')
    if ia.size != ib.size: print('TAMANHO', f, ia.size, ib.size); bad += 1; continue
    bbox = ImageChops.difference(ia, ib).getbbox()
    n = 0
    if bbox:
        d = ImageChops.difference(ia, ib).convert('L').point(lambda v: 255 if v > 0 else 0)
        n = sum(1 for v in d.getdata() if v)
    print(('OK   ' if not bbox else 'DIFF ') + f, '' if not bbox else f'{n} px, caixa {bbox}')
    if bbox: bad += 1
print('arquivos com diferença:', bad)
