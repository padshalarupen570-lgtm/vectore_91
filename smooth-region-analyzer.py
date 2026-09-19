import sys
import cv2
import numpy as np


# ==========================================================
# CONFIG
# ==========================================================

MAX_SIZE = 1600

# Safe component minimum size.
MIN_COMPONENT_PIXELS = 900

# Region ke andar variation bahut low ho to
# gradient ki zarurat nahi.
MIN_VARIATION = 3.0

# Extremely high variation likely mixed content.
MAX_VARIATION = 42.0

# Safe mask ke small interruptions bridge karne ke liye.
CLOSE_SIZE = 9

# Thin necks/boundaries ko separate karne mein help.
OPEN_SIZE = 5

# Report mein maximum components.
MAX_REGIONS = 30


# ==========================================================
# RESIZE
# ==========================================================

def resize_to_match(
    image,
    width,
    height,
    nearest=False
):

    interpolation = (
        cv2.INTER_NEAREST
        if nearest
        else cv2.INTER_AREA
    )

    return cv2.resize(
        image,
        (
            width,
            height
        ),
        interpolation=interpolation
    )


# ==========================================================
# COLOR STATISTICS
# ==========================================================

def region_statistics(
    image,
    mask
):

    pixels = image[
        mask > 0
    ]

    if len(pixels) == 0:
        return None

    # OpenCV = BGR.
    values = pixels.astype(
        np.float32
    )

    mean_bgr = np.mean(
        values,
        axis=0
    )

    std_bgr = np.std(
        values,
        axis=0
    )

    variation = float(
        np.mean(
            std_bgr
        )
    )

    return {
        'variation': variation,
        'mean_bgr': mean_bgr,
        'std_bgr': std_bgr
    }


# ==========================================================
# RANDOM BUT STABLE PREVIEW COLOR
# ==========================================================

def region_color(
    index
):

    # Fixed deterministic pseudo-random palette.
    rng = np.random.default_rng(
        1000 + index
    )

    color = rng.integers(
        60,
        256,
        size=3,
        dtype=np.uint8
    )

    return (
        int(color[0]),
        int(color[1]),
        int(color[2])
    )


# ==========================================================
# CLEAN SAFE MASK
# ==========================================================

def prepare_safe_mask(
    mask
):

    binary = (
        mask > 127
    ).astype(
        np.uint8
    ) * 255

    # ------------------------------------------------------
    # CLOSE SMALL INTERRUPTIONS
    # ------------------------------------------------------

    close_kernel = (
        cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (
                CLOSE_SIZE,
                CLOSE_SIZE
            )
        )
    )

    binary = cv2.morphologyEx(
        binary,
        cv2.MORPH_CLOSE,
        close_kernel
    )

    # ------------------------------------------------------
    # OPEN THIN CONNECTIONS / NOISE
    # ------------------------------------------------------

    open_kernel = (
        cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (
                OPEN_SIZE,
                OPEN_SIZE
            )
        )
    )

    binary = cv2.morphologyEx(
        binary,
        cv2.MORPH_OPEN,
        open_kernel
    )

    return binary


# ==========================================================
# BUILD REGION PREVIEW
# ==========================================================

def build_preview(
    original,
    accepted
):

    # Dim original so region colors are easy to see.
    preview = (
        original.astype(
            np.float32
        ) * 0.42
    ).astype(
        np.uint8
    )

    for region in accepted:

        mask = region['mask']

        color = np.array(
            region['color'],
            dtype=np.float32
        )

        selected = (
            mask > 0
        )

        source = preview[
            selected
        ].astype(
            np.float32
        )

        preview[
            selected
        ] = np.clip(
            source * 0.35
            +
            color * 0.65,
            0,
            255
        ).astype(
            np.uint8
        )

        # Draw bounding box and region ID.
        x = region['x']
        y = region['y']
        w = region['w']
        h = region['h']

        cv2.rectangle(
            preview,
            (
                x,
                y
            ),
            (
                x + w - 1,
                y + h - 1
            ),
            region['color'],
            2
        )

        cv2.putText(
            preview,
            f"R{region['id']}",
            (
                x + 5,
                max(
                    20,
                    y + 22
                )
            ),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            region['color'],
            2,
            cv2.LINE_AA
        )

    return preview


# ==========================================================
# MAIN ANALYSIS
# ==========================================================

def analyze(
    image_path,
    safe_mask_path,
    preview_path,
    labels_path
):

    print(
        'Reading files...',
        flush=True
    )

    image = cv2.imread(
        image_path,
        cv2.IMREAD_COLOR
    )

    if image is None:

        raise RuntimeError(
            'Original image read nahi hui'
        )

    safe_mask = cv2.imread(
        safe_mask_path,
        cv2.IMREAD_GRAYSCALE
    )

    if safe_mask is None:

        raise RuntimeError(
            'Gradient-safe mask read nahi hui'
        )

    # ------------------------------------------------------
    # MATCH DIMENSIONS
    # ------------------------------------------------------

    height, width = (
        image.shape[:2]
    )

    if (
        safe_mask.shape[1] != width
        or
        safe_mask.shape[0] != height
    ):

        safe_mask = resize_to_match(
            safe_mask,
            width,
            height,
            nearest=True
        )

    print(
        f'Image size: {width}x{height}',
        flush=True
    )

    # ------------------------------------------------------
    # CLEAN SAFE MASK
    # ------------------------------------------------------

    clean = prepare_safe_mask(
        safe_mask
    )

    # ------------------------------------------------------
    # CONNECTED COMPONENTS
    # ------------------------------------------------------

    (
        component_count,
        component_labels,
        stats,
        _
    ) = cv2.connectedComponentsWithStats(
        (
            clean > 0
        ).astype(
            np.uint8
        ),
        connectivity=8
    )

    print(
        f'Raw smooth components: '
        f'{component_count - 1}',
        flush=True
    )

    regions = []

    for component in range(
        1,
        component_count
    ):

        area = int(
            stats[
                component,
                cv2.CC_STAT_AREA
            ]
        )

        if (
            area <
            MIN_COMPONENT_PIXELS
        ):
            continue

        x = int(
            stats[
                component,
                cv2.CC_STAT_LEFT
            ]
        )

        y = int(
            stats[
                component,
                cv2.CC_STAT_TOP
            ]
        )

        w = int(
            stats[
                component,
                cv2.CC_STAT_WIDTH
            ]
        )

        h = int(
            stats[
                component,
                cv2.CC_STAT_HEIGHT
            ]
        )

        mask = (
            component_labels ==
            component
        ).astype(
            np.uint8
        ) * 255

        information = region_statistics(
            image,
            mask
        )

        if information is None:
            continue

        variation = (
            information[
                'variation'
            ]
        )

        if (
            variation <
            MIN_VARIATION
            or
            variation >
            MAX_VARIATION
        ):
            continue

        regions.append({
            'component':
                component,

            'area':
                area,

            'x':
                x,

            'y':
                y,

            'w':
                w,

            'h':
                h,

            'variation':
                variation,

            'mean_bgr':
                information[
                    'mean_bgr'
                ],

            'mask':
                mask
        })

    # Large regions first.
    regions.sort(
        key=lambda item:
            item['area'],
        reverse=True
    )

    regions = regions[
        :MAX_REGIONS
    ]

    # Assign visible IDs after sorting.
    accepted = []

    for index, region in enumerate(
        regions,
        start=1
    ):

        region['id'] = index

        region['color'] = region_color(
            index
        )

        accepted.append(
            region
        )

    # ------------------------------------------------------
    # REPORT
    # ------------------------------------------------------

    print('')
    print(
        '==========================================',
        flush=True
    )

    print(
        ' SMOOTH REGION ANALYSIS',
        flush=True
    )

    print(
        '==========================================',
        flush=True
    )

    print(
        f'Accepted regions: '
        f'{len(accepted)}',
        flush=True
    )

    print('')

    for region in accepted:

        mean_bgr = (
            region[
                'mean_bgr'
            ]
        )

        print(
            f"R{region['id']:02d} | "
            f"area={region['area']} | "
            f"box=({region['x']},"
            f"{region['y']},"
            f"{region['w']},"
            f"{region['h']}) | "
            f"variation="
            f"{region['variation']:.2f} | "
            f"meanRGB=("
            f"{mean_bgr[2]:.0f},"
            f"{mean_bgr[1]:.0f},"
            f"{mean_bgr[0]:.0f})",
            flush=True
        )

    # ------------------------------------------------------
    # PREVIEW
    # ------------------------------------------------------

    preview = build_preview(
        image,
        accepted
    )

    if not cv2.imwrite(
        preview_path,
        preview
    ):

        raise RuntimeError(
            'Region preview save nahi hui'
        )

    # ------------------------------------------------------
    # LABEL IMAGE
    # ------------------------------------------------------

    # 16-bit image:
    # 0 = no accepted region
    # 1 = R1, 2 = R2, etc.
    label_output = np.zeros(
        (
            height,
            width
        ),
        dtype=np.uint16
    )

    for region in accepted:

        label_output[
            region['mask'] >
            0
        ] = region['id']

    if not cv2.imwrite(
        labels_path,
        label_output
    ):

        raise RuntimeError(
            'Region label image save nahi hui'
        )

    print('')
    print(
        f'Preview: {preview_path}',
        flush=True
    )

    print(
        f'Labels:  {labels_path}',
        flush=True
    )

    print(
        'Smooth region analysis complete.',
        flush=True
    )


# ==========================================================
# CLI
# ==========================================================

if __name__ == '__main__':

    if len(sys.argv) != 5:

        print(
            'Usage: python '
            'smooth-region-analyzer.py '
            'test.jpg '
            'gradient-safe-mask.png '
            'smooth-regions-preview.png '
            'smooth-region-labels.png',
            file=sys.stderr
        )

        sys.exit(1)

    try:

        analyze(
            sys.argv[1],
            sys.argv[2],
            sys.argv[3],
            sys.argv[4]
        )

    except Exception as error:

        print(
            str(error),
            file=sys.stderr
        )

        sys.exit(1)