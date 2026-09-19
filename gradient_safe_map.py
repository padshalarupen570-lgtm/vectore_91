import sys
import cv2
import numpy as np


# ==========================================================
# CONFIG
# ==========================================================

MAX_SIZE = 1600

# Strong structural edges:
# hair boundaries, eyes, fingers, collar, etc.
STRONG_EDGE_THRESHOLD = 54

# Medium edge ko texture ke saath protect karenge.
MEDIUM_EDGE_THRESHOLD = 28

# Local texture analysis.
TEXTURE_WINDOW = 7

# Higher value = fewer areas protected as texture.
TEXTURE_THRESHOLD = 11.0

# Important edge ke around protection halo.
EDGE_DILATE = 5

# Gradient-safe mask ke small gaps close karne ke liye.
SAFE_CLOSE = 7

# Tiny isolated smooth areas ko gradient candidate nahi banayenge.
MIN_SAFE_COMPONENT = 180


# ==========================================================
# RESIZE
# ==========================================================

def resize_image(
    image,
    max_size=MAX_SIZE
):

    height, width = image.shape[:2]

    largest = max(
        width,
        height
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
# EDGE MAP
# ==========================================================

def create_edge_map(
    image
):

    gray = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2GRAY
    )

    # Small blur suppresses single-pixel noise.
    gray = cv2.GaussianBlur(
        gray,
        (3, 3),
        0
    )

    gx = cv2.Sobel(
        gray,
        cv2.CV_32F,
        1,
        0,
        ksize=3
    )

    gy = cv2.Sobel(
        gray,
        cv2.CV_32F,
        0,
        1,
        ksize=3
    )

    magnitude = cv2.magnitude(
        gx,
        gy
    )

    # Robust normalization.
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
# LOCAL COLOR TEXTURE
# ==========================================================

def create_texture_map(
    image
):

    # LAB gives us both brightness and chromatic variation.
    lab = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2LAB
    ).astype(
        np.float32
    )

    channels = cv2.split(
        lab
    )

    kernel = (
        TEXTURE_WINDOW,
        TEXTURE_WINDOW
    )

    texture_channels = []

    # Calculate local standard deviation independently
    # for L, A and B channels.
    for channel in channels:

        local_mean = cv2.blur(
            channel,
            kernel
        )

        local_squared_mean = cv2.blur(
            channel * channel,
            kernel
        )

        local_variance = (
            local_squared_mean
            -
            local_mean *
            local_mean
        )

        local_variance = np.maximum(
            local_variance,
            0
        )

        local_std = np.sqrt(
            local_variance
        )

        texture_channels.append(
            local_std
        )

    # Simple LAB-channel average is sufficient
    # for this diagnostic mask.
    texture = (
        texture_channels[0]
        +
        texture_channels[1]
        +
        texture_channels[2]
    ) / 3.0

    return texture


# ==========================================================
# PROTECTED DETAIL MASK
# ==========================================================

def create_protection_mask(
    edge,
    texture
):

    # Very strong boundary is protected regardless
    # of local texture.
    strong_edges = (
        edge >=
        STRONG_EDGE_THRESHOLD
    )

    # Medium edge only gets protected when some local
    # color/texture variation also exists.
    medium_detail = (
        (
            edge >=
            MEDIUM_EDGE_THRESHOLD
        )
        &
        (
            texture >=
            TEXTURE_THRESHOLD * 0.65
        )
    )

    # Highly textured areas are unsuitable for one
    # smooth SVG gradient even without a strong edge.
    strong_texture = (
        texture >=
        TEXTURE_THRESHOLD
    )

    protected = (
        strong_edges
        |
        medium_detail
        |
        strong_texture
    ).astype(
        np.uint8
    ) * 255

    # Give important boundaries a protection margin.
    dilate_kernel = (
        cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (
                EDGE_DILATE,
                EDGE_DILATE
            )
        )
    )

    protected = cv2.dilate(
        protected,
        dilate_kernel,
        iterations=1
    )

    return protected


# ==========================================================
# SAFE MASK CLEANUP
# ==========================================================

def clean_safe_mask(
    safe
):

    # Close very small holes/gaps inside otherwise
    # continuous smooth areas.
    close_kernel = (
        cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (
                SAFE_CLOSE,
                SAFE_CLOSE
            )
        )
    )

    safe = cv2.morphologyEx(
        safe,
        cv2.MORPH_CLOSE,
        close_kernel
    )

    # Find separate safe components.
    (
        component_count,
        labels,
        stats,
        _
    ) = cv2.connectedComponentsWithStats(
        (
            safe > 0
        ).astype(
            np.uint8
        ),
        connectivity=8
    )

    cleaned = np.zeros_like(
        safe
    )

    # Keep only meaningful-sized smooth regions.
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
            MIN_SAFE_COMPONENT
        ):
            continue

        cleaned[
            labels ==
            component
        ] = 255

    return cleaned


# ==========================================================
# PREVIEW
# ==========================================================

def make_preview(
    image,
    safe_mask,
    protected_mask
):

    preview = image.astype(
        np.float32
    )

    safe = (
        safe_mask > 0
    )

    protected = (
        protected_mask > 0
    )

    # ------------------------------------------------------
    # GREEN = smooth / potential gradient area
    # ------------------------------------------------------

    green_overlay = np.zeros_like(
        preview
    )

    # OpenCV uses BGR.
    green_overlay[
        :,
        :,
        1
    ] = 255

    preview[
        safe
    ] = (
        preview[
            safe
        ] * 0.64
        +
        green_overlay[
            safe
        ] * 0.36
    )

    # ------------------------------------------------------
    # RED = protected detail / boundary
    # ------------------------------------------------------

    red_overlay = np.zeros_like(
        preview
    )

    # OpenCV BGR -> channel 2 = red.
    red_overlay[
        :,
        :,
        2
    ] = 255

    preview[
        protected
    ] = (
        preview[
            protected
        ] * 0.72
        +
        red_overlay[
            protected
        ] * 0.28
    )

    return np.clip(
        preview,
        0,
        255
    ).astype(
        np.uint8
    )


# ==========================================================
# PROCESS
# ==========================================================

def process(
    input_path,
    safe_output_path,
    protected_output_path,
    preview_output_path
):

    # ------------------------------------------------------
    # READ
    # ------------------------------------------------------

    print(
        'Reading original image...',
        flush=True
    )

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

    height, width = (
        image.shape[:2]
    )

    print(
        f'Image size: '
        f'{width}x{height}',
        flush=True
    )

    # ------------------------------------------------------
    # EDGE ANALYSIS
    # ------------------------------------------------------

    print(
        'Analyzing structural edges...',
        flush=True
    )

    edge = create_edge_map(
        image
    )

    # ------------------------------------------------------
    # TEXTURE ANALYSIS
    # ------------------------------------------------------

    print(
        'Analyzing local texture...',
        flush=True
    )

    texture = create_texture_map(
        image
    )

    # ------------------------------------------------------
    # PROTECTED DETAILS
    # ------------------------------------------------------

    print(
        'Building protected-detail mask...',
        flush=True
    )

    protected = create_protection_mask(
        edge,
        texture
    )

    # ------------------------------------------------------
    # GRADIENT SAFE REGION
    # ------------------------------------------------------

    # Everything not protected is initially considered
    # smooth candidate area.
    safe = cv2.bitwise_not(
        protected
    )

    safe = clean_safe_mask(
        safe
    )

    # Make sure cleanup never puts a safe pixel back
    # on top of a protected pixel.
    safe[
        protected > 0
    ] = 0

    # ------------------------------------------------------
    # STATISTICS
    # ------------------------------------------------------

    total_pixels = (
        width *
        height
    )

    safe_pixels = int(
        np.count_nonzero(
            safe
        )
    )

    protected_pixels = int(
        np.count_nonzero(
            protected
        )
    )

    safe_percent = (
        safe_pixels /
        total_pixels *
        100.0
    )

    protected_percent = (
        protected_pixels /
        total_pixels *
        100.0
    )

    print(
        f'Gradient-safe area: '
        f'{safe_percent:.2f}%',
        flush=True
    )

    print(
        f'Protected/detail area: '
        f'{protected_percent:.2f}%',
        flush=True
    )

    # ------------------------------------------------------
    # PREVIEW
    # ------------------------------------------------------

    preview = make_preview(
        image,
        safe,
        protected
    )

    # ------------------------------------------------------
    # SAVE SAFE MASK
    # ------------------------------------------------------

    success_safe = cv2.imwrite(
        safe_output_path,
        safe,
        [
            cv2.IMWRITE_PNG_COMPRESSION,
            6
        ]
    )

    if not success_safe:

        raise RuntimeError(
            'Gradient-safe mask save nahi hui'
        )

    # ------------------------------------------------------
    # SAVE PROTECTED MASK
    # ------------------------------------------------------

    success_protected = cv2.imwrite(
        protected_output_path,
        protected,
        [
            cv2.IMWRITE_PNG_COMPRESSION,
            6
        ]
    )

    if not success_protected:

        raise RuntimeError(
            'Protected mask save nahi hui'
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
            'Preview save nahi hui'
        )

    print(
        'Gradient-safe analysis complete.',
        flush=True
    )


# ==========================================================
# COMMAND LINE
# ==========================================================

if __name__ == '__main__':

    if len(sys.argv) != 5:

        print(
            'Usage: python gradient_safe_map.py '
            'input.jpg '
            'gradient-safe-mask.png '
            'protected-mask.png '
            'gradient-safe-preview.png',
            file=sys.stderr
        )

        sys.exit(1)

    try:

        process(
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