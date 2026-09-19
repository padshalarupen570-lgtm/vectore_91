import sys
import cv2
import numpy as np


def main(
    labels_path,
    region_id,
    output_path,
    target_width
):

    labels = cv2.imread(
        labels_path,
        cv2.IMREAD_UNCHANGED
    )

    if labels is None:
        raise RuntimeError(
            'Label image read nahi hui'
        )

    if labels.ndim == 3:
        labels = labels[:, :, 0]


    original_height, original_width = (
        labels.shape[:2]
    )


    mask = (
        labels ==
        region_id
    ).astype(
        np.uint8
    ) * 255


    original_pixels = int(
        np.count_nonzero(
            mask
        )
    )


    if original_pixels == 0:
        raise RuntimeError(
            f'R{region_id} nahi mila'
        )


    scale = (
        target_width /
        float(original_width)
    )


    target_height = max(
        1,
        int(
            round(
                original_height *
                scale
            )
        )
    )


    resized = cv2.resize(
        mask,
        (
            target_width,
            target_height
        ),
        interpolation=cv2.INTER_NEAREST
    )


    resized_pixels = int(
        np.count_nonzero(
            resized
        )
    )


    success = cv2.imwrite(
        output_path,
        resized,
        [
            cv2.IMWRITE_PNG_COMPRESSION,
            6
        ]
    )


    if not success:
        raise RuntimeError(
            'Region mask save nahi hui'
        )


    expected = (
        original_pixels *
        scale *
        scale
    )


    print(
        f'Original labels: '
        f'{original_width}x{original_height}'
    )

    print(
        f'Region: R{region_id}'
    )

    print(
        f'Original region pixels: '
        f'{original_pixels}'
    )

    print(
        f'Output mask: '
        f'{target_width}x{target_height}'
    )

    print(
        f'Resized region pixels: '
        f'{resized_pixels}'
    )

    print(
        f'Expected approximate pixels: '
        f'{expected:.0f}'
    )

    print(
        f'Saved: {output_path}'
    )


if __name__ == '__main__':

    if len(sys.argv) != 5:

        print(
            'Usage: python '
            'extract-region-mask.py '
            'smooth-region-v2-labels-8bit.png '
            '6 '
            'region-6-mask-500.png '
            '500',
            file=sys.stderr
        )

        sys.exit(1)


    try:

        main(
            sys.argv[1],
            int(sys.argv[2]),
            sys.argv[3],
            int(sys.argv[4])
        )

    except Exception as error:

        print(
            str(error),
            file=sys.stderr
        )

        sys.exit(1)