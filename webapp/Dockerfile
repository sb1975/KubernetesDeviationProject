# Stage 1 — build React app
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY index.html vite.config.js ./
COPY src/ ./src/
COPY public/ ./public/
RUN npm run build

# Stage 2 — Python runtime with kubectl + kind
FROM python:3.12-slim
WORKDIR /app

# Install kubectl
RUN apt-get update && apt-get install -y curl ca-certificates && \
    KVER=$(curl -Ls https://dl.k8s.io/release/stable.txt) && \
    curl -Lo /usr/local/bin/kubectl \
      "https://dl.k8s.io/release/${KVER}/bin/linux/amd64/kubectl" && \
    chmod +x /usr/local/bin/kubectl && \
    curl -Lo /usr/local/bin/kind \
      "https://kind.sigs.k8s.io/dl/v0.23.0/kind-linux-amd64" && \
    chmod +x /usr/local/bin/kind && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Install Python deps
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend + MCP agents
COPY backend/ ./backend/
COPY ../../MCP_Agents/ ./MCP_Agents/

# Copy built React frontend so FastAPI can serve it
COPY --from=frontend-build /app/dist ./dist

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
