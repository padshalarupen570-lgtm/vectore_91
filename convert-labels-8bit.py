import sys
import cv2
import numpy as np


def main(
    input_path,
    output_path
):

    labels = cv2.imread(
        input_path,
        cv2.IMREAD_UNCHANGED
    )

    if labels is None:

        raise RuntimeError(
            'Label image read nahi hui'
        )


    if labels.ndim == 3:

        labels = labels[
            :,
            :,
            0
        ]


    print(
        f'Input dtype: {labels.dtype}'
    )

    print(
        f'Input shape: {labels.shape}'
    )


    unique = np.unique(
        labels
    )


    print(
        'Labels:',
        unique.tolist()
    )


    maximum = int(
        np.max(
            labels
        )
    )


    if maximum > 255:

        raise RuntimeError(
            f'Label value {maximum} > 255 hai'
        )


    output = labels.astype(
        np.uint8
    )


    success = cv2.imwrite(
        output_path,
        output,
        [
            cv2.IMWRITE_PNG_COMPRESSION,
            6
        ]
    )


    if not success:

        raise RuntimeError(
            '8-bit label image save nahi hui'
        )


    region6 = int(
        np.count_nonzero(
            output == 6
        )
    )


    print(
        f'R6 pixels: {region6}'
    )

    print(
        f'Saved: {output_path}'
    )


if __name__ == '__main__':

    if len(sys.argv) != 3:

        print(
            'Usage: python '
            'convert-labels-8bit.py '
            'smooth-region-v2-labels.png '
            'smooth-region-v2-labels-8bit.png',
            file=sys.stderr
        )

        sys.exit(1)


    try:

        main(
            sys.argv[1],
            sys.argv[2]
        )

    except Exception as error:

        print(
            str(error),
            file=sys.stderr
        )

        sys.exit(1)