import sys
import cv2
import numpy as np


# ==========================================================
# CONFIGURATION
# ==========================================================

MAX_SIZE = 1600
NUM_COLORS = 40

MIN_REGION_PIXELS = 18
MERGE_COLOR_DISTANCE = 24.0
DARK_PROTECTION_L = 65


# ==========================================================
# RESIZE
# ==========================================================

def resize_image(image, max_size=MAX_SIZE):

    height, width = image.shape[:2]

    largest_side = max(width, height)

    if largest_side <= max_size:
        return image

    scale = max_size / float(largest_side)

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
        (new_width, new_height),
        interpolation=cv2.INTER_AREA
    )


# ==========================================================
# EDGE-PRESERVING FILTER
# ==========================================================

def edge_preserving_filter(image):

    return cv2.bilateralFilter(
        image,
        d=7,
        sigmaColor=25,
        sigmaSpace=7
    )


# ==========================================================
# LAB K-MEANS COLOR QUANTIZATION
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

    cv2.setRNGSeed(12345)

    compactness, labels, centers = cv2.kmeans(
        pixels,
        number_of_colors,
        None,
        criteria,
        4,
        cv2.KMEANS_PP_CENTERS
    )

    labels = labels.reshape(
        (height, width)
    )

    centers = np.clip(
        centers,
        0,
        255
    ).astype(np.uint8)

    quantized = centers[
        labels
    ]

    return (
        quantized,
        labels,
        centers
    )


# ==========================================================
# LAB COLOR DISTANCE
# ==========================================================

def lab_distance(
    color_a,
    color_b
):

    a = color_a.astype(
        np.float32
    )

    b = color_b.astype(
        np.float32
    )

    return float(
        np.linalg.norm(a - b)
    )


# ==========================================================
# FIND NEIGHBOURING LABELS
# ==========================================================

def get_neighbor_labels(
    labels,
    component_mask
):

    mask_uint8 = (
        component_mask.astype(np.uint8)
        * 255
    )

    kernel = np.ones(
        (3, 3),
        dtype=np.uint8
    )

    dilated = cv2.dilate(
        mask_uint8,
        kernel,
        iterations=1
    )

    border = (
        (dilated > 0)
        &
        (~component_mask)
    )

    if not np.any(border):
        return []

    values = labels[
        border
    ]

    unique_labels = np.unique(
        values
    )

    return unique_labels.tolist()


# ==========================================================
# SMALL REGION MERGING
# ==========================================================

def merge_small_regions(
    labels,
    centers
):

    cleaned = labels.copy()

    height, width = labels.shape

    total_pixels = (
        height * width
    )

    adaptive_minimum = int(
        total_pixels * 0.000012
    )

    min_region = max(
        MIN_REGION_PIXELS,
        adaptive_minimum
    )

    number_of_colors = len(
        centers
    )

    kernel = np.ones(
        (3, 3),
        dtype=np.uint8
    )

    # Do cleanup passes
    for pass_index in range(2):

        changed = 0

        for color_index in range(
            number_of_colors
        ):

            mask = (
                cleaned == color_index
            ).astype(np.uint8)

            if not np.any(mask):
                continue

            (
                component_count,
                component_map,
                stats,
                centroids
            ) = cv2.connectedComponentsWithStats(
                mask,
                connectivity=8
            )

            source_color = centers[
                color_index
            ]

            for component_id in range(
                1,
                component_count
            ):

                area = int(
                    stats[
                        component_id,
                        cv2.CC_STAT_AREA
                    ]
                )

                # Large regions preserve
                if area >= min_region:
                    continue

                component_mask = (
                    component_map ==
                    component_id
                )

                source_l = int(
                    source_color[0]
                )

                # Protect important dark details
                if (
                    source_l <=
                    DARK_PROTECTION_L
                ):

                    dark_minimum = max(
                        5,
                        min_region // 3
                    )

                    if area >= dark_minimum:
                        continue

                neighbor_labels = (
                    get_neighbor_labels(
                        cleaned,
                        component_mask
                    )
                )

                neighbor_labels = [
                    value
                    for value
                    in neighbor_labels
                    if value != color_index
                ]

                if not neighbor_labels:
                    continue

                best_label = None
                best_score = float(
                    'inf'
                )

                component_u8 = (
                    component_mask.astype(
                        np.uint8
                    )
                    * 255
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

                # Find best neighbouring region
                for neighbor in neighbor_labels:

                    neighbor = int(
                        neighbor
                    )

                    neighbor_color = centers[
                        neighbor
                    ]

                    distance = lab_distance(
                        source_color,
                        neighbor_color
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

                    # Similar color + larger shared
                    # boundary gets preference
                    score = (
                        distance
                        -
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

                actual_distance = (
                    lab_distance(
                        source_color,
                        centers[
                            best_label
                        ]
                    )
                )

                allowed_distance = (
                    MERGE_COLOR_DISTANCE
                )

                # Dark lines/details ke liye
                # stricter merging
                if (
                    source_l <=
                    DARK_PROTECTION_L
                ):

                    allowed_distance = min(
                        allowed_distance,
                        12.0
                    )

                if (
                    actual_distance <=
                    allowed_distance
                ):

                    cleaned[
                        component_mask
                    ] = best_label

                    changed += 1

        if changed == 0:
            break

    return cleaned


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

    same_neighbours = (
        (top == bottom)
        &
        (top == left)
        &
        (top == right)
    )

    isolated = (
        same_neighbours
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
# LABELS TO IMAGE
# ==========================================================

def labels_to_bgr(
    labels,
    centers
):

    quantized_lab = centers[
        labels
    ].astype(np.uint8)

    return cv2.cvtColor(
        quantized_lab,
        cv2.COLOR_LAB2BGR
    )


# ==========================================================
# MAIN PREPROCESSING
# ==========================================================

def preprocess(
    input_path,
    output_path
):

    print(
        'Reading image...',
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

    # ----------------------------------------------
    # STEP 1 - Resize
    # ----------------------------------------------

    image = resize_image(
        image,
        MAX_SIZE
    )

    print(
        f'Processing size: {image.shape[1]}x{image.shape[0]}',
        flush=True
    )

    # ----------------------------------------------
    # STEP 2 - Edge-preserving denoise
    # ----------------------------------------------

    print(
        'Edge-preserving smoothing...',
        flush=True
    )

    image = edge_preserving_filter(
        image
    )

    # ----------------------------------------------
    # STEP 3 - LAB color clustering
    # ----------------------------------------------

    print(
        f'LAB quantization: {NUM_COLORS} colors...',
        flush=True
    )

    (
        quantized_lab,
        labels,
        centers
    ) = quantize_lab(
        image,
        NUM_COLORS
    )

    # ----------------------------------------------
    # STEP 4 - Region merging
    # ----------------------------------------------

    print(
        'Merging small similar regions...',
        flush=True
    )

    labels = merge_small_regions(
        labels,
        centers
    )

    # ----------------------------------------------
    # STEP 5 - Micro cleanup
    # ----------------------------------------------

    print(
        'Removing isolated pixels...',
        flush=True
    )

    labels = final_micro_cleanup(
        labels
    )

    # ----------------------------------------------
    # STEP 6 - Rebuild final raster
    # ----------------------------------------------

    result = labels_to_bgr(
        labels,
        centers
    )

    # ----------------------------------------------
    # STEP 7 - Save
    # ----------------------------------------------

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
            'Processed PNG save nahi hui'
        )

    print(
        'Preprocessing complete.',
        flush=True
    )


# ==========================================================
# COMMAND LINE ENTRY
# ==========================================================

if __name__ == '__main__':

    if len(sys.argv) != 3:

        print(
            'Usage: python preprocess.py input.png output.png',
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