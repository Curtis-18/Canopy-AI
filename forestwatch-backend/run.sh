#!/bin/bash
# Quick start script for Canopy AI backend with optimizations

echo "🚀 Canopy AI Backend - Performance Optimized"
echo "=============================================="
echo ""

# Check if venv exists
if [ -d "venv" ]; then
    echo "✓ Virtual environment found"
    source venv/bin/activate
else
    echo "⚠ No virtual environment found"
    echo "Creating venv..."
    python3 -m venv venv
    source venv/bin/activate
fi

echo ""
echo "📦 Installing/verifying dependencies..."
pip install -q -r requirements.txt

echo ""
echo "🌍 Checking Earth Engine connection..."
python3 -c "import ee; print('✓ Earth Engine module available')" 2>/dev/null || echo "⚠ Earth Engine not installed"

echo ""
echo "⚡ Starting backend with performance optimizations..."
echo "   - Caching enabled (1-hour TTL)"
echo "   - Optimized Earth Engine queries"
echo "   - Performance logging active"
echo ""
echo "📊 Server running at: http://localhost:8000"
echo "📖 API docs at:       http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Start with proper logging
python3 -m uvicorn main:app --reload --port 8000 --host 0.0.0.0
