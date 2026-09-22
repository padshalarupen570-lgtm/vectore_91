# ============================================================
# VECTORE - RENDER PRODUCTION IMAGE
# Node.js + Python + OpenCV + Rust + VTracer
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
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*


# ============================================================
# APPLICATION DIRECTORY
# ============================================================

WORKDIR /app


# ============================================================
# NODE DEPENDENCIES
# ============================================================

COPY package.json package-lock.json ./

RUN npm ci --omit=dev


# ============================================================
# PYTHON ENVIRONMENT
# ============================================================

RUN python3 -m venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"


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
    | sh -s -- -y --profile minimal


# Rust/Cargo path
ENV PATH="/root/.cargo/bin:/opt/venv/bin:$PATH"


# Verify Rust versions during Render build
RUN rustc --version \
    && cargo --version


# ============================================================
# INSTALL VTRACER
# ============================================================

RUN cargo install \
    vtracer \
    --locked


# Verify VTracer exists
RUN test -x /root/.cargo/bin/vtracer \
    && /root/.cargo/bin/vtracer --version


# ============================================================
# COPY PROJECT
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
# START APPLICATION
# ============================================================

CMD ["npm", "start"]