import sys
import re
import cv2
import numpy as np
import xml.etree.ElementTree as ET


# =========================================================
# CONFIG
# =========================================================

MIN_GRADIENT_REGION = 3500

# Standard deviation is used to decide whether a large
# region actually contains useful smooth shading.
MIN_VARIATION = 5.0

# Very large variation usually means the region crosses
# actual image details, so don't turn that into one gradient.
MAX_VARIATION = 38.0

MAX_GRADIENTS = 24


# =========================================================
# HELPERS
# =========================================================

def clamp_byte(value):
    return max(
        0,
        min(
            255,
            int(round(value))
        )
    )


def rgb_hex(rgb):
    r, g, b = [
        clamp_byte(x)
        for x in rgb
    ]

    return f'#{r:02x}{g:02x}{b:02x}'


def parse_color(value):
    if not value:
        return None

    value = value.strip()

    if re.fullmatch(
        r'#[0-9a-fA-F]{6}',
        value
    ):
        return np.array([
            int(value[1:3], 16),
            int(value[3:5], 16),
            int(value[5:7], 16)
        ], dtype=np.float32)

    if re.fullmatch(
        r'#[0-9a-fA-F]{3}',
        value
    ):
        return np.array([
            int(value[1] * 2, 16),
            int(value[2] * 2, 16),
            int(value[3] * 2, 16)
        ], dtype=np.float32)

    match = re.fullmatch(
        r'rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)',
        value
    )

    if match:
        return np.array([
            int(match.group(1)),
            int(match.group(2)),
            int(match.group(3))
        ], dtype=np.float32)

    return None


def get_fill(element):
    fill = element.get('fill')

    if fill:
        return fill

    style = element.get('style', '')

    match = re.search(
        r'(?:^|;)\s*fill\s*:\s*([^;]+)',
        style
    )

    if match:
        return match.group(1).strip()

    return None


def set_fill(element, value):
    if element.get('fill') is not None:
        element.set(
            'fill',
            value
        )
        return

    style = element.get('style', '')

    if re.search(
        r'(?:^|;)\s*fill\s*:',
        style
    ):
        style = re.sub(
            r'((?:^|;)\s*fill\s*:\s*)[^;]+',
            lambda m: m.group(1) + value,
            style
        )

        element.set(
            'style',
            style
        )
    else:
        element.set(
            'fill',
            value
        )


# =========================================================
# SVG SIZE
# =========================================================

def number_from_svg(value):
    if not value:
        return None

    match = re.match(
        r'\s*([-+]?[0-9]*\.?[0-9]+)',
        value
    )

    if not match:
        return None

    return float(
        match.group(1)
    )


def get_svg_geometry(root):
    viewbox = root.get('viewBox')

    if viewbox:
        values = [
            float(x)
            for x in
            re.split(
                r'[,\s]+',
                viewbox.strip()
            )
            if x
        ]

        if len(values) == 4:
            return tuple(values)

    width = number_from_svg(
        root.get('width')
    )

    height = number_from_svg(
        root.get('height')
    )

    if width and height:
        return (
            0.0,
            0.0,
            width,
            height
        )

    raise RuntimeError(
        'SVG size/viewBox detect nahi hua'
    )


# =========================================================
# RASTERIZE INDIVIDUAL SVG ELEMENT
# =========================================================

def make_mask_svg(
    root,
    target,
    width,
    height
):
    """
    Individual path ki coverage detect karne ke liye
    temporary mini SVG build karta hai.

    OpenCV directly arbitrary SVG path rasterize nahi karta,
    isliye yahan exact path rasterization perform nahi kar
    sakte without another renderer.

    First gradient-aware version mein hum safely only
    full/background-like rect elements process karenge.
    """

    tag = target.tag.split('}')[-1]

    if tag != 'rect':
        return None

    x = float(
        target.get(
            'x',
            '0'
        )
    )

    y = float(
        target.get(
            'y',
            '0'
        )
    )

    w = float(
        target.get(
            'width',
            '0'
        )
    )

    h = float(
        target.get(
            'height',
            '0'
        )
    )

    return (
        x,
        y,
        w,
        h
    )


# =========================================================
# ANALYZE RASTER REGION
# =========================================================

def analyze_rectangle(
    rgb,
    svg_geometry,
    rect
):
    min_x, min_y, svg_w, svg_h = (
        svg_geometry
    )

    x, y, w, h = rect

    image_h, image_w = rgb.shape[:2]

    x1 = int(
        round(
            (x - min_x)
            / svg_w
            * image_w
        )
    )

    y1 = int(
        round(
            (y - min_y)
            / svg_h
            * image_h
        )
    )

    x2 = int(
        round(
            (x + w - min_x)
            / svg_w
            * image_w
        )
    )

    y2 = int(
        round(
            (y + h - min_y)
            / svg_h
            * image_h
        )
    )

    x1 = max(
        0,
        min(
            image_w,
            x1
        )
    )

    y1 = max(
        0,
        min(
            image_h,
            y1
        )
    )

    x2 = max(
        0,
        min(
            image_w,
            x2
        )
    )

    y2 = max(
        0,
        min(
            image_h,
            y2
        )
    )

    if (
        x2 <= x1
        or
        y2 <= y1
    ):
        return None

    region = rgb[
        y1:y2,
        x1:x2
    ].astype(
        np.float32
    )

    area = (
        region.shape[0]
        *
        region.shape[1]
    )

    if (
        area <
        MIN_GRADIENT_REGION
    ):
        return None

    variation = float(
        np.mean(
            np.std(
                region.reshape(
                    -1,
                    3
                ),
                axis=0
            )
        )
    )

    if (
        variation <
        MIN_VARIATION
        or
        variation >
        MAX_VARIATION
    ):
        return None

    # Compare horizontal and vertical change.

    left = np.mean(
        region[
            :,
            :max(
                1,
                region.shape[1] // 4
            )
        ],
        axis=(0, 1)
    )

    right = np.mean(
        region[
            :,
            -max(
                1,
                region.shape[1] // 4
            ):
        ],
        axis=(0, 1)
    )

    top = np.mean(
        region[
            :max(
                1,
                region.shape[0] // 4
            ),
            :
        ],
        axis=(0, 1)
    )

    bottom = np.mean(
        region[
            -max(
                1,
                region.shape[0] // 4
            ):,
            :
        ],
        axis=(0, 1)
    )

    horizontal_change = float(
        np.linalg.norm(
            right - left
        )
    )

    vertical_change = float(
        np.linalg.norm(
            bottom - top
        )
    )

    if (
        horizontal_change >=
        vertical_change
    ):
        return {
            'x1': '0%',
            'y1': '50%',
            'x2': '100%',
            'y2': '50%',
            'start': left,
            'end': right,
            'variation': variation
        }

    return {
        'x1': '50%',
        'y1': '0%',
        'x2': '50%',
        'y2': '100%',
        'start': top,
        'end': bottom,
        'variation': variation
    }


# =========================================================
# CREATE GRADIENT
# =========================================================

def add_gradient(
    defs,
    gradient_id,
    information
):
    gradient = ET.SubElement(
        defs,
        'linearGradient'
    )

    gradient.set(
        'id',
        gradient_id
    )

    gradient.set(
        'x1',
        information['x1']
    )

    gradient.set(
        'y1',
        information['y1']
    )

    gradient.set(
        'x2',
        information['x2']
    )

    gradient.set(
        'y2',
        information['y2']
    )

    gradient.set(
        'color-interpolation',
        'sRGB'
    )

    stop1 = ET.SubElement(
        gradient,
        'stop'
    )

    stop1.set(
        'offset',
        '0%'
    )

    stop1.set(
        'stop-color',
        rgb_hex(
            information[
                'start'
            ]
        )
    )

    stop2 = ET.SubElement(
        gradient,
        'stop'
    )

    stop2.set(
        'offset',
        '100%'
    )

    stop2.set(
        'stop-color',
        rgb_hex(
            information[
                'end'
            ]
        )
    )


# =========================================================
# MAIN ENHANCEMENT
# =========================================================

def enhance(
    original_path,
    input_svg,
    output_svg
):
    bgr = cv2.imread(
        original_path,
        cv2.IMREAD_COLOR
    )

    if bgr is None:
        raise RuntimeError(
            'Original raster read nahi hua'
        )

    rgb = cv2.cvtColor(
        bgr,
        cv2.COLOR_BGR2RGB
    )

    ET.register_namespace(
        '',
        'http://www.w3.org/2000/svg'
    )

    tree = ET.parse(
        input_svg
    )

    root = tree.getroot()

    geometry = get_svg_geometry(
        root
    )

    namespace = ''

    if root.tag.startswith('{'):
        namespace = (
            root.tag.split(
                '}'
            )[0]
            +
            '}'
        )

    defs = root.find(
        f'{namespace}defs'
    )

    if defs is None:
        defs = ET.Element(
            f'{namespace}defs'
        )

        root.insert(
            0,
            defs
        )

    gradient_count = 0

    elements = list(
        root.iter()
    )

    for element in elements:
        if (
            gradient_count >=
            MAX_GRADIENTS
        ):
            break

        tag = (
            element.tag
            .split('}')[-1]
        )

        # Safe first version:
        # only rectangle regions.
        if tag != 'rect':
            continue

        fill = get_fill(
            element
        )

        if (
            fill is None
            or
            fill == 'none'
            or
            fill.startswith(
                'url('
            )
        ):
            continue

        parsed = parse_color(
            fill
        )

        if parsed is None:
            continue

        rect = make_mask_svg(
            root,
            element,
            geometry[2],
            geometry[3]
        )

        if rect is None:
            continue

        info = analyze_rectangle(
            rgb,
            geometry,
            rect
        )

        if info is None:
            continue

        gradient_id = (
            f'autoGradient'
            f'{gradient_count}'
        )

        add_gradient(
            defs,
            gradient_id,
            info
        )

        set_fill(
            element,
            f'url(#{gradient_id})'
        )

        gradient_count += 1

    print(
        f'Gradients added: '
        f'{gradient_count}',
        flush=True
    )

    tree.write(
        output_svg,
        encoding='utf-8',
        xml_declaration=True
    )


# =========================================================
# CLI
# =========================================================

if __name__ == '__main__':
    if len(sys.argv) != 4:
        print(
            'Usage: svg_enhance.py '
            'original.png input.svg output.svg',
            file=sys.stderr
        )

        sys.exit(1)

    try:
        enhance(
            sys.argv[1],
            sys.argv[2],
            sys.argv[3]
        )

    except Exception as error:
        print(
            str(error),
            file=sys.stderr
        )

        sys.exit(1)