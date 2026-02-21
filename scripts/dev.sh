#!/bin/bash
# Development startup script

set -e

echo "Starting Verbatim Studio development environment..."

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check dependencies
if ! command -v pnpm &> /dev/null; then
    echo "Error: pnpm is not installed"
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    echo "Error: python3 is not installed"
    exit 1
fi

# Ensure backend venv exists
if [ ! -d "packages/backend/.venv" ]; then
    echo -e "${BLUE}Creating Python virtual environment...${NC}"
    cd packages/backend || exit 1
    python3 -m venv .venv
    source ".venv/bin/activate"
    pip install -e ".[dev]"
    deactivate
    cd ../.. || exit 1
fi

# Install node dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}Installing Node dependencies...${NC}"
    pnpm install
fi

# Build Electron (needed for dev)
echo -e "${BLUE}Building Electron...${NC}"
cd apps/electron || exit 1
pnpm build
cd ../.. || exit 1

# Start all services
echo -e "${GREEN}Starting services...${NC}"
echo "  - Frontend: http://localhost:5173"
echo "  - Backend:  http://localhost:52780"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Use concurrently if available, otherwise run sequentially
if command -v npx &> /dev/null; then
    npx concurrently \
        --names "frontend,backend,electron" \
        --prefix-colors "cyan,yellow,magenta" \
        "pnpm dev:frontend" \
        "cd packages/backend && source \".venv/bin/activate\" && uvicorn api.main:app --reload --port 52780" \
        "sleep 3 && cd apps/electron && pnpm start"
else
    echo "Install concurrently globally for better dev experience: npm i -g concurrently"
    echo "Note: In fallback mode, Electron must be started manually with: cd apps/electron && pnpm start"
    # Fallback: start frontend and backend (Electron requires manual start)
    cd packages/backend || exit 1
    source ".venv/bin/activate" && uvicorn api.main:app --reload --port 52780 &
    BACKEND_PID=$!
    cd ../.. || exit 1
    pnpm dev:frontend &
    FRONTEND_PID=$!

    trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
    wait
fi
