# ============================================================
# VECTORE - RENDER PRODUCTION
#
# Node.js
# Python
# OpenCV
# NumPy
# Rust
# Exact VTracer CLI used locally
# ============================================================


FROM node:22-bookworm


# ============================================================
# SYSTEM DEPENDENCIES
# ============================================================

RUN apt-get update \
    && apt-get install -y \
        python3 \
        python3-pip \
        python3-venv \
        build-essential \
        pkg-config \
        curl \
        ca-certificates \
        git \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*


# ============================================================
# APP DIRECTORY
# ============================================================

WORKDIR /app


# ============================================================
# NODE DEPENDENCIES
# ============================================================

COPY package.json package-lock.json ./


RUN npm ci --omit=dev


# ============================================================
# PYTHON VIRTUAL ENVIRONMENT
# ============================================================

RUN python3 -m venv /opt/venv


ENV PATH="/opt/venv/bin:$PATH"


# ============================================================
# PYTHON DEPENDENCIES
# ============================================================

COPY requirements.txt ./


RUN pip install \
    --no-cache-dir \
    --upgrade pip


RUN pip install \
    --no-cache-dir \
    -r requirements.txt


# ============================================================
# INSTALL MODERN RUST
# ============================================================

RUN curl \
    --proto '=https' \
    --tlsv1.2 \
    -sSf \
    https://sh.rustup.rs \
    | sh -s -- \
        -y \
        --profile minimal


# ============================================================
# RUST PATH
# ============================================================

ENV PATH="/root/.cargo/bin:/opt/venv/bin:$PATH"


# ============================================================
# VERIFY RUST
# ============================================================

RUN rustc --version \
    && cargo --version


# ============================================================
# INSTALL EXACT VTRACER USED ON WINDOWS
# ============================================================

RUN cargo install \
    --git https://github.com/visioncortex/vtracer \
    --rev 169e845f190ab24de93772171e097d49f660e268 \
    vtracer-cli


# ============================================================
# VERIFY VTRACER
# ============================================================

RUN test -x /root/.cargo/bin/vtracer


RUN /root/.cargo/bin/vtracer --version


# ============================================================
# SHOW VTRACER HELP DURING BUILD
# Useful for debugging Render logs.
# ============================================================

RUN /root/.cargo/bin/vtracer --help | head -80


# ============================================================
# COPY APPLICATION
# ============================================================

COPY . .


# ============================================================
# PRODUCTION ENVIRONMENT
# ============================================================

ENV NODE_ENV=production


ENV PYTHON_EXE=/opt/venv/bin/python


ENV VTRACER_EXE=/root/.cargo/bin/vtracer


# ============================================================
# PORT
# ============================================================

EXPOSE 3000


# ============================================================
# START
# ============================================================

CMD ["npm", "start"]