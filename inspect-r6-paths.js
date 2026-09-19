const fs = require("fs");

const inputFile = process.argv[2] || "our-current.svg";
const outputFile = process.argv[3] || "r6-paths-inspect.svg";

const svg = fs.readFileSync(inputFile, "utf8");

const pathRegex = /<path\b[\s\S]*?\/?>/gi;
const paths = svg.match(pathRegex) || [];

console.log("SVG paths:", paths.length);

if (paths.length <= 12) {
    console.error("ERROR: SVG mein path #5 aur #12 available nahi hain.");
    process.exit(1);
}

function removeFillAndOpacity(pathTag) {
    let p = pathTag;

    // Remove existing fill-related attributes
    p = p.replace(/\sfill\s*=\s*"[^"]*"/gi, "");
    p = p.replace(/\sfill\s*=\s*'[^']*'/gi, "");
    p = p.replace(/\sfill-opacity\s*=\s*"[^"]*"/gi, "");
    p = p.replace(/\sfill-opacity\s*=\s*'[^']*'/gi, "");
    p = p.replace(/\sopacity\s*=\s*"[^"]*"/gi, "");
    p = p.replace(/\sopacity\s*=\s*'[^']*'/gi, "");

    // Remove inline style fill/opacity if present
    p = p.replace(/\sstyle\s*=\s*"[^"]*"/gi, "");
    p = p.replace(/\sstyle\s*=\s*'[^']*'/gi, "");

    return p;
}

function setDiagnosticStyle(pathTag, fill, opacity, stroke) {
    let p = removeFillAndOpacity(pathTag);

    p = p.replace(
        /<path\b/i,
        `<path fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="1.5"`
    );

    return p;
}

const path5 = setDiagnosticStyle(
    paths[5],
    "#ff0000",
    "0.58",
    "#ff0000"
);

const path12 = setDiagnosticStyle(
    paths[12],
    "#00aaff",
    "0.58",
    "#0066ff"
);

// Obtain root SVG opening tag so original coordinate system is preserved.
const svgOpenMatch = svg.match(/<svg\b[^>]*>/i);

if (!svgOpenMatch) {
    console.error("ERROR: <svg> root nahi mila.");
    process.exit(1);
}

const svgOpen = svgOpenMatch[0];

const diagnostic = `${svgOpen}

<!--
R6 PATH INSPECTION
RED  = SVG path #5
BLUE = SVG path #12
PURPLE = overlap of #5 and #12
-->

<rect width="100%" height="100%" fill="white"/>

<g id="path-5">
${path5}
</g>

<g id="path-12">
${path12}
</g>

</svg>
`;

fs.writeFileSync(outputFile, diagnostic, "utf8");

console.log("");
console.log("========================================");
console.log("R6 PATH INSPECTION SVG CREATED");
console.log("========================================");
console.log("Path #5  = RED");
console.log("Path #12 = BLUE");
console.log("Overlap  = PURPLE-ish");
console.log("");
console.log("Saved:", outputFile);