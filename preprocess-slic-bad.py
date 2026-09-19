import sys
import cv2
import numpy as np

from skimage.segmentation import slic
from skimage.color import rgb2lab


# ==========================================================
# CONFIG
# ==========================================================

MAX_SIZE = 1400

# Approx initial superpixels
SUPERPIXELS = 1800

# Higher = shapes more compact/geometric
# Lower = color boundaries more important
COMPACTNESS = 9.0

# SLIC smoothing
SLIC_SIGMA = 0.8

# Similar neighboring regions merge threshold
MERGE_DISTANCE = 8.0

# Smooth regions can merge slightly more aggressively
SMOOTH_MERGE_DISTANCE = 12.0

# Protect strong edges
EDGE_THRESHOLD = 32.0

# Number of merge passes
MERGE_PASSES = 4

# Very small final regions
MIN_REGION_AREA = 14


# ==========================================================
# RESIZE
# ==========================================================

def resize_image(image):

    height, width = image.shape[:2]

    largest = max(
        height,
        width
    )

    if largest <= MAX_SIZE:
        return image

    scale = (
        MAX_SIZE /
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
# EDGE-PRESERVING PREPROCESS
# ==========================================================

def preprocess_raster(image):

    # Bilateral filtering:
    # smooth noise but preserve major boundaries

    filtered = cv2.bilateralFilter(
        image,
        d=5,
        sigmaColor=20,
        sigmaSpace=5
    )

    return filtered


# ==========================================================
# EDGE MAP
# ==========================================================

def create_edge_map(image):

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

    max_value = float(
        magnitude.max()
    )

    if max_value > 0:

        magnitude = (
            magnitude /
            max_value *
            255.0
        )

    return magnitude.astype(
        np.float32
    )


# ==========================================================
# SLIC SEGMENTATION
# ==========================================================

def create_superpixels(image):

    rgb = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2RGB
    )

    rgb_float = (
        rgb.astype(
            np.float32
        ) /
        255.0
    )

    labels = slic(

        rgb_float,

        n_segments=SUPERPIXELS,

        compactness=COMPACTNESS,

        sigma=SLIC_SIGMA,

        start_label=0,

        convert2lab=True,

        enforce_connectivity=True,

        slic_zero=False
    )

    return labels.astype(
        np.int32
    )


# ==========================================================
# REGION STATISTICS
# ==========================================================

def calculate_region_data(
    labels,
    image
):

    rgb = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2RGB
    )

    lab = rgb2lab(
        rgb
    ).astype(
        np.float32
    )

    region_ids = np.unique(
        labels
    )

    colors = {}
    areas = {}

    for region_id in region_ids:

        mask = (
            labels ==
            region_id
        )

        area = int(
            np.count_nonzero(
                mask
            )
        )

        if area == 0:
            continue

        mean_color = np.mean(
            lab[mask],
            axis=0
        )

        colors[
            int(region_id)
        ] = mean_color.astype(
            np.float32
        )

        areas[
            int(region_id)
        ] = area

    return (
        lab,
        colors,
        areas
    )


# ==========================================================
# REGION NEIGHBORS
# ==========================================================

def build_adjacency(labels):

    adjacency = {}

    def add_pair(a, b):

        different = (
            a != b
        )

        aa = a[different]
        bb = b[different]

        for x, y in zip(
            aa.tolist(),
            bb.tolist()
        ):

            x = int(x)
            y = int(y)

            adjacency.setdefault(
                x,
                set()
            ).add(y)

            adjacency.setdefault(
                y,
                set()
            ).add(x)


    add_pair(
        labels[:, :-1],
        labels[:, 1:]
    )

    add_pair(
        labels[:-1, :],
        labels[1:, :]
    )

    return adjacency


# ==========================================================
# COLOR DISTANCE
# ==========================================================

def color_distance(a, b):

    return float(
        np.linalg.norm(
            a - b
        )
    )


# ==========================================================
# BOUNDARY EDGE STRENGTH
# ==========================================================

def boundary_strength(
    labels,
    region_a,
    region_b,
    edge_map
):

    mask_a = (
        labels ==
        region_a
    ).astype(
        np.uint8
    )

    kernel = np.ones(
        (3, 3),
        np.uint8
    )

    dilated_a = cv2.dilate(
        mask_a,
        kernel,
        iterations=1
    )

    boundary = (
        (dilated_a > 0)
        &
        (labels == region_b)
    )

    if not np.any(
        boundary
    ):

        return 255.0

    return float(
        np.mean(
            edge_map[
                boundary
            ]
        )
    )


# ==========================================================
# RELABEL CONTIGUOUSLY
# ==========================================================

def relabel_regions(labels):

    unique = np.unique(
        labels
    )

    output = np.zeros_like(
        labels,
        dtype=np.int32
    )

    for new_id, old_id in enumerate(
        unique
    ):

        output[
            labels ==
            old_id
        ] = new_id

    return output


# ==========================================================
# EDGE-AWARE REGION MERGING
# ==========================================================

def merge_regions(
    labels,
    image,
    edge_map
):

    result = labels.copy()

    for pass_number in range(
        MERGE_PASSES
    ):

        print(
            f'Region merge pass '
            f'{pass_number + 1}/{MERGE_PASSES}...',
            flush=True
        )

        (
            lab,
            colors,
            areas
        ) = calculate_region_data(
            result,
            image
        )

        adjacency = build_adjacency(
            result
        )

        candidates = sorted(
            colors.keys(),
            key=lambda region:
                areas.get(
                    region,
                    0
                )
        )

        changed = 0

        for region in candidates:

            if region not in colors:
                continue

            neighbours = adjacency.get(
                region,
                set()
            )

            if not neighbours:
                continue

            source_color = colors[
                region
            ]

            source_area = areas.get(
                region,
                0
            )

            best_neighbor = None
            best_score = float(
                'inf'
            )

            for neighbor in neighbours:

                if neighbor not in colors:
                    continue

                target_color = colors[
                    neighbor
                ]

                distance = color_distance(
                    source_color,
                    target_color
                )

                edge_strength = (
                    boundary_strength(
                        result,
                        region,
                        neighbor,
                        edge_map
                    )
                )

                # Strong edge = avoid merging.
                if (
                    edge_strength >=
                    EDGE_THRESHOLD
                ):
                    continue

                # Smooth boundary gets slightly
                # more generous color threshold.
                if edge_strength < 12:

                    allowed_distance = (
                        SMOOTH_MERGE_DISTANCE
                    )

                else:

                    allowed_distance = (
                        MERGE_DISTANCE
                    )

                # Tiny regions are more likely
                # accidental artifacts.
                if (
                    source_area <
                    MIN_REGION_AREA * 3
                ):

                    allowed_distance *= 1.25

                if (
                    distance >
                    allowed_distance
                ):

                    continue

                # Combined score:
                # color difference is primary,
                # boundary strength secondary.

                score = (
                    distance +
                    edge_strength * 0.08
                )

                if score < best_score:

                    best_score = score

                    best_neighbor = neighbor

            if best_neighbor is None:
                continue

            result[
                result ==
                region
            ] = best_neighbor

            changed += 1

        result = relabel_regions(
            result
        )

        print(
            f'  merged regions: {changed}',
            flush=True
        )

        if changed == 0:
            break

    return result


# ==========================================================
# FINAL TINY REGION CLEANUP
# ==========================================================

def remove_tiny_regions(
    labels,
    image
):

    result = labels.copy()

    (
        lab,
        colors,
        areas
    ) = calculate_region_data(
        result,
        image
    )

    adjacency = build_adjacency(
        result
    )

    regions = sorted(
        areas.keys(),
        key=lambda region:
            areas[region]
    )

    for region in regions:

        if (
            areas.get(
                region,
                0
            ) >= MIN_REGION_AREA
        ):
            continue

        neighbours = adjacency.get(
            region,
            set()
        )

        valid = [
            n
            for n in neighbours
            if n in colors
        ]

        if not valid:
            continue

        source = colors[
            region
        ]

        best = min(
            valid,
            key=lambda n:
                color_distance(
                    source,
                    colors[n]
                )
        )

        result[
            result ==
            region
        ] = best

    return relabel_regions(
        result
    )


# ==========================================================
# RECONSTRUCT IMAGE
# ==========================================================

def reconstruct_image(
    labels,
    original
):

    output = np.zeros_like(
        original
    )

    region_ids = np.unique(
        labels
    )

    for region_id in region_ids:

        mask = (
            labels ==
            region_id
        )

        if not np.any(
            mask
        ):
            continue

        pixels = original[
            mask
        ].astype(
            np.float32
        )

        # Median region color is robust against
        # small highlights/noise.

        color = np.median(
            pixels,
            axis=0
        )

        output[
            mask
        ] = np.clip(
            color,
            0,
            255
        ).astype(
            np.uint8
        )

    return output


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

    image = cv2.imread(
        input_path,
        cv2.IMREAD_COLOR
    )

    if image is None:

        raise RuntimeError(
            'Input image read nahi ho saki'
        )


    # ---------------------------------------------
    # RESIZE
    # ---------------------------------------------

    image = resize_image(
        image
    )

    print(
        f'Processing size: '
        f'{image.shape[1]}x{image.shape[0]}',
        flush=True
    )


    # ---------------------------------------------
    # EDGE-PRESERVING FILTER
    # ---------------------------------------------

    print(
        'Edge-preserving preprocessing...',
        flush=True
    )

    filtered = preprocess_raster(
        image
    )


    # ---------------------------------------------
    # EDGE MAP
    # ---------------------------------------------

    print(
        'Detecting important boundaries...',
        flush=True
    )

    edge_map = create_edge_map(
        filtered
    )


    # ---------------------------------------------
    # SLIC
    # ---------------------------------------------

    print(
        'Creating SLIC superpixels...',
        flush=True
    )

    labels = create_superpixels(
        filtered
    )

    initial_regions = len(
        np.unique(
            labels
        )
    )

    print(
        f'Initial regions: {initial_regions}',
        flush=True
    )


    # ---------------------------------------------
    # REGION MERGING
    # ---------------------------------------------

    labels = merge_regions(
        labels,
        filtered,
        edge_map
    )


    # ---------------------------------------------
    # TINY ARTIFACT CLEANUP
    # ---------------------------------------------

    print(
        'Cleaning tiny regions...',
        flush=True
    )

    labels = remove_tiny_regions(
        labels,
        filtered
    )


    # ---------------------------------------------
    # RECONSTRUCT FLAT-COLOR IMAGE
    # ---------------------------------------------

    print(
        'Reconstructing vector-ready raster...',
        flush=True
    )

    result = reconstruct_image(
        labels,
        image
    )


    # ---------------------------------------------
    # SAVE
    # ---------------------------------------------

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


    final_regions = len(
        np.unique(
            labels
        )
    )


    print(
        f'Final regions: {final_regions}',
        flush=True
    )

    print(
        'SLIC preprocessing complete.',
        flush=True
    )


# ==========================================================
# CLI
# ==========================================================

if __name__ == '__main__':

    if len(
        sys.argv
    ) != 3:

        print(
            'Usage: python preprocess.py '
            'input.png output.png',
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