FROM node:22-bookworm

# Linux dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    cargo \
    build-essential \
    pkg-config \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app


# Node.js dependencies
COPY package.json package-lock.json ./

RUN npm ci --omit=dev


# Python virtual environment
RUN python3 -m venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"


# Python dependencies
COPY requirements.txt ./

RUN pip install --no-cache-dir --upgrade pip

RUN pip install --no-cache-dir -r requirements.txt


# Install VTracer for Linux
RUN cargo install vtracer


# Copy project
COPY . .


# Production environment
ENV NODE_ENV=production
ENV PYTHON_EXE=/opt/venv/bin/python
ENV VTRACER_EXE=/root/.cargo/bin/vtracer


EXPOSE 3000


CMD ["npm", "start"]