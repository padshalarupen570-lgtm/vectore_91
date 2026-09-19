import sys
import cv2
import numpy as np


# ==========================================================
# CONFIGURATION
# ==========================================================

MAX_SIZE = 1600

# Safe region ka minimum meaningful area.
MIN_REGION_PIXELS = 700

# LAB clustering.
#
# Ye final SVG colors nahi hain.
# Sirf smooth surfaces ko spatial/color groups mein
# separate karne ke liye temporary clustering hai.
NUM_REGION_COLORS = 12

# Nearby LAB clusters ko ek region mein connect karne ki
# maximum color distance.
MAX_NEIGHBOR_COLOR_DISTANCE = 20.0

# Very small holes/gaps.
CLOSE_SIZE = 5

# Thin accidental connections remove.
OPEN_SIZE = 3

# Gradient analysis ke liye actual raster variation.
MIN_VARIATION = 2.8
MAX_VARIATION = 38.0

# Maximum regions in report.
MAX_REGIONS = 30


# ==========================================================
# RESIZE
# ==========================================================

def resize_image(
    image,
    max_size=MAX_SIZE
):

    height, width = (
        image.shape[:2]
    )

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
# LAB DISTANCE
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
# SAFE-PIXEL LAB CLUSTERING
# ==========================================================

def cluster_safe_pixels(
    image,
    safe_mask
):

    lab = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2LAB
    )

    safe = (
        safe_mask > 127
    )

    pixels = lab[
        safe
    ].astype(
        np.float32
    )

    if (
        len(pixels) <
        NUM_REGION_COLORS
    ):

        raise RuntimeError(
            'Safe pixels bahut kam hain'
        )

    criteria = (
        cv2.TERM_CRITERIA_EPS +
        cv2.TERM_CRITERIA_MAX_ITER,
        35,
        0.35
    )

    cv2.setRNGSeed(
        12345
    )

    (
        _,
        labels,
        centers
    ) = cv2.kmeans(
        pixels,
        NUM_REGION_COLORS,
        None,
        criteria,
        5,
        cv2.KMEANS_PP_CENTERS
    )

    labels = labels.reshape(
        -1
    )

    cluster_map = np.full(
        safe_mask.shape,
        -1,
        dtype=np.int16
    )

    cluster_map[
        safe
    ] = labels.astype(
        np.int16
    )

    return (
        cluster_map,
        centers
    )


# ==========================================================
# CLEAN BINARY COMPONENT
# ==========================================================

def clean_binary_mask(
    mask
):

    result = (
        mask > 0
    ).astype(
        np.uint8
    ) * 255

    open_kernel = (
        cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (
                OPEN_SIZE,
                OPEN_SIZE
            )
        )
    )

    result = cv2.morphologyEx(
        result,
        cv2.MORPH_OPEN,
        open_kernel
    )

    close_kernel = (
        cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE,
            (
                CLOSE_SIZE,
                CLOSE_SIZE
            )
        )
    )

    result = cv2.morphologyEx(
        result,
        cv2.MORPH_CLOSE,
        close_kernel
    )

    return result


# ==========================================================
# INITIAL SPATIAL REGIONS
# ==========================================================

def build_initial_regions(
    cluster_map,
    centers
):

    regions = []

    for cluster_index in range(
        len(centers)
    ):

        mask = (
            cluster_map ==
            cluster_index
        ).astype(
            np.uint8
        ) * 255

        mask = clean_binary_mask(
            mask
        )

        (
            count,
            component_labels,
            stats,
            _
        ) = cv2.connectedComponentsWithStats(
            (
                mask > 0
            ).astype(
                np.uint8
            ),
            connectivity=8
        )

        for component in range(
            1,
            count
        ):

            area = int(
                stats[
                    component,
                    cv2.CC_STAT_AREA
                ]
            )

            if (
                area <
                MIN_REGION_PIXELS
            ):
                continue

            component_mask = (
                component_labels ==
                component
            )

            regions.append({
                'cluster':
                    cluster_index,

                'area':
                    area,

                'mask':
                    component_mask,

                'center':
                    centers[
                        cluster_index
                    ].copy()
            })

    return regions


# ==========================================================
# REGION TOUCH TEST
# ==========================================================

def regions_touch(
    first_mask,
    second_mask
):

    first_u8 = (
        first_mask.astype(
            np.uint8
        ) * 255
    )

    kernel = np.ones(
        (
            3,
            3
        ),
        dtype=np.uint8
    )

    expanded = cv2.dilate(
        first_u8,
        kernel,
        iterations=1
    )

    return bool(
        np.any(
            (
                expanded > 0
            )
            &
            second_mask
        )
    )


# ==========================================================
# REGION MERGING
# ==========================================================

def merge_similar_touching_regions(
    regions
):

    if not regions:
        return []

    count = len(
        regions
    )

    parent = list(
        range(
            count
        )
    )


    def find(
        value
    ):

        while (
            parent[value] !=
            value
        ):

            parent[value] = (
                parent[
                    parent[value]
                ]
            )

            value = parent[
                value
            ]

        return value


    def union(
        first,
        second
    ):

        a = find(
            first
        )

        b = find(
            second
        )

        if a != b:

            parent[b] = a


    for first in range(
        count
    ):

        for second in range(
            first + 1,
            count
        ):

            distance = lab_distance(
                regions[first][
                    'center'
                ],
                regions[second][
                    'center'
                ]
            )

            if (
                distance >
                MAX_NEIGHBOR_COLOR_DISTANCE
            ):
                continue

            if not regions_touch(
                regions[first][
                    'mask'
                ],
                regions[second][
                    'mask'
                ]
            ):
                continue

            union(
                first,
                second
            )


    grouped = {}

    for index in range(
        count
    ):

        root = find(
            index
        )

        grouped.setdefault(
            root,
            []
        ).append(
            index
        )


    merged = []

    for members in grouped.values():

        combined = np.zeros_like(
            regions[
                members[0]
            ][
                'mask'
            ],
            dtype=bool
        )

        total_area = 0

        weighted_center = np.zeros(
            3,
            dtype=np.float32
        )

        for index in members:

            region = regions[
                index
            ]

            combined |= region[
                'mask'
            ]

            area = int(
                np.count_nonzero(
                    region[
                        'mask'
                    ]
                )
            )

            total_area += area

            weighted_center += (
                region[
                    'center'
                ].astype(
                    np.float32
                )
                *
                area
            )

        if total_area <= 0:
            continue

        weighted_center /= (
            total_area
        )

        merged.append({
            'mask':
                combined,

            'area':
                total_area,

            'center':
                weighted_center
        })

    return merged


# ==========================================================
# REGION STATISTICS
# ==========================================================

def calculate_region_stats(
    image,
    region
):

    mask = region[
        'mask'
    ]

    ys, xs = np.where(
        mask
    )

    if (
        len(xs) <
        MIN_REGION_PIXELS
    ):
        return None

    x1 = int(
        xs.min()
    )

    y1 = int(
        ys.min()
    )

    x2 = int(
        xs.max()
    )

    y2 = int(
        ys.max()
    )

    pixels = image[
        mask
    ].astype(
        np.float32
    )

    mean_bgr = np.mean(
        pixels,
        axis=0
    )

    std_bgr = np.std(
        pixels,
        axis=0
    )

    variation = float(
        np.mean(
            std_bgr
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

    return {
        'mask':
            mask,

        'area':
            len(xs),

        'x':
            x1,

        'y':
            y1,

        'w':
            x2 -
            x1 +
            1,

        'h':
            y2 -
            y1 +
            1,

        'variation':
            variation,

        'mean_bgr':
            mean_bgr
    }


# ==========================================================
# PREVIEW COLOR
# ==========================================================

def preview_color(
    index
):

    rng = np.random.default_rng(
        5000 +
        index
    )

    values = rng.integers(
        70,
        256,
        size=3
    )

    return tuple(
        int(value)
        for value
        in values
    )


# ==========================================================
# BUILD PREVIEW
# ==========================================================

def build_preview(
    image,
    regions
):

    preview = (
        image.astype(
            np.float32
        )
        *
        0.42
    ).astype(
        np.uint8
    )

    for region in regions:

        mask = region[
            'mask'
        ]

        color = np.array(
            region[
                'color'
            ],
            dtype=np.float32
        )

        current = preview[
            mask
        ].astype(
            np.float32
        )

        preview[
            mask
        ] = np.clip(
            current *
            0.30
            +
            color *
            0.70,
            0,
            255
        ).astype(
            np.uint8
        )


        cv2.rectangle(
            preview,
            (
                region[
                    'x'
                ],
                region[
                    'y'
                ]
            ),
            (
                region[
                    'x'
                ]
                +
                region[
                    'w'
                ]
                -
                1,

                region[
                    'y'
                ]
                +
                region[
                    'h'
                ]
                -
                1
            ),
            region[
                'color'
            ],
            2
        )


        cv2.putText(
            preview,
            f"R{region['id']}",
            (
                region[
                    'x'
                ] +
                5,

                max(
                    20,
                    region[
                        'y'
                    ] +
                    22
                )
            ),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            region[
                'color'
            ],
            2,
            cv2.LINE_AA
        )

    return preview


# ==========================================================
# ANALYZE
# ==========================================================

def analyze(
    image_path,
    safe_mask_path,
    preview_path,
    labels_path
):

    print(
        'Reading image and safe mask...',
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


    image = resize_image(
        image
    )


    height, width = (
        image.shape[:2]
    )


    safe_mask = cv2.imread(
        safe_mask_path,
        cv2.IMREAD_GRAYSCALE
    )

    if safe_mask is None:

        raise RuntimeError(
            'Safe mask read nahi hui'
        )


    if (
        safe_mask.shape[0] !=
        height

        or

        safe_mask.shape[1] !=
        width
    ):

        safe_mask = cv2.resize(
            safe_mask,
            (
                width,
                height
            ),
            interpolation=cv2.INTER_NEAREST
        )


    print(
        f'Image size: '
        f'{width}x{height}',
        flush=True
    )


    # ======================================================
    # CLUSTER SAFE PIXELS
    # ======================================================

    print(
        'LAB clustering safe pixels...',
        flush=True
    )


    (
        cluster_map,
        centers
    ) = cluster_safe_pixels(
        image,
        safe_mask
    )


    # ======================================================
    # SPATIAL COMPONENTS
    # ======================================================

    print(
        'Building spatial components...',
        flush=True
    )


    initial_regions = build_initial_regions(
        cluster_map,
        centers
    )


    print(
        f'Initial regions: '
        f'{len(initial_regions)}',
        flush=True
    )


    # ======================================================
    # MERGE SIMILAR TOUCHING COMPONENTS
    # ======================================================

    print(
        'Merging compatible neighboring regions...',
        flush=True
    )


    merged = merge_similar_touching_regions(
        initial_regions
    )


    # ======================================================
    # FINAL STATISTICS
    # ======================================================

    final_regions = []


    for region in merged:

        stats = calculate_region_stats(
            image,
            region
        )

        if stats is None:
            continue

        final_regions.append(
            stats
        )


    final_regions.sort(
        key=lambda item:
            item[
                'area'
            ],
        reverse=True
    )


    final_regions = (
        final_regions[
            :MAX_REGIONS
        ]
    )


    for (
        index,
        region
    ) in enumerate(
        final_regions,
        start=1
    ):

        region[
            'id'
        ] = index

        region[
            'color'
        ] = preview_color(
            index
        )


    # ======================================================
    # REPORT
    # ======================================================

    print('')
    print(
        '=========================================='
    )

    print(
        ' SMOOTH REGION ANALYSIS V2'
    )

    print(
        '=========================================='
    )


    print(
        f'Accepted regions: '
        f'{len(final_regions)}'
    )

    print('')


    for region in final_regions:

        mean_bgr = region[
            'mean_bgr'
        ]

        print(

            f"R{region['id']:02d} | "

            f"area="
            f"{region['area']} | "

            f"box=("
            f"{region['x']},"
            f"{region['y']},"
            f"{region['w']},"
            f"{region['h']}) | "

            f"variation="
            f"{region['variation']:.2f} | "

            f"meanRGB=("
            f"{mean_bgr[2]:.0f},"
            f"{mean_bgr[1]:.0f},"
            f"{mean_bgr[0]:.0f})"

        )


    # ======================================================
    # PREVIEW
    # ======================================================

    preview = build_preview(
        image,
        final_regions
    )


    if not cv2.imwrite(
        preview_path,
        preview
    ):

        raise RuntimeError(
            'Preview save nahi hui'
        )


    # ======================================================
    # REGION LABEL MAP
    # ======================================================

    label_image = np.zeros(
        (
            height,
            width
        ),
        dtype=np.uint16
    )


    for region in final_regions:

        label_image[
            region[
                'mask'
            ]
        ] = (
            region[
                'id'
            ]
        )


    if not cv2.imwrite(
        labels_path,
        label_image
    ):

        raise RuntimeError(
            'Label map save nahi hui'
        )


    print('')
    print(
        f'Preview: {preview_path}'
    )

    print(
        f'Labels:  {labels_path}'
    )

    print(
        'Smooth region V2 complete.'
    )


# ==========================================================
# CLI
# ==========================================================

if __name__ == '__main__':

    if len(
        sys.argv
    ) != 5:

        print(
            'Usage: python '
            'smooth-region-analyzer-v2.py '
            'test.jpg '
            'gradient-safe-mask.png '
            'smooth-regions-v2-preview.png '
            'smooth-region-v2-labels.png',
            file=sys.stderr
        )

        sys.exit(
            1
        )


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

        sys.exit(
            1
        )