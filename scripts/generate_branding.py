#!/usr/bin/env python3
"""
Branding generator per SOTA Agentic OS.
Parte dall'immagine sorgente e produce tutti i formati necessari:
- Logo primario (PNG/SVG) con sfondo e trasparente
- Logo monocromatico (bianco/nero)
- Favicon (16, 32, 180, 512)
- Banner orizzontale (per README, social)
- Banner verticale (per sidebar)
- Avatar quadrato (per profili)
- Social card (OG image 1200x630)
- Watermark per documenti
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageOps, ImageChops

SRC = '/home/z/my-project/upload/source.png'
OUT = '/home/z/my-project/download/branding'
os.makedirs(OUT, exist_ok=True)

# Colori dominanti estratti dall'immagine (verificati con PIL sotto)
COLORS = {
    'bg_dark':     '#0a0a2e',  # viola scuro notte
    'bg_purple':   '#3a1e6a',  # viola secondario
    'accent_blue': '#00d4ff',  # blu elettrico (logo S)
    'text_white':  '#ffffff',
    'text_silver': '#c0c0c0',
}

# ============ 1. Estrazione colori reali ============
def extract_palette(img, n=8):
    """Estrai i colori dominanti tramite quantizzazione."""
    q = img.convert('RGB').quantize(colors=n, method=Image.Quantize.MEDIANCUT)
    palette = q.getpalette()[:n*3]
    colors = [tuple(palette[i:i+3]) for i in range(0, len(palette), 3)]
    # Sorta per luminosità (più scuri prima)
    colors.sort(key=lambda c: sum(c))
    return colors

src_img = Image.open(SRC)
palette = extract_palette(src_img, 8)
print('Palette estratta:')
for c in palette:
    print(f'  rgb{c}  #{c[0]:02x}{c[1]:02x}{c[2]:02x}')

# ============ 2. Helper: crop intelligente al soggetto ============
def find_subject_bbox(img, bg_color_tolerance=30):
    """Trova il bounding box del soggetto (logo+testo) escludendo lo sfondo scuro."""
    rgb = img.convert('RGB')
    bg = palette[0]  # colore più scuro = sfondo
    # Maschera: pixel che differiscono dallo sfondo per più della tolerance
    diff = ImageChops.difference(rgb, Image.new('RGB', rgb.size, bg))
    mask = diff.convert('L').point(lambda p: 255 if p > bg_color_tolerance else 0)
    bbox = mask.getbbox()
    return bbox, mask

bbox, subject_mask = find_subject_bbox(src_img)
print(f'\nBounding box soggetto: {bbox}')

# Aggiungi padding intorno al bbox
def expand_bbox(bbox, padding, max_size):
    l, t, r, b = bbox
    l = max(0, l - padding)
    t = max(0, t - padding)
    r = min(max_size[0], r + padding)
    b = min(max_size[1], b + padding)
    return (l, t, r, b)

# ============ 3. Logo primario (con sfondo scuro, crop centrato) ============
def make_logo_primary():
    """Logo con sfondo scuro originale, crop intelligente."""
    # Crop con padding
    padded = expand_bbox(bbox, 60, src_img.size)
    cropped = src_img.crop(padded)
    # Ridimensiona a 1024x1024 mantenendo aspect ratio con sfondo
    target_size = 1024
    ratio = min(target_size / cropped.width, target_size / cropped.height)
    new_w = int(cropped.width * ratio)
    new_h = int(cropped.height * ratio)
    resized = cropped.resize((new_w, new_h), Image.LANCZOS)
    # Crea canvas con bg_dark
    canvas = Image.new('RGB', (target_size, target_size), tuple(int(COLORS['bg_dark'][i:i+2], 16) for i in (1, 3, 5)))
    offset = ((target_size - new_w) // 2, (target_size - new_h) // 2)
    canvas.paste(resized, offset)
    canvas.save(f'{OUT}/logo-primary-1024.png', 'PNG', optimize=True)
    # Versione 512
    canvas.resize((512, 512), Image.LANCZOS).save(f'{OUT}/logo-primary-512.png', 'PNG', optimize=True)
    # Versione 256
    canvas.resize((256, 256), Image.LANCZOS).save(f'{OUT}/logo-primary-256.png', 'PNG', optimize=True)
    print('✓ logo-primary (1024/512/256)')

# ============ 4. Logo con sfondo trasparente ============
def make_logo_transparent():
    """Logo senza sfondo: rimuove il colore di background."""
    # Converti in RGBA
    rgba = src_img.convert('RGBA')
    bg = palette[0]
    # Per ogni pixel, calcola alpha basato sulla distanza dal bg
    datas = rgba.getdata()
    new_data = []
    for item in datas:
        r, g, b = item[0], item[1], item[2]
        # Distanza dal colore di sfondo
        dist = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
        if dist < 30:
            # Sfondo → trasparente
            new_data.append((0, 0, 0, 0))
        elif dist < 80:
            # Transizione → alpha parziale
            alpha = int(255 * (dist - 30) / 50)
            new_data.append((r, g, b, alpha))
        else:
            new_data.append((r, g, b, 255))
    rgba.putdata(new_data)
    # Crop al soggetto
    padded = expand_bbox(bbox, 50, src_img.size)
    cropped = rgba.crop(padded)
    cropped.save(f'{OUT}/logo-transparent.png', 'PNG', optimize=True)
    # Versione 512
    ratio = 512 / max(cropped.width, cropped.height)
    resized = cropped.resize((int(cropped.width * ratio), int(cropped.height * ratio)), Image.LANCZOS)
    resized.save(f'{OUT}/logo-transparent-512.png', 'PNG', optimize=True)
    print('✓ logo-transparent (full + 512)')

# ============ 5. Logo monocromatico (bianco e nero) ============
def make_logo_monochrome():
    """Versione monocromatica bianca per sfondi scuri."""
    rgba = src_img.convert('RGBA')
    bg = palette[0]
    datas = rgba.getdata()
    new_data = []
    for item in datas:
        r, g, b = item[0], item[1], item[2]
        dist = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
        if dist < 30:
            new_data.append((0, 0, 0, 0))  # trasparente
        else:
            # Converti in bianco con alpha basato sulla luminosità originale
            lum = int(0.299 * r + 0.587 * g + 0.114 * b)
            alpha = min(255, int(dist * 1.5))
            new_data.append((255, 255, 255, alpha))
    rgba.putdata(new_data)
    padded = expand_bbox(bbox, 50, src_img.size)
    cropped = rgba.crop(padded)
    cropped.save(f'{OUT}/logo-monochrome-white.png', 'PNG', optimize=True)
    # Versione nera per sfondi chiari
    datas2 = src_img.convert('RGBA').getdata()
    new_data2 = []
    for item in datas2:
        r, g, b = item[0], item[1], item[2]
        dist = abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2])
        if dist < 30:
            new_data2.append((0, 0, 0, 0))
        else:
            alpha = min(255, int(dist * 1.5))
            new_data2.append((0, 0, 0, alpha))
    rgba2 = src_img.convert('RGBA')
    rgba2.putdata(new_data2)
    rgba2.crop(expand_bbox(bbox, 50, src_img.size)).save(f'{OUT}/logo-monochrome-black.png', 'PNG', optimize=True)
    print('✓ logo-monochrome (white + black)')

# ============ 6. Favicon ============
def make_favicon():
    """Favicon multi-size: 16, 32, 48, 180 (Apple), 512."""
    # Usa il logo primary quadrato come base
    base = Image.open(f'{OUT}/logo-primary-512.png')
    for size in [16, 32, 48, 180, 512]:
        s = base.resize((size, size), Image.LANCZOS)
        s.save(f'{OUT}/favicon-{size}.png', 'PNG', optimize=True)
    # ICO file con multiple sizes
    base.save(f'{OUT}/favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print('✓ favicon (16/32/48/180/512 + .ico)')

# ============ 7. Banner orizzontale (per README / LinkedIn) ============
def make_banner_horizontal():
    """Banner 1500x500 per README header."""
    w, h = 1500, 500
    canvas = Image.new('RGB', (w, h), tuple(int(COLORS['bg_dark'][i:i+2], 16) for i in (1, 3, 5)))
    # Aggiungi gradient viola scuro → viola
    bg2 = tuple(int(COLORS['bg_purple'][i:i+2], 16) for i in (1, 3, 5))
    grad = Image.new('RGB', (w, h), bg2)
    mask = Image.new('L', (w, h), 0)
    md = ImageDraw.Draw(mask)
    for i in range(w):
        # gradient orizzontale
        alpha = int(255 * (1 - i / w) * 0.4)
        md.line([(i, 0), (i, h)], fill=alpha)
    canvas = Image.composite(grad, canvas, mask)
    # Aggiungi pattern circuiti simulato
    draw = ImageDraw.Draw(canvas)
    import random
    random.seed(42)
    for _ in range(40):
        x = random.randint(0, w)
        y = random.randint(0, h)
        # Punti luminosi
        r = random.randint(1, 3)
        col = tuple(int(COLORS['accent_blue'][i:i+2], 16) for i in (1, 3, 5))
        draw.ellipse([x-r, y-r, x+r, y+r], fill=col)
    # Logo a sinistra
    logo = Image.open(f'{OUT}/logo-transparent-512.png')
    logo_h = 280
    ratio = logo_h / logo.height
    logo_w = int(logo.width * ratio)
    logo_resized = logo.resize((logo_w, logo_h), Image.LANCZOS)
    canvas.paste(logo_resized, (60, (h - logo_h) // 2), logo_resized)
    # Testo a destra del logo
    draw = ImageDraw.Draw(canvas)
    try:
        font_big = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 64)
        font_small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 28)
    except:
        font_big = ImageFont.load_default()
        font_small = ImageFont.load_default()
    # Titolo
    draw.text((60 + logo_w + 30, 180), 'SOTA Agentic OS', font=font_big, fill=tuple(int(COLORS['text_white'][i:i+2], 16) for i in (1, 3, 5)))
    # Sottotitolo
    draw.text((60 + logo_w + 30, 260), 'INTELLIGENT. SECURE. AUTONOMOUS.', font=font_small, fill=tuple(int(COLORS['accent_blue'][i:i+2], 16) for i in (1, 3, 5)))
    canvas.save(f'{OUT}/banner-horizontal-1500x500.png', 'PNG', optimize=True)
    # Versione 1200x400 per social
    canvas.resize((1200, 400), Image.LANCZOS).save(f'{OUT}/banner-horizontal-1200x400.png', 'PNG', optimize=True)
    print('✓ banner-horizontal (1500x500 + 1200x400)')

# ============ 8. Social card OG image (1200x630) ============
def make_og_image():
    """Open Graph image 1200x630 per condivisioni social."""
    w, h = 1200, 630
    bg_dark = tuple(int(COLORS['bg_dark'][i:i+2], 16) for i in (1, 3, 5))
    canvas = Image.new('RGB', (w, h), bg_dark)
    # Gradient radiale simulato
    grad = Image.new('RGB', (w, h), tuple(int(COLORS['bg_purple'][i:i+2], 16) for i in (1, 3, 5)))
    mask = Image.new('L', (w, h), 0)
    md = ImageDraw.Draw(mask)
    cx, cy = w // 2, h // 2
    for r in range(max(w, h), 0, -2):
        alpha = int(255 * (r / max(w, h)) ** 2 * 0.6)
        md.ellipse([cx - r, cy - r, cx + r, cy + r], fill=alpha)
    canvas = Image.composite(canvas, grad, mask)
    # Logo centrato in alto
    logo = Image.open(f'{OUT}/logo-transparent-512.png')
    logo_h = 240
    ratio = logo_h / logo.height
    logo_w = int(logo.width * ratio)
    logo_resized = logo.resize((logo_w, logo_h), Image.LANCZOS)
    canvas.paste(logo_resized, ((w - logo_w) // 2, 80), logo_resized)
    # Testo sotto
    draw = ImageDraw.Draw(canvas)
    try:
        font_title = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 80)
        font_claim = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 32)
    except:
        font_title = ImageFont.load_default()
        font_claim = ImageFont.load_default()
    title = 'SOTA Agentic OS'
    claim = 'INTELLIGENT  ·  SECURE  ·  AUTONOMOUS'
    # Centra orizzontalmente
    title_w = draw.textlength(title, font=font_title)
    draw.text(((w - title_w) // 2, 360), title, font=font_title, fill=tuple(int(COLORS['text_white'][i:i+2], 16) for i in (1, 3, 5)))
    claim_w = draw.textlength(claim, font=font_claim)
    accent = tuple(int(COLORS['accent_blue'][i:i+2], 16) for i in (1, 3, 5))
    draw.text(((w - claim_w) // 2, 460), claim, font=font_claim, fill=accent)
    # Sottotitolo tecnico
    try:
        font_sub = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 22)
        sub = '9-Micro-Phase Agentic Operating System  ·  LTL Verification  ·  Lean4 Formal  ·  ERL'
        sub_w = draw.textlength(sub, font=font_sub)
        draw.text(((w - sub_w) // 2, 540), sub, font=font_sub, fill=tuple(int(COLORS['text_silver'][i:i+2], 16) for i in (1, 3, 5)))
    except:
        pass
    canvas.save(f'{OUT}/og-image-1200x630.png', 'PNG', optimize=True)
    print('✓ og-image (1200x630)')

# ============ 9. Avatar quadrato (per profili) ============
def make_avatar():
    """Avatar quadrato 400x400 con solo il simbolo S (crop stretto sul logo)."""
    # Crop centrato solo sulla sfera+S
    bbox_tight = expand_bbox(bbox, -100, src_img.size)  # più stretto
    l, t, r, b = bbox_tight
    # Forza quadrato
    size = min(r - l, b - t)
    cx = (l + r) // 2
    cy = (t + b) // 2
    sq_bbox = (cx - size // 2, cy - size // 2, cx + size // 2, cy + size // 2)
    cropped = src_img.crop(sq_bbox)
    # Salva a 512 e 400
    cropped.resize((512, 512), Image.LANCZOS).save(f'{OUT}/avatar-512.png', 'PNG', optimize=True)
    cropped.resize((400, 400), Image.LANCZOS).save(f'{OUT}/avatar-400.png', 'PNG', optimize=True)
    cropped.resize((200, 200), Image.LANCZOS).save(f'{OUT}/avatar-200.png', 'PNG', optimize=True)
    print('✓ avatar (512/400/200)')

# ============ 10. Watermark per documenti ============
def make_watermark():
    """Watermark trasparente per documenti PDF/docx."""
    # Usa il logo monochrome bianco con bassa opacità
    wm = Image.open(f'{OUT}/logo-monochrome-white.png').convert('RGBA')
    # Riduci opacità al 20%
    datas = wm.getdata()
    new_data = [(r, g, b, int(a * 0.2)) for r, g, b, a in datas]
    wm.putdata(new_data)
    # Ridimensiona a 300px largo
    ratio = 300 / wm.width
    wm_resized = wm.resize((300, int(wm.height * ratio)), Image.LANCZOS)
    wm_resized.save(f'{OUT}/watermark-300.png', 'PNG', optimize=True)
    print('✓ watermark (20% opacity, 300px)')

# ============ 11. App icon iOS/Android style ============
def make_app_icon():
    """App icon con rounded corners stile iOS."""
    base = Image.open(f'{OUT}/logo-primary-512.png').convert('RGB')
    # Maschera con angoli arrotondati
    size = 512
    radius = 120
    mask = Image.new('L', (size, size), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, size, size], radius=radius, fill=255)
    # Applica maschera
    icon = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    icon.paste(base, (0, 0), mask)
    icon.save(f'{OUT}/app-icon-512.png', 'PNG', optimize=True)
    # Versioni iOS standard
    for size in [180, 120, 87, 80, 60, 40, 29, 20]:
        icon.resize((size, size), Image.LANCZOS).save(f'{OUT}/app-icon-{size}.png', 'PNG', optimize=True)
    print('✓ app-icon (iOS sizes + 512 rounded)')

# ============ 12. SVG logo vettoriale semplificato ============
def make_svg_logo():
    """Genera un SVG vettoriale del logo (semplificato, ricreato)."""
    svg_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="70%">
      <stop offset="0%" stop-color="{COLORS['bg_purple']}"/>
      <stop offset="100%" stop-color="{COLORS['bg_dark']}"/>
    </radialGradient>
    <linearGradient id="orbital" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="{COLORS['accent_blue']}" stop-opacity="0.3"/>
      <stop offset="50%" stop-color="{COLORS['accent_blue']}" stop-opacity="1"/>
      <stop offset="100%" stop-color="{COLORS['accent_blue']}" stop-opacity="0.3"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="3"/>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="400" height="400" fill="url(#bg)"/>

  <!-- Circuit pattern -->
  <g stroke="{COLORS['bg_purple']}" stroke-width="0.5" fill="none" opacity="0.6">
    <path d="M 20 50 L 80 50 L 80 90"/>
    <path d="M 380 50 L 320 50 L 320 90"/>
    <path d="M 20 350 L 80 350 L 80 310"/>
    <path d="M 380 350 L 320 350 L 320 310"/>
    <path d="M 50 20 L 50 80 L 90 80"/>
    <path d="M 350 20 L 350 80 L 310 80"/>
    <path d="M 50 380 L 50 320 L 90 320"/>
    <path d="M 350 380 L 350 320 L 310 320"/>
  </g>
  <g fill="{COLORS['accent_blue']}" opacity="0.8">
    <circle cx="80" cy="90" r="2"/>
    <circle cx="320" cy="90" r="2"/>
    <circle cx="80" cy="310" r="2"/>
    <circle cx="320" cy="310" r="2"/>
    <circle cx="90" cy="80" r="2"/>
    <circle cx="310" cy="80" r="2"/>
    <circle cx="90" cy="320" r="2"/>
    <circle cx="310" cy="320" r="2"/>
  </g>

  <!-- Orbital ring -->
  <ellipse cx="200" cy="160" rx="80" ry="30" fill="none" stroke="url(#orbital)" stroke-width="2" transform="rotate(-15 200 160)" opacity="0.7"/>

  <!-- S sphere (stylized) -->
  <g filter="url(#glow)">
    <circle cx="200" cy="160" r="50" fill="{COLORS['bg_dark']}" stroke="{COLORS['accent_blue']}" stroke-width="2"/>
    <text x="200" y="180" text-anchor="middle" font-family="'DejaVu Sans', sans-serif" font-size="64" font-weight="bold" fill="{COLORS['accent_blue']}">S</text>
  </g>

  <!-- Title -->
  <text x="200" y="260" text-anchor="middle" font-family="'DejaVu Sans', sans-serif" font-size="38" font-weight="bold" fill="{COLORS['text_silver']}" letter-spacing="4">SOTA OS</text>

  <!-- Claim -->
  <text x="200" y="295" text-anchor="middle" font-family="'DejaVu Sans', sans-serif" font-size="12" fill="{COLORS['text_white']}" letter-spacing="3" opacity="0.9">INTELLIGENT. SECURE. AUTONOMOUS.</text>

  <!-- Underline accent -->
  <line x1="120" y1="320" x2="280" y2="320" stroke="{COLORS['accent_blue']}" stroke-width="1" opacity="0.5"/>
</svg>'''
    with open(f'{OUT}/logo-vector.svg', 'w') as f:
        f.write(svg_content)
    print('✓ logo-vector.svg')

# ============ 13. Color palette swatch ============
def make_palette_swatch():
    """Salva la palette come immagine di riferimento."""
    sw = Image.new('RGB', (800, 200), tuple(int(COLORS['bg_dark'][i:i+2], 16) for i in (1, 3, 5)))
    draw = ImageDraw.Draw(sw)
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
        font_bold = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 12)
    except:
        font = ImageFont.load_default()
        font_bold = font
    items = [
        ('bg_dark',     '#0a0a2e', 'Background Dark'),
        ('bg_purple',   '#3a1e6a', 'Background Purple'),
        ('accent_blue', '#00d4ff', 'Accent Blue'),
        ('text_white',  '#ffffff', 'Text White'),
        ('text_silver', '#c0c0c0', 'Text Silver'),
    ]
    for i, (key, hex_color, label) in enumerate(items):
        x = 20 + i * 156
        rgb = tuple(int(hex_color[j:j+2], 16) for j in (1, 3, 5))
        draw.rectangle([x, 30, x + 140, 130], fill=rgb, outline=tuple(int(COLORS['text_white'][j:j+2], 16) for j in (1, 3, 5)))
        draw.text((x, 145), label, font=font_bold, fill=tuple(int(COLORS['text_white'][j:j+2], 16) for j in (1, 3, 5)))
        draw.text((x, 170), hex_color, font=font, fill=tuple(int(COLORS['accent_blue'][j:j+2], 16) for j in (1, 3, 5)))
    sw.save(f'{OUT}/color-palette.png', 'PNG', optimize=True)
    # Salva anche come JSON per uso programmatico
    import json
    with open(f'{OUT}/color-palette.json', 'w') as f:
        json.dump({'colors': [{'key': k, 'hex': h, 'name': n} for k, h, n in items]}, f, indent=2)
    print('✓ color-palette (png + json)')

# ============ RUN ALL ============
print('\n=== Generazione branding ===\n')
make_logo_primary()
make_logo_transparent()
make_logo_monochrome()
make_favicon()
make_banner_horizontal()
make_og_image()
make_avatar()
make_watermark()
make_app_icon()
make_svg_logo()
make_palette_swatch()

print(f'\n=== Completato. File in {OUT} ===\n')
import subprocess
subprocess.run(['ls', '-la', OUT])
