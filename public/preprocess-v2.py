import sys
import cv2
import numpy as np


# ==========================================================
# CONFIG
# ==========================================================

MAX_SIZE = 1600
NUM_COLORS = 40

# Current V1 baseline
MIN_REGION_PIXELS = 18
MERGE_COLOR_DISTANCE = 24.0
DARK_PROTECTION_L = 65

# V2 spatial cleanup
SPATIAL_PASSES = 2

# Pixel ko tabhi neighbour label denge jab strong
# neighbourhood agreement ho.
MIN_NEIGHBOR_AGREEMENT = 5

# Edge pixels par cleanup aur stricter hoga.
EDGE_THRESHOLD = 34

# Strong edge par almost no relabeling.
STRONG_EDGE_THRESHOLD = 70

# Color distance limit for spatial relabel.
SMOOTH_RELABEL_DISTANCE = 18.0
EDGE_RELABEL_DISTANCE = 8.0


# ==========================================================
# RESIZE
# ==========================================================

def resize_image(image, max_size=MAX_SIZE):

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
        int(round(width * scale))
    )

    new_height = max(
        1,
        int(round(height * scale))
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
# FILTER
# ==========================================================

def edge_preserving_filter(image):

    return cv2.bilateralFilter(
        image,
        d=7,
        sigmaColor=25,
        sigmaSpace=7
    )


# ==========================================================
# EDGE STRENGTH
# ==========================================================

def edge_strength(image):

    gray = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2GRAY
    )

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

    return np.clip(
        normalized,
        0,
        255
    ).astype(np.uint8)


# ==========================================================
# LAB K-MEANS
# ==========================================================

def quantize_lab(
    image,
    number_of_colors=NUM_COLORS
):

    lab = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2LAB
    )

    height, width = lab.shape[:2]

    pixels = lab.reshape(
        (-1, 3)
    ).astype(np.float32)

    criteria = (
        cv2.TERM_CRITERIA_EPS +
        cv2.TERM_CRITERIA_MAX_ITER,
        35,
        0.4
    )

    cv2.setRNGSeed(
        12345
    )

    _, labels, centers = cv2.kmeans(
        pixels,
        number_of_colors,
        None,
        criteria,
        4,
        cv2.KMEANS_PP_CENTERS
    )

    labels = labels.reshape(
        (
            height,
            width
        )
    )

    centers = np.clip(
        centers,
        0,
        255
    ).astype(np.uint8)

    return (
        labels,
        centers
    )


# ==========================================================
# COLOR DISTANCE
# ==========================================================

def lab_distance(
    first,
    second
):

    a = first.astype(
        np.float32
    )

    b = second.astype(
        np.float32
    )

    return float(
        np.linalg.norm(
            a - b
        )
    )


# ==========================================================
# NEIGHBOUR LABELS
# ==========================================================

def get_neighbor_labels(
    labels,
    component_mask
):

    mask = (
        component_mask.astype(
            np.uint8
        ) * 255
    )

    kernel = np.ones(
        (3, 3),
        dtype=np.uint8
    )

    dilated = cv2.dilate(
        mask,
        kernel,
        iterations=1
    )

    border = (
        (dilated > 0)
        &
        (~component_mask)
    )

    if not np.any(
        border
    ):
        return []

    return np.unique(
        labels[border]
    ).tolist()


# ==========================================================
# SMALL COMPONENT CLEANUP
# ==========================================================

def merge_small_regions(
    labels,
    centers
):

    cleaned = labels.copy()

    height, width = (
        cleaned.shape
    )

    total_pixels = (
        height * width
    )

    adaptive_minimum = int(
        total_pixels *
        0.000012
    )

    min_region = max(
        MIN_REGION_PIXELS,
        adaptive_minimum
    )

    kernel = np.ones(
        (3, 3),
        dtype=np.uint8
    )

    for _ in range(2):

        changed = 0

        for color_index in range(
            len(centers)
        ):

            mask = (
                cleaned ==
                color_index
            ).astype(
                np.uint8
            )

            if not np.any(
                mask
            ):
                continue

            (
                count,
                component_map,
                stats,
                _
            ) = cv2.connectedComponentsWithStats(
                mask,
                connectivity=8
            )

            source_color = centers[
                color_index
            ]

            source_l = int(
                source_color[0]
            )

            for component_id in range(
                1,
                count
            ):

                area = int(
                    stats[
                        component_id,
                        cv2.CC_STAT_AREA
                    ]
                )

                if area >= min_region:
                    continue

                if (
                    source_l <=
                    DARK_PROTECTION_L
                ):

                    dark_minimum = max(
                        5,
                        min_region // 3
                    )

                    if (
                        area >=
                        dark_minimum
                    ):
                        continue

                component_mask = (
                    component_map ==
                    component_id
                )

                neighbours = (
                    get_neighbor_labels(
                        cleaned,
                        component_mask
                    )
                )

                neighbours = [
                    int(value)
                    for value in neighbours
                    if int(value) !=
                    color_index
                ]

                if not neighbours:
                    continue

                component_u8 = (
                    component_mask.astype(
                        np.uint8
                    ) * 255
                )

                dilated = cv2.dilate(
                    component_u8,
                    kernel,
                    iterations=1
                )

                border = (
                    (dilated > 0)
                    &
                    (~component_mask)
                )

                best_label = None
                best_score = float(
                    'inf'
                )

                for neighbor in neighbours:

                    distance = (
                        lab_distance(
                            source_color,
                            centers[neighbor]
                        )
                    )

                    touching = int(
                        np.count_nonzero(
                            border
                            &
                            (
                                cleaned ==
                                neighbor
                            )
                        )
                    )

                    if touching <= 0:
                        continue

                    score = (
                        distance -
                        min(
                            touching,
                            20
                        ) * 0.08
                    )

                    if score < best_score:

                        best_score = score
                        best_label = neighbor

                if best_label is None:
                    continue

                allowed = (
                    MERGE_COLOR_DISTANCE
                )

                if (
                    source_l <=
                    DARK_PROTECTION_L
                ):
                    allowed = min(
                        allowed,
                        12.0
                    )

                distance = (
                    lab_distance(
                        source_color,
                        centers[
                            best_label
                        ]
                    )
                )

                if (
                    distance <=
                    allowed
                ):

                    cleaned[
                        component_mask
                    ] = best_label

                    changed += 1

        if changed == 0:
            break

    return cleaned


# ==========================================================
# EDGE-AWARE SPATIAL REGULARIZATION
# ==========================================================

def spatial_regularize(
    labels,
    centers,
    edges
):

    result = labels.copy()

    height, width = (
        result.shape
    )

    centers_f = (
        centers.astype(
            np.float32
        )
    )

    for _ in range(
        SPATIAL_PASSES
    ):

        source = result.copy()

        padded = np.pad(
            source,
            1,
            mode='edge'
        )

        changes = []

        for y in range(
            height
        ):

            for x in range(
                width
            ):

                edge_value = int(
                    edges[y, x]
                )

                # Real line/strong boundary:
                # do not touch.
                if (
                    edge_value >=
                    STRONG_EDGE_THRESHOLD
                ):
                    continue

                current = int(
                    source[y, x]
                )

                # Protect dark line-art labels.
                if (
                    int(
                        centers[current][0]
                    )
                    <= DARK_PROTECTION_L
                ):
                    continue

                neighbourhood = padded[
                    y:y + 3,
                    x:x + 3
                ].reshape(-1)

                values, counts = (
                    np.unique(
                        neighbourhood,
                        return_counts=True
                    )
                )

                best_position = int(
                    np.argmax(
                        counts
                    )
                )

                dominant = int(
                    values[
                        best_position
                    ]
                )

                agreement = int(
                    counts[
                        best_position
                    ]
                )

                if (
                    dominant ==
                    current
                ):
                    continue

                if (
                    agreement <
                    MIN_NEIGHBOR_AGREEMENT
                ):
                    continue

                current_color = (
                    centers_f[current]
                )

                dominant_color = (
                    centers_f[dominant]
                )

                distance = float(
                    np.linalg.norm(
                        current_color -
                        dominant_color
                    )
                )

                allowed = (
                    EDGE_RELABEL_DISTANCE
                    if
                    edge_value >= EDGE_THRESHOLD
                    else
                    SMOOTH_RELABEL_DISTANCE
                )

                if (
                    distance >
                    allowed
                ):
                    continue

                changes.append(
                    (
                        y,
                        x,
                        dominant
                    )
                )

        if not changes:
            break

        for (
            y,
            x,
            label
        ) in changes:

            result[
                y,
                x
            ] = label

    return result


# ==========================================================
# MICRO CLEANUP
# ==========================================================

def final_micro_cleanup(
    labels
):

    result = labels.copy()

    height, width = (
        result.shape
    )

    padded = np.pad(
        result,
        1,
        mode='edge'
    )

    center = padded[
        1:height + 1,
        1:width + 1
    ]

    top = padded[
        0:height,
        1:width + 1
    ]

    bottom = padded[
        2:height + 2,
        1:width + 1
    ]

    left = padded[
        1:height + 1,
        0:width
    ]

    right = padded[
        1:height + 1,
        2:width + 2
    ]

    surrounded = (
        (top == bottom)
        &
        (top == left)
        &
        (top == right)
    )

    isolated = (
        surrounded
        &
        (center != top)
    )

    result[
        isolated
    ] = top[
        isolated
    ]

    return result


# ==========================================================
# LABELS -> IMAGE
# ==========================================================

def labels_to_bgr(
    labels,
    centers
):

    lab = centers[
        labels
    ].astype(
        np.uint8
    )

    return cv2.cvtColor(
        lab,
        cv2.COLOR_LAB2BGR
    )


# ==========================================================
# MAIN
# ==========================================================

def preprocess(
    input_path,
    output_path
):

    print(
        'Reading image...',
        flush=True
    )

    original = cv2.imread(
        input_path,
        cv2.IMREAD_COLOR
    )

    if original is None:
        raise RuntimeError(
            'Input image read nahi ho saki'
        )

    original = resize_image(
        original
    )

    print(
        f'Processing size: '
        f'{original.shape[1]}x'
        f'{original.shape[0]}',
        flush=True
    )


    # ------------------------------------------------------
    # EDGE MAP BEFORE QUANTIZATION
    # ------------------------------------------------------

    print(
        'Building edge protection map...',
        flush=True
    )

    edges = edge_strength(
        original
    )


    # ------------------------------------------------------
    # FILTER
    # ------------------------------------------------------

    print(
        'Edge-preserving smoothing...',
        flush=True
    )

    filtered = (
        edge_preserving_filter(
            original
        )
    )


    # ------------------------------------------------------
    # QUANTIZATION
    # ------------------------------------------------------

    print(
        f'LAB quantization: '
        f'{NUM_COLORS} colors...',
        flush=True
    )

    (
        labels,
        centers
    ) = quantize_lab(
        filtered
    )


    # ------------------------------------------------------
    # COMPONENT CLEANUP
    # ------------------------------------------------------

    print(
        'Merging tiny similar regions...',
        flush=True
    )

    labels = merge_small_regions(
        labels,
        centers
    )


    # ------------------------------------------------------
    # SPATIAL REGULARIZATION
    # ------------------------------------------------------

    print(
        'Edge-aware spatial cleanup...',
        flush=True
    )

    labels = spatial_regularize(
        labels,
        centers,
        edges
    )


    # ------------------------------------------------------
    # SINGLE PIXELS
    # ------------------------------------------------------

    labels = final_micro_cleanup(
        labels
    )


    # ------------------------------------------------------
    # REBUILD
    # ------------------------------------------------------

    result = labels_to_bgr(
        labels,
        centers
    )


    success = cv2.imwrite(
        output_path,
        result,
        [
            cv2.IMWRITE_PNG_COMPRESSION,
            6
        ]
    )

    if not success:
        raise RuntimeError(
            'Output save nahi hui'
        )

    print(
        'Preprocess V2 complete.',
        flush=True
    )


# ==========================================================
# CLI
# ==========================================================

if __name__ == '__main__':

    if len(sys.argv) != 3:

        print(
            'Usage: python preprocess-v2.py '
            'input.png processed-v2.png',
            file=sys.stderr
        )

        sys.exit(1)

    try:

        preprocess(
            sys.argv[1],
            sys.argv[2]
        )

    except Exception as error:

        print(
            str(error),
            file=sys.stderr
        )

        sys.exit(1)