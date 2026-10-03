"""Render the app's code-drawn book mark at common launcher sizes."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
font_path = Path('C:/Windows/Fonts/msjh.ttc')
for size in (180, 192, 512):
    scale = 3
    canvas = Image.new('RGB', (size * scale, size * scale), '#285346')
    pen = ImageDraw.Draw(canvas)
    edge = size * scale
    pen.rounded_rectangle((edge*.21, edge*.18, edge*.79, edge*.82), radius=edge*.055, fill='#eef1e9')
    pen.line((edge*.29, edge*.20, edge*.29, edge*.80), fill='#bdcbbd', width=max(2,round(edge*.008)))
    pen.rectangle((edge*.65, edge*.18, edge*.70, edge*.35), fill='#b79861')
    font = ImageFont.truetype(str(font_path), round(edge*.38))
    pen.text((edge*.53, edge*.51), '旅', font=font, fill='#285346', anchor='mm')
    canvas.resize((size,size),Image.Resampling.LANCZOS).save(root/'public'/f'icon-{size}.png',optimize=True)
