import sys
import cv2
import numpy as np


# ==========================================================
# CONFIGURATION
# ==========================================================

MAX_SIZE = 1400

# Edge detection tuned for anime / illustration.
# Previous:
# EDGE_LOW = 18
# EDGE_HIGH = 55
#
# New values background ke weak/noisy edges ko
# detail area banne se reduce karte hain.
EDGE_LOW = 22
EDGE_HIGH = 62


# Local texture analysis.
TEXTURE_WINDOW = 7

# Previous = 10.0
# New = 12.0
#
# Weak texture ko detail classify karna kam karega.
TEXTURE_THRESHOLD = 12.0


# Previous = 5
# New = 3
#
# Important boundaries ke around red/protected
# region ab thinner hoga.
DETAIL_DILATE_SIZE = 3


# Tiny isolated detail noise remove.
DETAIL_OPEN_SIZE = 3


# ==========================================================
# RESIZE IMAGE
# ==========================================================

def resize_image(
    image,
    max_size=MAX_SIZE
):

    height, width = image.shape[:2]

    largest = max(
        height,
        width
    )

    if largest <= max_size:
        return image

    scale = (
        max_size /
        float(largest)
    )

    new_width = max(
        1,
        int(
            round(
                width * scale
            )
        )
    )

    new_height = max(
        1,
        int(
            round(
                height * scale
            )
        )
    )

    return cv2.resize(
        image,
        (
            new_width,
            new_height
        ),
        interpolation=cv2.INTER_AREA
    )


# ==========================================================
# EDGE STRENGTH MAP
# ==========================================================

def create_edge_strength(
    image
):

    # Convert to grayscale.
    gray = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2GRAY
    )

    # Very light blur prevents single-pixel noise
    # from becoming important detail.
    gray = cv2.GaussianBlur(
        gray,
        (3, 3),
        0
    )


    # Horizontal edges.
    gx = cv2.Sobel(
        gray,
        cv2.CV_32F,
        1,
        0,
        ksize=3
    )


    # Vertical edges.
    gy = cv2.Sobel(
        gray,
        cv2.CV_32F,
        0,
        1,
        ksize=3
    )


    # Combined edge magnitude.
    magnitude = cv2.magnitude(
        gx,
        gy
    )


    # Robust normalization.
    #
    # Direct max() use nahi karte because ek extremely
    # strong edge baaki complete image ko suppress kar
    # sakta hai.
    percentile = float(
        np.percentile(
            magnitude,
            99.0
        )
    )


    if percentile <= 0:

        return np.zeros_like(
            gray,
            dtype=np.uint8
        )


    normalized = (
        magnitude /
        percentile *
        255.0
    )


    normalized = np.clip(
        normalized,
        0,
        255
    )


    return normalized.astype(
        np.uint8
    )


# ==========================================================
# LOCAL TEXTURE MAP
# ==========================================================

def create_texture_map(
    image
):

    gray = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2GRAY
    ).astype(
        np.float32
    )


    kernel_size = (
        TEXTURE_WINDOW,
        TEXTURE_WINDOW
    )


    # Local mean.
    mean = cv2.blur(
        gray,
        kernel_size
    )


    # Local squared mean.
    mean_squared = cv2.blur(
        gray * gray,
        kernel_size
    )


    # Variance:
    #
    # E[x²] - E[x]²
    variance = (
        mean_squared -
        mean * mean
    )


    # Numerical safety.
    variance = np.maximum(
        variance,
        0
    )


    # Standard deviation gives local texture strength.
    stddev = np.sqrt(
        variance
    )


    return stddev


# ==========================================================
# CREATE DETAIL MASK
# ==========================================================

def create_detail_mask(
    image
):

    # ------------------------------------------------------
    # EDGE MAP
    # ------------------------------------------------------

    edge = create_edge_strength(
        image
    )


    # ------------------------------------------------------
    # TEXTURE MAP
    # ------------------------------------------------------

    texture = create_texture_map(
        image
    )


    # ------------------------------------------------------
    # STRONG EDGES
    # ------------------------------------------------------

    # Hair boundaries, eyes, fingers, collar etc.
    strong_edges = (
        edge >= EDGE_HIGH
    )


    # ------------------------------------------------------
    # MEDIUM EDGES + TEXTURE
    # ------------------------------------------------------

    # Medium edge ko tabhi preserve karenge agar
    # surrounding area mein useful texture bhi ho.
    medium_edges = (
        (edge >= EDGE_LOW)
        &
        (
            texture >=
            TEXTURE_THRESHOLD
        )
    )


    # ------------------------------------------------------
    # HIGH TEXTURE
    # ------------------------------------------------------

    # Eyes/hair/detail areas mein texture strong ho
    # sakta hai even when one particular Sobel edge weak ho.
    textured = (
        texture >=
        TEXTURE_THRESHOLD * 1.7
    )


    # ------------------------------------------------------
    # COMBINE
    # ------------------------------------------------------

    detail = (
        strong_edges
        |
        medium_edges
        |
        textured
    ).astype(
        np.uint8
    ) * 255


    # ------------------------------------------------------
    # REMOVE TINY NOISE
    # ------------------------------------------------------

    open_kernel = (
        cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (
                DETAIL_OPEN_SIZE,
                DETAIL_OPEN_SIZE
            )
        )
    )


    detail = cv2.morphologyEx(
        detail,
        cv2.MORPH_OPEN,
        open_kernel
    )


    # ------------------------------------------------------
    # PROTECT A SMALL AREA AROUND REAL EDGES
    # ------------------------------------------------------

    # V1 used 5x5 dilation.
    #
    # V2 uses 3x3, so protection halo is thinner.
    dilate_kernel = (
        cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (
                DETAIL_DILATE_SIZE,
                DETAIL_DILATE_SIZE
            )
        )
    )


    detail = cv2.dilate(
        detail,
        dilate_kernel,
        iterations=1
    )


    return (
        detail,
        edge,
        texture
    )


# ==========================================================
# CREATE PREVIEW
# ==========================================================

def make_preview(
    image,
    detail_mask
):

    preview = image.copy()


    # Pure red overlay.
    overlay = np.zeros_like(
        image
    )

    overlay[
        :,
        :,
        2
    ] = 255


    # Red overlay transparency.
    alpha = 0.35


    protected = (
        detail_mask > 0
    )


    preview_float = (
        preview.astype(
            np.float32
        )
    )


    overlay_float = (
        overlay.astype(
            np.float32
        )
    )


    preview_float[
        protected
    ] = (
        preview_float[
            protected
        ]
        *
        (1.0 - alpha)
        +
        overlay_float[
            protected
        ]
        *
        alpha
    )


    return np.clip(
        preview_float,
        0,
        255
    ).astype(
        np.uint8
    )


# ==========================================================
# PROCESS IMAGE
# ==========================================================

def process(
    input_path,
    mask_output_path,
    preview_output_path
):

    # ------------------------------------------------------
    # READ IMAGE
    # ------------------------------------------------------

    image = cv2.imread(
        input_path,
        cv2.IMREAD_COLOR
    )


    if image is None:

        raise RuntimeError(
            'Input image read nahi ho saki'
        )


    # ------------------------------------------------------
    # RESIZE
    # ------------------------------------------------------

    image = resize_image(
        image
    )


    print(
        f'Image size: '
        f'{image.shape[1]}x'
        f'{image.shape[0]}',
        flush=True
    )


    # ------------------------------------------------------
    # DETAIL DETECTION
    # ------------------------------------------------------

    (
        detail_mask,
        edge,
        texture
    ) = create_detail_mask(
        image
    )


    # ------------------------------------------------------
    # STATISTICS
    # ------------------------------------------------------

    total_pixels = (
        detail_mask.shape[0]
        *
        detail_mask.shape[1]
    )


    detail_pixels = int(
        np.count_nonzero(
            detail_mask
        )
    )


    detail_percent = (
        detail_pixels /
        total_pixels *
        100.0
    )


    smooth_percent = (
        100.0 -
        detail_percent
    )


    print(
        f'Detail/protected area: '
        f'{detail_percent:.2f}%',
        flush=True
    )


    print(
        f'Smooth candidate area: '
        f'{smooth_percent:.2f}%',
        flush=True
    )


    # ------------------------------------------------------
    # PREVIEW
    # ------------------------------------------------------

    preview = make_preview(
        image,
        detail_mask
    )


    # ------------------------------------------------------
    # SAVE DETAIL MASK
    # ------------------------------------------------------

    success_mask = cv2.imwrite(
        mask_output_path,
        detail_mask,
        [
            cv2.IMWRITE_PNG_COMPRESSION,
            6
        ]
    )


    if not success_mask:

        raise RuntimeError(
            'Detail mask save nahi hui'
        )


    # ------------------------------------------------------
    # SAVE PREVIEW
    # ------------------------------------------------------

    success_preview = cv2.imwrite(
        preview_output_path,
        preview,
        [
            cv2.IMWRITE_PNG_COMPRESSION,
            6
        ]
    )


    if not success_preview:

        raise RuntimeError(
            'Detail preview save nahi hui'
        )


    print(
        'Detail map complete.',
        flush=True
    )


# ==========================================================
# COMMAND LINE
# ==========================================================

if __name__ == '__main__':

    if len(sys.argv) != 4:

        print(
            'Usage: python detail_map.py '
            'input_image '
            'detail_mask.png '
            'preview.png',
            file=sys.stderr
        )

        sys.exit(1)


    try:

        process(
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