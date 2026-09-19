import sys
import cv2
import numpy as np


# ==========================================================
# CONFIG
# ==========================================================

# Multiple SVG-compatible stops.
NUM_STOPS = 5

# Search angle step.
ANGLE_STEP = 3

# Extreme pixels/noise reduce.
PROJECTION_LOW = 2.0
PROJECTION_HIGH = 98.0

# Har stop ke aas-paas sample width.
STOP_SAMPLE_RADIUS = 0.075

# Preview overlay strength.
PREVIEW_ALPHA = 0.82


# ==========================================================
# HELPERS
# ==========================================================

def rgb_hex(
    color
):

    values = np.clip(
        np.round(
            color
        ),
        0,
        255
    ).astype(
        np.uint8
    )

    return (
        f'#{values[0]:02x}'
        f'{values[1]:02x}'
        f'{values[2]:02x}'
    )


def mean_color(
    colors
):

    if len(colors) == 0:

        return np.zeros(
            3,
            dtype=np.float32
        )

    return np.mean(
        colors,
        axis=0
    ).astype(
        np.float32
    )


# ==========================================================
# READ REGION
# ==========================================================

def read_region(
    image_path,
    labels_path,
    region_id
):

    bgr = cv2.imread(
        image_path,
        cv2.IMREAD_COLOR
    )

    if bgr is None:

        raise RuntimeError(
            'Original image read nahi hui'
        )


    labels = cv2.imread(
        labels_path,
        cv2.IMREAD_UNCHANGED
    )

    if labels is None:

        raise RuntimeError(
            'Region label image read nahi hui'
        )


    height, width = (
        bgr.shape[:2]
    )


    if (
        labels.shape[0] != height
        or
        labels.shape[1] != width
    ):

        labels = cv2.resize(
            labels,
            (
                width,
                height
            ),
            interpolation=cv2.INTER_NEAREST
        )


    if (
        labels.ndim ==
        3
    ):

        labels = labels[
            :,
            :,
            0
        ]


    mask = (
        labels ==
        region_id
    )


    count = int(
        np.count_nonzero(
            mask
        )
    )


    if count == 0:

        raise RuntimeError(
            f'Region R{region_id} nahi mila'
        )


    rgb = cv2.cvtColor(
        bgr,
        cv2.COLOR_BGR2RGB
    )


    ys, xs = np.where(
        mask
    )


    colors = rgb[
        mask
    ].astype(
        np.float32
    )


    return (
        bgr,
        rgb,
        mask,
        xs.astype(
            np.float32
        ),
        ys.astype(
            np.float32
        ),
        colors
    )


# ==========================================================
# NORMALIZED PROJECTION
# ==========================================================

def project_points(
    xs,
    ys,
    angle_degrees
):

    angle = np.deg2rad(
        angle_degrees
    )


    dx = np.cos(
        angle
    )

    dy = np.sin(
        angle
    )


    projection = (
        xs *
        dx
        +
        ys *
        dy
    )


    low = float(
        np.percentile(
            projection,
            PROJECTION_LOW
        )
    )


    high = float(
        np.percentile(
            projection,
            PROJECTION_HIGH
        )
    )


    span = (
        high -
        low
    )


    if (
        span <
        1e-6
    ):

        return None


    t = (
        projection -
        low
    ) / span


    t = np.clip(
        t,
        0.0,
        1.0
    )


    return (
        t.astype(
            np.float32
        ),
        low,
        high,
        dx,
        dy
    )


# ==========================================================
# BUILD STOPS
# ==========================================================

def build_stops(
    t,
    colors,
    number_of_stops=NUM_STOPS
):

    positions = np.linspace(
        0.0,
        1.0,
        number_of_stops
    ).astype(
        np.float32
    )


    stop_colors = []


    for position in positions:

        distance = np.abs(
            t -
            position
        )


        selected = (
            distance <=
            STOP_SAMPLE_RADIUS
        )


        if (
            np.count_nonzero(
                selected
            )
            <
            20
        ):

            nearest_count = min(
                100,
                len(
                    distance
                )
            )


            nearest = np.argpartition(
                distance,
                nearest_count - 1
            )[
                :nearest_count
            ]


            sample = colors[
                nearest
            ]

        else:

            sample = colors[
                selected
            ]


        # Median is safer around line-art contamination.
        color = np.median(
            sample,
            axis=0
        ).astype(
            np.float32
        )


        stop_colors.append(
            color
        )


    return (
        positions,
        np.array(
            stop_colors,
            dtype=np.float32
        )
    )


# ==========================================================
# INTERPOLATE STOPS
# ==========================================================

def interpolate_stops(
    t,
    positions,
    stop_colors
):

    predicted = np.zeros(
        (
            len(t),
            3
        ),
        dtype=np.float32
    )


    for channel in range(
        3
    ):

        predicted[
            :,
            channel
        ] = np.interp(
            t,
            positions,
            stop_colors[
                :,
                channel
            ]
        )


    return predicted


# ==========================================================
# ERRORS
# ==========================================================

def calculate_rmse(
    actual,
    predicted
):

    difference = (
        actual -
        predicted
    )


    return float(
        np.sqrt(
            np.mean(
                difference *
                difference
            )
        )
    )


def calculate_mae(
    actual,
    predicted
):

    return float(
        np.mean(
            np.abs(
                actual -
                predicted
            )
        )
    )


# ==========================================================
# FIT ONE ANGLE
# ==========================================================

def fit_angle(
    xs,
    ys,
    colors,
    angle
):

    projection = project_points(
        xs,
        ys,
        angle
    )


    if projection is None:
        return None


    (
        t,
        low,
        high,
        dx,
        dy
    ) = projection


    (
        positions,
        stop_colors
    ) = build_stops(
        t,
        colors
    )


    predicted = interpolate_stops(
        t,
        positions,
        stop_colors
    )


    rmse = calculate_rmse(
        colors,
        predicted
    )


    mae = calculate_mae(
        colors,
        predicted
    )


    return {
        'angle':
            angle,

        'rmse':
            rmse,

        'mae':
            mae,

        't':
            t,

        'low':
            low,

        'high':
            high,

        'dx':
            dx,

        'dy':
            dy,

        'positions':
            positions,

        'stop_colors':
            stop_colors,

        'predicted':
            predicted
    }


# ==========================================================
# FIND BEST LINEAR GRADIENT
# ==========================================================

def find_best_linear_gradient(
    xs,
    ys,
    colors
):

    best = None


    # Linear gradient has equivalent reversed direction,
    # so 0..177 degrees is sufficient.
    for angle in range(
        0,
        180,
        ANGLE_STEP
    ):

        result = fit_angle(
            xs,
            ys,
            colors,
            angle
        )


        if result is None:
            continue


        if (
            best is None
            or
            result[
                'rmse'
            ]
            <
            best[
                'rmse'
            ]
        ):

            best = result


    if best is None:

        raise RuntimeError(
            'Linear gradient fit nahi hua'
        )


    # Refine ±3 degrees around winner.
    coarse_angle = (
        best[
            'angle'
        ]
    )


    refined = None


    for offset in np.arange(
        -3.0,
        3.01,
        0.5
    ):

        angle = (
            coarse_angle +
            float(offset)
        ) % 180.0


        result = fit_angle(
            xs,
            ys,
            colors,
            angle
        )


        if result is None:
            continue


        if (
            refined is None
            or
            result[
                'rmse'
            ]
            <
            refined[
                'rmse'
            ]
        ):

            refined = result


    return (
        refined
        if refined is not None
        else best
    )


# ==========================================================
# FLAT BASELINE
# ==========================================================

def flat_baseline(
    colors
):

    flat_color = np.median(
        colors,
        axis=0
    ).astype(
        np.float32
    )


    prediction = np.repeat(
        flat_color[
            None,
            :
        ],
        len(
            colors
        ),
        axis=0
    )


    rmse = calculate_rmse(
        colors,
        prediction
    )


    mae = calculate_mae(
        colors,
        prediction
    )


    return (
        flat_color,
        rmse,
        mae
    )


# ==========================================================
# CREATE PREVIEW
# ==========================================================

def create_preview(
    bgr,
    mask,
    predicted_rgb
):

    output = bgr.copy()


    predicted_bgr = predicted_rgb[
        :,
        [
            2,
            1,
            0
        ]
    ]


    predicted_bgr = np.clip(
        predicted_bgr,
        0,
        255
    ).astype(
        np.uint8
    )


    original_pixels = output[
        mask
    ].astype(
        np.float32
    )


    reconstructed = (
        original_pixels *
        (
            1.0 -
            PREVIEW_ALPHA
        )
        +
        predicted_bgr.astype(
            np.float32
        )
        *
        PREVIEW_ALPHA
    )


    output[
        mask
    ] = np.clip(
        reconstructed,
        0,
        255
    ).astype(
        np.uint8
    )


    return output


# ==========================================================
# MAIN
# ==========================================================

def process(
    image_path,
    labels_path,
    region_id,
    output_path
):

    print(
        'Reading gradient region...',
        flush=True
    )


    (
        bgr,
        rgb,
        mask,
        xs,
        ys,
        colors
    ) = read_region(
        image_path,
        labels_path,
        region_id
    )


    print(
        f'Region: R{region_id}',
        flush=True
    )


    print(
        f'Pixels: {len(colors)}',
        flush=True
    )


    # ------------------------------------------------------
    # FLAT MODEL
    # ------------------------------------------------------

    (
        flat_color,
        flat_rmse,
        flat_mae
    ) = flat_baseline(
        colors
    )


    # ------------------------------------------------------
    # LINEAR GRADIENT MODEL
    # ------------------------------------------------------

    print(
        'Searching gradient direction...',
        flush=True
    )


    best = find_best_linear_gradient(
        xs,
        ys,
        colors
    )


    improvement = (
        (
            flat_rmse -
            best[
                'rmse'
            ]
        )
        /
        max(
            flat_rmse,
            1e-6
        )
        *
        100.0
    )


    # ------------------------------------------------------
    # REPORT
    # ------------------------------------------------------

    print('')
    print(
        '=========================================='
    )

    print(
        ' REGION GRADIENT FIT'
    )

    print(
        '=========================================='
    )


    print(
        f'Region: R{region_id}'
    )


    print(
        f'Flat color: '
        f'{rgb_hex(flat_color)}'
    )


    print(
        f'Flat RMSE: {flat_rmse:.3f}'
    )


    print(
        f'Flat MAE:  {flat_mae:.3f}'
    )


    print('')


    print(
        f'Best linear angle: '
        f'{best["angle"]:.1f} degrees'
    )


    print(
        f'Gradient RMSE: '
        f'{best["rmse"]:.3f}'
    )


    print(
        f'Gradient MAE:  '
        f'{best["mae"]:.3f}'
    )


    print(
        f'RMSE improvement over flat: '
        f'{improvement:.1f}%'
    )


    print('')
    print(
        'SVG-LIKE GRADIENT STOPS'
    )

    print(
        '------------------------------------------'
    )


    for (
        position,
        color
    ) in zip(
        best[
            'positions'
        ],
        best[
            'stop_colors'
        ]
    ):

        print(
            f'{position * 100:6.1f}%  '
            f'{rgb_hex(color)}  '
            f'RGB('
            f'{color[0]:.0f},'
            f'{color[1]:.0f},'
            f'{color[2]:.0f})'
        )


    # ------------------------------------------------------
    # PREVIEW
    # ------------------------------------------------------

    preview = create_preview(
        bgr,
        mask,
        best[
            'predicted'
        ]
    )


    if not cv2.imwrite(
        output_path,
        preview
    ):

        raise RuntimeError(
            'Preview save nahi hui'
        )


    print('')
    print(
        f'Preview: {output_path}'
    )

    print(
        'Gradient fit complete.'
    )


# ==========================================================
# CLI
# ==========================================================

if __name__ == '__main__':

    if (
        len(
            sys.argv
        )
        !=
        5
    ):

        print(
            'Usage: python '
            'region-gradient-fit.py '
            'test.jpg '
            'smooth-region-v2-labels.png '
            '6 '
            'region6-gradient-fit-preview.png',
            file=sys.stderr
        )

        sys.exit(
            1
        )


    try:

        process(
            sys.argv[1],
            sys.argv[2],
            int(
                sys.argv[3]
            ),
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