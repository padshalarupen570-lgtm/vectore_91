import sys
import cv2
import numpy as np

MAX_SIDE = 1000


def load_image(path):
    image = cv2.imread(path, cv2.IMREAD_COLOR)

    if image is None:
        raise RuntimeError(f"Image load failed: {path}")

    return image


def resize_for_processing(image):
    height, width = image.shape[:2]
    longest = max(width, height)

    if longest <= MAX_SIDE:
        return image

    scale = MAX_SIDE / float(longest)

    new_width = max(1, int(round(width * scale)))
    new_height = max(1, int(round(height * scale)))

    print(
        f"Resize: {width}x{height} -> "
        f"{new_width}x{new_height}",
        flush=True
    )

    return cv2.resize(
        image,
        (new_width, new_height),
        interpolation=cv2.INTER_AREA
    )


def fast_cleanup(image):
    # Cheap cleanup suitable for Render Free.
    cleaned = cv2.medianBlur(
        image,
        3
    )

    # Small bilateral pass only.
    cleaned = cv2.bilateralFilter(
        cleaned,
        d=3,
        sigmaColor=12,
        sigmaSpace=12
    )

    return cleaned


def reduce_micro_variation(image):
    # LAB keeps cleanup closer to perceptual colors.
    lab = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2LAB
    )

    temp = lab.astype(np.uint16)

    step = 3

    temp = (
        ((temp + step // 2) // step)
        * step
    )

    temp = np.clip(
        temp,
        0,
        255
    ).astype(np.uint8)

    return cv2.cvtColor(
        temp,
        cv2.COLOR_LAB2BGR
    )


def preprocess(input_path, output_path):
    print(
        "Loading image...",
        flush=True
    )

    image = load_image(input_path)

    height, width = image.shape[:2]

    print(
        f"Input: {width}x{height}",
        flush=True
    )

    image = resize_for_processing(
        image
    )

    print(
        "Fast edge-aware cleanup...",
        flush=True
    )

    result = fast_cleanup(
        image
    )

    print(
        "Reducing micro color variation...",
        flush=True
    )

    result = reduce_micro_variation(
        result
    )

    print(
        "Saving processed PNG...",
        flush=True
    )

    success = cv2.imwrite(
        output_path,
        result,
        [
            cv2.IMWRITE_PNG_COMPRESSION,
            2
        ]
    )

    if not success:
        raise RuntimeError(
            "Processed PNG save failed"
        )

    print(
        "Preprocessing complete.",
        flush=True
    )


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(
            "Usage: python preprocess.py input.png output.png",
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
            f"Preprocessing error: {error}",
            file=sys.stderr,
            flush=True
        )

        sys.exit(1)