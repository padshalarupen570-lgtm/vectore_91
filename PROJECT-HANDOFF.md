# VECTORIZE-SITE PROJECT HANDOFF

Last updated: September 2026

============================================================
1. IMPORTANT INSTRUCTION FOR A NEW CHAT
============================================================

This document contains the current state of an ongoing
Raster-to-Vector SVG project.

Do NOT restart the project from scratch.

Read this document first and continue from the section:

CURRENT EXACT STAGE / NEXT STEP

The user prefers step-by-step instructions and complete
ready-to-paste code when a file needs to be created or edited.

Do not modify the stable production files without first
testing changes in separate experimental files.

Primary project directory:

E:\vectorizer-site


============================================================
2. FINAL PROJECT GOAL
============================================================

Build an automatic raster-to-vector converter targeted
primarily at anime / illustration images.

Input examples:

JPG
PNG
WEBP
etc.

Final output must be a genuine SVG/vector.

The final target is NOT:

- a PNG preview
- a raster image embedded inside SVG
- a fake vector wrapper around the original bitmap

Target SVG should use real vector features such as:

- <path>
- cubic/smooth Bézier geometry
- flat vector fills where appropriate
- <linearGradient>
- <radialGradient>
- vector detail layers

The objective is to make the SVG visually much closer to
the original raster while remaining scalable/editable.


============================================================
3. VISUAL TARGET
============================================================

Current vector output preserves the anime structure fairly
well:

- hair silhouette
- eyes
- face outline
- fingers
- clothing
- line-art/details

However current major quality problems are:

1. Background smooth gradients become contour bands.
2. Face smooth skin shading becomes flat/posterized patches.
3. Hand/arm shading becomes color bands.
4. Some large boundaries/curves could eventually be smoother.
5. SVG has many paths representing what should sometimes be
   a smooth gradient.


============================================================
4. CURRENT STABLE PRODUCTION PIPELINE
============================================================

Current server pipeline:

Browser upload
    ↓
server.js
    ↓
Sharp normalization
    ↓
preprocess.py
    ↓
OpenCV bilateral/edge-preserving smoothing
    ↓
LAB K-means quantization (40 colors)
    ↓
small-region merging / cleanup
    ↓
VTracer
    ↓
SVG
    ↓
browser

Current server does NOT run the experimental gradient
enhancers.

Current server explicitly reports:

Path-by-path Resvg: DISABLED


============================================================
5. CURRENT BASELINE RESULT
============================================================

Test image:

test.jpg

Test dimensions:

736 x 736

Current SVG:

our-current.svg

Observed baseline:

SVG paths: 1232
SVG size: about 305.3 KB
Processing time: about 124.44 seconds

Preprocessor palette:

40 LAB colors

VTracer max colors:

44


============================================================
6. WHY BANDING HAPPENS
============================================================

The major architectural discovery is:

Smooth raster gradients are already destroyed BEFORE
VTracer receives the image.

preprocess.py converts the original continuous-color image
into approximately 40 LAB colors.

Therefore:

continuous raster gradient
    ↓
40-color quantization
    ↓
discrete color bands
    ↓
VTracer
    ↓
multiple flat SVG paths

This is why simply asking:

"Does this one SVG path contain a gradient?"

is fundamentally insufficient in many areas.

A single original smooth surface can become several
neighboring SVG paths.


============================================================
7. INTENDED FUTURE ARCHITECTURE
============================================================

The preferred architecture is a hybrid vector system:

Original Raster
    ↓
Detail / smooth-region analysis
    ↓
Vector-friendly preprocessing
    ↓
VTracer geometry
    ↓
Use ORIGINAL raster as shading source
    ↓
Gradient reconstruction
    ↓
Safe curve cleanup
    ↓
Final genuine SVG

Important:

The original raster should be the source of truth for smooth
color/shading.

Quantized VTracer colors should primarily help geometry /
segmentation, not define all final shading.


============================================================
8. STABLE PRODUCTION FILES
============================================================

These files are important and should NOT be overwritten
while experimenting:

server.js
preprocess.py
our-current.svg

Keep current production baseline working.


============================================================
9. KNOWN PROJECT FILES
============================================================

Project has included:

server.js

preprocess.py

preprocess-v2.py

preprocess-slic-bad.py

detail_map.py

svg-enhancer.js

svg_enhance.py

analyze-svg.js

color-family-analyzer.js

gradient-analyzer.js

gradient-fit-analyzer.js

gradient-model-analyzer.js

gradient-model-analyzer-v2.js

gradient-candidate-preview.js

safe-gradient-analyzer.js

safe-gradient-preview.js

gradient_safe_map.py

smooth-region-analyzer.py

smooth-region-analyzer-v2.py

region-gradient-fit.py

region-svg-mapper.js

convert-labels-8bit.py

our-current.svg

reference-gradient.svg

test.jpg

package.json

package-lock.json

public/

node_modules/

.venv/

Other generated diagnostic files also exist.


============================================================
10. PACKAGE DEPENDENCIES
============================================================

package.json dependencies:

@resvg/resvg-js
express
multer
sharp

Python environment uses:

OpenCV / cv2
NumPy


============================================================
11. CURRENT VTRACER SETTINGS
============================================================

server.js currently approximately uses:

--preset poster
--clustering color-cluster
--hierarchical stacked
--mode spline
--filter-speckle 2
--color-precision 7
--gradient-step 12
--simplify 1.15
--path-precision 3
--max-colors 44
--optimize 2

Important observation:

Increasing color count alone is NOT considered a complete
solution.

It could reduce visible band width but would increase:

- path count
- fragmentation
- file size

while still not generating true SVG gradients.


============================================================
12. PREPROCESS.PY
============================================================

Stable preprocess.py approximately uses:

MAX_SIZE = 1600
NUM_COLORS = 40
MIN_REGION_PIXELS = 18
MERGE_COLOR_DISTANCE = 24.0
DARK_PROTECTION_L = 65

Pipeline:

resize
bilateral filter
LAB K-means
small-region merge
micro cleanup
save quantized raster


============================================================
13. PREPROCESS-V2 EXPERIMENT
============================================================

preprocess-v2.py was created as an experimental geometry /
edge-aware spatial cleanup version.

It successfully:

- preserved important details
- maintained hair/eyes/fingers
- slightly regularized segmentation

But it did NOT solve the primary problem.

Background, face and hand still showed discrete color
banding.

Conclusion:

Further tuning of 40-color preprocessing alone will not
make the SVG look like the smooth raster.

Do NOT spend excessive effort tuning this branch before
gradient reconstruction.


============================================================
14. EARLY GRADIENT ANALYZER EXPERIMENTS
============================================================

Several path-level analyzers were tested.

gradient-analyzer.js:
basic RGB variation.

gradient-fit-analyzer.js:
horizontal/vertical linear gradient fitting.

gradient-model-analyzer.js:
arbitrary-angle linear plane + radial fitting.

One historical result:

60 candidates
48 useful
27 FLAT
1 STRONG
0 GOOD
20 REJECTED

One accepted linear path:

path #40
score about 0.730
angle about 287.5 degrees


============================================================
15. COLOR FAMILY EXPERIMENT
============================================================

color-family-analyzer.js analyzed:

1232 paths
44 flat colors

Different clustering settings produced very different
family counts.

Important conclusion:

Color-family similarity by itself cannot prove that several
SVG colors belong to one original raster gradient.

It can be supplementary evidence but should NOT be the
primary gradient detector.


============================================================
16. RGB GRADIENT MODEL V2
============================================================

gradient-model-analyzer-v2.js was created to improve upon
luminance-only gradient analysis.

It used:

- isolated SVG path masks
- RGB spatial plane fitting
- arbitrary-angle fitting
- endpoint color difference

Example result included:

path #30
STRONG
score = 0.806

Several POSSIBLE paths also appeared.

However candidate preview revealed that high spatial RGB
correlation alone can still select:

- background blobs
- shadows
- miscellaneous path shapes

Conclusion:

Individual SVG path gradient classification is not enough.


============================================================
17. IMPORTANT MASKING DISCOVERY
============================================================

Old analyzers often created path masks by:

target path = white
all other paths = black

This can be wrong with stacked SVG geometry because later
paths can cover the target path.

Newer experimental analyzers use:

target path = white
all other paths = removed

This isolated geometry approach is preferred.


============================================================
18. GRADIENT SAFE MASK
============================================================

gradient_safe_map.py was created.

Purpose:

Separate:

GREEN / SAFE:
broad smooth areas where gradient fitting may be attempted

RED / PROTECTED:
important detail/edge areas

Protected examples include:

- hair boundaries
- eyes
- nose
- mouth
- fingers
- line-art
- collar boundaries

Generated files:

gradient-safe-mask.png
protected-mask.png
gradient-safe-preview.png

Important concept:

GRADIENT SAFE != GRADIENT REQUIRED

A safe region only means:

"It may be safe to test a gradient here."

It does NOT automatically mean a gradient should be added.


============================================================
19. SAFE PATH GRADIENT ANALYZER
============================================================

safe-gradient-analyzer.js combined:

SVG path geometry
+
gradient-safe-mask
+
original test.jpg

A path had to be mostly inside gradient-safe areas before
gradient fitting.

One run produced:

SVG paths: 1232
Useful paths: 161

DETAIL reject: 106
FLAT: 11
STRONG: 2
GOOD: 2
POSSIBLE: 2
REJECT: 38

Accepted candidates:

path #143
STRONG
score = 0.862
safe = 92.8%

path #30
STRONG
score = 0.814
safe = 86.0%

path #124
GOOD
score = 0.669
safe = 92.6%

path #88
GOOD
score = 0.589
safe = 86.5%

path #11
POSSIBLE
score = 0.495
safe = 86.4%

path #151
POSSIBLE
score = 0.489
safe = 100%

These were stored in:

safe-gradient-results.json


============================================================
20. SAFE GRADIENT CANDIDATE PREVIEW RESULT
============================================================

safe-gradient-preview.js generated:

safe-gradient-candidates.png

Legend:

GREEN = STRONG
YELLOW = GOOD
CYAN = POSSIBLE

Visual inspection showed that the six accepted paths were
mostly separate background blobs.

Critically:

Face and hand — the areas where smooth gradients are most
needed — were NOT being solved by individual-path gradient
analysis.

Conclusion:

Stop treating individual SVG paths as the primary gradient
unit.

This directly motivated region-level analysis.


============================================================
21. SMOOTH REGION ANALYZER V1
============================================================

smooth-region-analyzer.py used connected components of the
gradient-safe mask.

It successfully found broad areas, including approximately:

- face region
- hand/arm region
- background
- clothing

But one large component could connect unrelated surfaces,
for example background + clothing.

Reason:

Binary connectivity alone does not imply the same visual
surface.


============================================================
22. SMOOTH REGION ANALYZER V2
============================================================

smooth-region-analyzer-v2.py added LAB color-aware spatial
segmentation.

It generated:

smooth-regions-v2-preview.png

smooth-region-v2-labels.png

There were up to 30 accepted regions.

Important observed regions included:

R6:
area about 19001 in the analyzer report
box roughly:
(252,247,237,134)
variation about 6.61
meanRGB about:
(249,220,200)

Visual inspection confirmed R6 corresponds to the broad
FACE SKIN area.

Other likely skin regions included:

R8:
meanRGB approximately (243,211,186)

R9:
meanRGB approximately (232,189,163)

These relate approximately to hand/arm skin portions.

White hair region example:

R4
meanRGB approximately (248,247,244)

Dark regions such as clothing were also separated.

V2 is not perfect and over-segments some background areas,
but R6 provides a useful controlled face test.


============================================================
23. FACE R6 GRADIENT FIT
============================================================

region-gradient-fit.py was created to test an actual
SVG-compatible multi-stop linear gradient model against the
original raster.

Test command:

.venv\Scripts\python.exe region-gradient-fit.py test.jpg smooth-region-v2-labels.png 6 region6-gradient-fit-preview.png

R6 pixels:

18997

IMPORTANT NUMERICAL RESULT:

Flat color:
#faddca

Flat RMSE:
7.385

Flat MAE:
5.492

Best linear angle:
93.5 degrees

Gradient RMSE:
3.809

Gradient MAE:
2.824

RMSE improvement over flat:
48.4%

This is a major successful proof.

A multi-stop linear gradient represents the face's smooth
raster shading much better than one flat color.


============================================================
24. FACE R6 GRADIENT STOPS
============================================================

The fitted 5-stop face gradient was:

0%
#fcdfd1
RGB(252,223,209)

25%
#fae3d0
RGB(250,227,208)

50%
#fbe0cc
RGB(251,224,204)

75%
#f8d8c1
RGB(248,216,193)

100%
#f6d0b6
RGB(246,208,182)

Best direction:

93.5 degrees

The generated diagnostic preview looked visually
promising: smooth face skin shading while line-art/detail
remained visible.


============================================================
25. IMPORTANT INTERPRETATION OF R6 TEST
============================================================

The R6 test proves:

Original raster shading can be approximated with an
SVG-compatible multi-stop linear gradient substantially
better than a flat fill.

But:

R6 is a raster-analysis region.

R6 is NOT automatically identical to one SVG path.

Before injecting the gradient into SVG, R6 must be mapped
to actual SVG geometry.


============================================================
26. REGION -> SVG MAPPING
============================================================

region-svg-mapper.js was created to find which SVG paths
overlap a smooth raster region such as R6.

Goal:

For each SVG path calculate:

- SVG path pixel area
- overlap with R6
- % of SVG path inside R6
- % of R6 covered by SVG path
- balanced mapping score

This will identify whether:

A) one dominant SVG base path represents face skin

or

B) multiple SVG paths must participate in reconstruction.


============================================================
27. 16-BIT LABEL ISSUE AND FIX
============================================================

smooth-region-v2-labels.png is a uint16 label image.

The first region-svg-mapper.js attempted to read this via
Sharp and failed to detect exact region value 6.

Error:

Region R6 label image mein nahi mila

This was NOT a segmentation failure.

Python/OpenCV correctly read R6.

convert-labels-8bit.py was therefore created.


============================================================
28. LABEL CONVERSION RESULT
============================================================

Command used:

.venv\Scripts\python.exe convert-labels-8bit.py smooth-region-v2-labels.png smooth-region-v2-labels-8bit.png

Confirmed output:

Input dtype:
uint16

Input shape:
(736, 736)

Labels:
[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
26, 27, 28, 29, 30]

R6 pixels:
18997

Saved:

smooth-region-v2-labels-8bit.png

Therefore the new 8-bit label map is known-good.


============================================================
29. CURRENT EXACT STAGE / NEXT STEP
============================================================

THIS IS WHERE THE PROJECT CURRENTLY IS.

region-svg-mapper.js has been updated to read:

smooth-region-v2-labels-8bit.png

instead of relying on Sharp's uint16 interpretation.

The NEXT command to run is:

node --check region-svg-mapper.js

Then:

node region-svg-mapper.js our-current.svg smooth-region-v2-labels-8bit.png 6 region-6-svg-map.json

Expected early output should include approximately:

Maximum label: 30

Original R6 pixels: 18997

The mapper will then render/analyze all 1232 SVG paths.

It may take time.

After completion, inspect:

TOP SVG MATCHES FOR R6

Important values:

path index
fill
pathPixels
overlap
pathInRegion %
regionCovered %
score

DO NOT inject the gradient before analyzing this mapping.


============================================================
30. WHAT TO DO AFTER R6 SVG MAPPING
============================================================

If one dominant SVG path maps strongly to R6:

Create an experimental SVG copy, for example:

gradient-enhanced-test.svg

Add a real:

<linearGradient>

with the five face stops and approximately 93.5-degree
direction.

Apply it only to the correct face base geometry.

Keep detail paths above it untouched.

If several SVG paths represent R6:

Do NOT blindly assign the same local gradient to all paths.

A shared gradient coordinate system / region geometry
strategy will be needed so the combined surface appears
continuous rather than restarting the gradient per path.

The correct method should be determined from mapping
results.


============================================================
31. HAND / ARM NEXT
============================================================

After face R6 succeeds:

Analyze hand/arm smooth regions.

R8 and R9 are likely relevant skin portions.

Potential strategy:

- determine whether R8/R9 belong to one continuous hand
  surface
- fit a combined or coordinated gradient model
- preserve finger line-art/details
- map region(s) to SVG geometry
- test before production integration


============================================================
32. BACKGROUND STRATEGY
============================================================

Background is more complicated than the face.

Original background contains:

- soft blur
- cloudy spatial color variation
- non-simple directional gradients

A single linear gradient may not be enough.

Possible future representations:

- multiple broad vector gradient shapes
- radial gradients
- limited SVG blur/filter on background-only geometry
- multi-stop gradients

Do NOT apply strong blur to character details.


============================================================
33. CURVE SMOOTHING
============================================================

Curve smoothing is a separate later stage.

Current VTracer already uses:

--mode spline

Therefore simply enabling spline is not the solution.

Future curve cleanup should be REGION/DETAIL AWARE.

Possible policy:

Large background / silhouette curves:
more smoothing

Hair outer silhouette:
moderate smoothing

Eyes / eyelashes / nose / mouth / fingers:
very little smoothing

Tiny line-art:
preserve

Potential future methods:

- curvature-aware simplification
- Ramer-Douglas-Peucker carefully
- cubic Bézier refitting
- path-specific simplification thresholds

Do NOT globally aggressively simplify all paths.


============================================================
34. PERFORMANCE ISSUE
============================================================

Current test:

736 x 736

takes about:

124.44 seconds

This is slow for a web application.

However performance optimization has intentionally been
deferred until the quality architecture is proven.

Later profile separately:

normalize time
preprocess time
VTracer time
gradient reconstruction time
curve cleanup time

Then optimize the actual bottleneck.


============================================================
35. SVG-ENHANCER.JS STATUS
============================================================

svg-enhancer.js exists but is NOT currently used by the
production server.

It experimented with path-mask raster sampling and median
fill correction.

Do not assume it is active in production.


============================================================
36. SVG_ENHANCE.PY STATUS
============================================================

svg_enhance.py exists.

Its safe first gradient implementation mainly handles
<rect> elements.

The VTracer output is primarily path-based.

Therefore it is not currently a complete solution for this
project.


============================================================
37. DETAIL_MAP.PY STATUS
============================================================

detail_map.py detects important edge/detail areas using:

- Sobel edge strength
- local texture
- morphology

It helped establish the concept of protected detail vs
smooth shading.

This concept is now important to the gradient
reconstruction architecture.


============================================================
38. GENERATED DIAGNOSTIC FILES
============================================================

Depending on the current project directory, generated files
include some/all of:

processed-v2.png

gradient-safe-mask.png

protected-mask.png

gradient-safe-preview.png

safe-gradient-results.json

safe-gradient-candidates.png

smooth-regions-preview.png

smooth-region-labels.png

smooth-regions-v2-preview.png

smooth-region-v2-labels.png

smooth-region-v2-labels-8bit.png

region6-gradient-fit-preview.png

region-6-svg-map.json

These are diagnostic/intermediate files.

They are NOT intended as the final product.


============================================================
39. FINAL SVG MUST REMAIN GENUINE VECTOR
============================================================

Important project requirement:

Do not solve visual similarity by embedding test.jpg inside
the SVG.

Raster masks/previews are allowed internally for analysis,
but the intended final downloadable SVG should use genuine
vector structure and vector gradients.


============================================================
40. SAFETY / REGRESSION POLICY
============================================================

Before production integration:

1. Keep current server.js unchanged.
2. Keep stable preprocess.py unchanged.
3. Keep our-current.svg as baseline.
4. Create experimental output files separately.
5. Visually compare experimental SVG against baseline.
6. Only integrate into server when result is clearly better.


============================================================
41. IMPORTANT FAILED / LIMITED DIRECTIONS
============================================================

Do NOT repeat these blindly:

A) More global palette colors alone
   - increases paths/file size
   - does not create true gradients

B) Individual path variation alone
   - misses gradients fragmented across paths

C) RGB spatial correlation alone
   - creates false positives in some shadows/background
     shapes

D) Binary connected smooth components alone
   - can merge unrelated surfaces

E) Treating all gradient-safe pixels as requiring gradients
   - safe only means eligible for testing

F) Aggressive global curve smoothing
   - risks destroying hair tips, eyes, fingers and line-art


============================================================
42. CURRENT SUCCESSFUL INSIGHTS
============================================================

The strongest successful findings so far:

1. Detail-protection masks can preserve important anime
   line-art.

2. Region-level analysis is more appropriate than
   individual-path gradient analysis.

3. R6 face skin can be modeled much better by a 5-stop
   linear gradient.

4. Face gradient error improved by 48.4% relative to a flat
   color.

5. The original raster should remain the shading source of
   truth.

6. SVG geometry and raster smooth-region analysis must be
   mapped carefully before modifying fills.


============================================================
43. IF STARTING A NEW CHAT
============================================================

Tell the assistant:

"Read this PROJECT-HANDOFF.md completely. This is an
existing raster-to-vector SVG project. Do not restart or
redesign it without reason. Continue from CURRENT EXACT
STAGE / NEXT STEP."

Then provide the latest result from:

node region-svg-mapper.js our-current.svg smooth-region-v2-labels-8bit.png 6 region-6-svg-map.json

Specifically provide:

TOP SVG MATCHES FOR R6

The next decision should be based on those mapping results.


============================================================
END OF HANDOFF
============================================================

086d4bbaadafd524e3d5ec8c3f8ad2e3