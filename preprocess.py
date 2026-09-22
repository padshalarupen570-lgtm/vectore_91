import sys
import cv2
import numpy as np


# ============================================================
# CONFIG
# ============================================================

# Subject mein enough colors rakho taaki
# eyes / hair / skin / clothes destroy na hon.
SUBJECT_COLORS = 26

# Background ko subject se zyada simplify karenge.
BACKGROUND_COLORS = 7

# Connected tiny color islands.
MIN_REGION_AREA = 28


# ============================================================
# IMAGE LOAD
# ============================================================

def load_image(filename):
    image = cv2.imread(
        filename,
        cv2.IMREAD_COLOR
    )

    if image is None:
        raise RuntimeError(
            f"Image load failed: {filename}"
        )

    return image


# ============================================================
# RESIZE FOR PROCESSING
# ============================================================

def resize_for_processing(image, max_side=1400):
    h, w = image.shape[:2]

    longest = max(h, w)

    if longest <= max_side:
        return image

    scale = max_side / float(longest)

    new_w = max(
        1,
        int(round(w * scale))
    )

    new_h = max(
        1,
        int(round(h * scale))
    )

    return cv2.resize(
        image,
        (new_w, new_h),
        interpolation=cv2.INTER_AREA
    )


# ============================================================
# EDGE PRESERVING SMOOTH
# ============================================================

def edge_preserving_smooth(image):
    """
    Gaussian blur use nahi kar rahe.

    Bilateral filter similar colors ko smooth karta hai
    lekin strong boundaries ko comparatively preserve karta hai.
    """

    first = cv2.bilateralFilter(
        image,
        d=9,
        sigmaColor=36,
        sigmaSpace=36
    )

    second = cv2.bilateralFilter(
        first,
        d=7,
        sigmaColor=25,
        sigmaSpace=25
    )

    return second


# ============================================================
# ESTIMATE FOREGROUND MASK
# ============================================================

def create_subject_mask(image):
    """
    General automatic subject approximation.

    Ye semantic AI segmentation nahi hai.

    Anime portraits mein center foreground ko preserve karne
    aur outer/background regions ko stronger simplify karne ke
    liye GrabCut + center prior use hota hai.
    """

    h, w = image.shape[:2]

    # Bahut small image ke case mein full subject.
    if w < 80 or h < 80:
        return np.full(
            (h, w),
            255,
            dtype=np.uint8
        )

    gc_mask = np.zeros(
        (h, w),
        dtype=np.uint8
    )

    margin_x = max(
        2,
        int(w * 0.035)
    )

    margin_y = max(
        2,
        int(h * 0.025)
    )

    rect = (
        margin_x,
        margin_y,
        max(1, w - margin_x * 2),
        max(1, h - margin_y * 2)
    )

    bg_model = np.zeros(
        (1, 65),
        np.float64
    )

    fg_model = np.zeros(
        (1, 65),
        np.float64
    )

    try:
        cv2.grabCut(
            image,
            gc_mask,
            rect,
            bg_model,
            fg_model,
            4,
            cv2.GC_INIT_WITH_RECT
        )

        subject = np.where(
            (gc_mask == cv2.GC_FGD) |
            (gc_mask == cv2.GC_PR_FGD),
            255,
            0
        ).astype(np.uint8)

    except cv2.error:
        subject = np.full(
            (h, w),
            255,
            dtype=np.uint8
        )

    # Center prior:
    # portrait ka important subject usually center mein hota hai.
    center = np.zeros(
        (h, w),
        dtype=np.uint8
    )

    cv2.ellipse(
        center,
        (
            w // 2,
            int(h * 0.53)
        ),
        (
            max(1, int(w * 0.37)),
            max(1, int(h * 0.51))
        ),
        0,
        0,
        360,
        255,
        -1
    )

    # GrabCut aur center prior ka controlled merge.
    center_part = cv2.bitwise_and(
        center,
        cv2.dilate(
            subject,
            np.ones(
                (9, 9),
                np.uint8
            ),
            iterations=2
        )
    )

    subject = cv2.bitwise_or(
        subject,
        center_part
    )

    kernel = np.ones(
        (5, 5),
        np.uint8
    )

    subject = cv2.morphologyEx(
        subject,
        cv2.MORPH_CLOSE,
        kernel,
        iterations=2
    )

    subject = cv2.morphologyEx(
        subject,
        cv2.MORPH_OPEN,
        np.ones(
            (3, 3),
            np.uint8
        ),
        iterations=1
    )

    # Slight expansion taaki hair edges accidentally
    # background processing mein na chale jayen.
    subject = cv2.dilate(
        subject,
        np.ones(
            (5, 5),
            np.uint8
        ),
        iterations=1
    )

    return subject


# ============================================================
# LAB K-MEANS QUANTIZATION
# ============================================================

def quantize_lab(image, colors):
    """
    RGB distance ke badle LAB space mein clustering.

    Isse visually similar shades ko merge karna generally
    better hota hai.
    """

    lab = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2LAB
    )

    h, w = lab.shape[:2]

    pixels = lab.reshape(
        (-1, 3)
    ).astype(np.float32)

    # KMeans ko unnecessarily millions of samples na do.
    count = pixels.shape[0]

    max_samples = 120000

    if count > max_samples:
        rng = np.random.default_rng(12345)

        indices = rng.choice(
            count,
            max_samples,
            replace=False
        )

        samples = pixels[indices]

    else:
        samples = pixels

    criteria = (
        cv2.TERM_CRITERIA_EPS +
        cv2.TERM_CRITERIA_MAX_ITER,
        35,
        0.45
    )

    compactness, sample_labels, centers = cv2.kmeans(
        samples,
        colors,
        None,
        criteria,
        4,
        cv2.KMEANS_PP_CENTERS
    )

    # Har source pixel ko nearest LAB center assign karo.
    # Chunking memory use control karta hai.
    labels = np.empty(
        count,
        dtype=np.int32
    )

    chunk_size = 50000

    centers_f = centers.astype(
        np.float32
    )

    for start in range(
        0,
        count,
        chunk_size
    ):
        end = min(
            count,
            start + chunk_size
        )

        chunk = pixels[
            start:end
        ]

        diff = (
            chunk[:, None, :] -
            centers_f[None, :, :]
        )

        distance = np.sum(
            diff * diff,
            axis=2
        )

        labels[start:end] = np.argmin(
            distance,
            axis=1
        )

    centers_u8 = np.clip(
        centers_f,
        0,
        255
    ).astype(np.uint8)

    quantized_lab = centers_u8[
        labels
    ].reshape(
        (h, w, 3)
    )

    return cv2.cvtColor(
        quantized_lab,
        cv2.COLOR_LAB2BGR
    )


# ============================================================
# BACKGROUND PROCESSING
# ============================================================

def process_background(image):
    """
    Background ko significantly simplify karte hain.

    Ye tumhari current output ke cloudy/topographic
    contour problem ko reduce karega.
    """

    # Strong edge-preserving simplification.
    bg = cv2.bilateralFilter(
        image,
        d=13,
        sigmaColor=75,
        sigmaSpace=75
    )

    bg = cv2.bilateralFilter(
        bg,
        d=11,
        sigmaColor=55,
        sigmaSpace=55
    )

    bg = quantize_lab(
        bg,
        BACKGROUND_COLORS
    )

    # Quantized boundaries ko tiny noise se clean karo.
    bg = cv2.medianBlur(
        bg,
        5
    )

    return bg


# ============================================================
# SUBJECT PROCESSING
# ============================================================

def process_subject(image):
    """
    Subject mein details background se zyada preserve rahengi.
    """

    smooth = edge_preserving_smooth(
        image
    )

    result = quantize_lab(
        smooth,
        SUBJECT_COLORS
    )

    # Very light cleanup.
    result = cv2.medianBlur(
        result,
        3
    )

    return result


# ============================================================
# EDGE MASK
# ============================================================

def build_important_edge_mask(image, subject_mask):
    """
    Strong dark/high-contrast lines ko identify karta hai.

    Eyes, mouth, hair separations, clothing lines etc.
    """

    gray = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2GRAY
    )

    # Slight denoise before edge detection.
    gray = cv2.GaussianBlur(
        gray,
        (3, 3),
        0
    )

    edges = cv2.Canny(
        gray,
        55,
        145,
        L2gradient=True
    )

    edges = cv2.bitwise_and(
        edges,
        subject_mask
    )

    edges = cv2.dilate(
        edges,
        np.ones(
            (2, 2),
            np.uint8
        ),
        iterations=1
    )

    return edges


# ============================================================
# PRESERVE IMPORTANT LINES
# ============================================================

def restore_important_edges(
    original,
    processed,
    edge_mask
):
    """
    Processed flat colors ke upar original ka limited edge
    information blend karte hain.

    Full original restore nahi hota, warna noise wapas aa jayega.
    """

    result = processed.copy()

    # Edge pixels ko mostly original se lao.
    alpha = (
        edge_mask.astype(
            np.float32
        ) / 255.0
    )[..., None]

    # Edge strength intentionally limited.
    alpha *= 0.72

    blended = (
        original.astype(np.float32) * alpha +
        result.astype(np.float32) * (1.0 - alpha)
    )

    result = np.clip(
        blended,
        0,
        255
    ).astype(np.uint8)

    return result


# ============================================================
# REMOVE ISOLATED TINY COLOR NOISE
# ============================================================

def cleanup_small_islands(image):
    """
    Exact quantized colors ke tiny islands ko local median color
    se replace karta hai.

    Heavy operation avoid karne ke liye color masks par
    connected-component cleanup use karte hain.
    """

    result = image.copy()

    h, w = result.shape[:2]

    flat = result.reshape(
        -1,
        3
    )

    colors, inverse = np.unique(
        flat,
        axis=0,
        return_inverse=True
    )

    labels_image = inverse.reshape(
        h,
        w
    )

    replacement_source = cv2.medianBlur(
        result,
        5
    )

    for color_index in range(
        len(colors)
    ):
        mask = np.where(
            labels_image == color_index,
            255,
            0
        ).astype(np.uint8)

        count, components, stats, _ = (
            cv2.connectedComponentsWithStats(
                mask,
                connectivity=8
            )
        )

        for component_id in range(
            1,
            count
        ):
            area = stats[
                component_id,
                cv2.CC_STAT_AREA
            ]

            if area >= MIN_REGION_AREA:
                continue

            tiny = (
                components ==
                component_id
            )

            result[tiny] = (
                replacement_source[tiny]
            )

    return result


# ============================================================
# MERGE SUBJECT + BACKGROUND
# ============================================================

def merge_layers(
    subject,
    background,
    subject_mask
):
    """
    Hard mask use karte hain so VTracer ko intermediate
    semi-transparent blending shades na milen.
    """

    mask = (
        subject_mask > 0
    )

    result = background.copy()

    result[mask] = subject[mask]

    return result


# ============================================================
# FINAL CLEANUP
# ============================================================

def final_cleanup(image):
    """
    Tiny color noise cleanup ke baad very light
    edge-aware polish.
    """

    image = cleanup_small_islands(
        image
    )

    image = cv2.bilateralFilter(
        image,
        d=5,
        sigmaColor=14,
        sigmaSpace=16
    )

    return image


# ============================================================
# MAIN PIPELINE
# ============================================================

def preprocess(
    input_path,
    output_path
):
    print(
        "Loading image..."
    )

    original = load_image(
        input_path
    )

    original = resize_for_processing(
        original
    )

    print(
        f"Size: {original.shape[1]}x{original.shape[0]}"
    )


    print(
        "Detecting foreground..."
    )

    subject_mask = create_subject_mask(
        original
    )


    print(
        "Simplifying subject..."
    )

    subject = process_subject(
        original
    )


    print(
        "Simplifying background..."
    )

    background = process_background(
        original
    )


    print(
        "Building protected edge mask..."
    )

    edges = build_important_edge_mask(
        original,
        subject_mask
    )


    print(
        "Restoring important line detail..."
    )

    subject = restore_important_edges(
        original,
        subject,
        edges
    )


    print(
        "Combining layers..."
    )

    combined = merge_layers(
        subject,
        background,
        subject_mask
    )


    print(
        "Cleaning small color regions..."
    )

    result = final_cleanup(
        combined
    )


    success = cv2.imwrite(
        output_path,
        result,
        [
            cv2.IMWRITE_PNG_COMPRESSION,
            4
        ]
    )


    if not success:
        raise RuntimeError(
            "Processed PNG save failed"
        )


    print(
        f"Processed image saved: {output_path}"
    )


# ============================================================
# ENTRY
# ============================================================

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(
            "Usage: python preprocess.py input.png output.png"
        )

        sys.exit(
            1
        )

    preprocess(
        sys.argv[1],
        sys.argv[2]
    )