"""
Performance Testing Script for Canopy AI Backend
Tests cache hits and measures response times
"""

import requests
import time
import json

BASE_URL = "http://localhost:8000"

def test_analyze(lat, lng, year, radius_km, label=""):
    """Test analyze endpoint and measure response time"""
    payload = {
        "lat": lat,
        "lng": lng,
        "year": year,
        "radius_km": radius_km
    }
    
    print(f"\n📊 Testing Analyze {label}")
    print(f"   Location: {lat}°N, {lng}°E | Year: {year} | Radius: {radius_km}km")
    
    start = time.time()
    try:
        response = requests.post(f"{BASE_URL}/analyze", json=payload)
        elapsed = time.time() - start
        
        if response.status_code == 200:
            print(f"   ✓ Status: 200 | Time: {elapsed:.2f}s")
            data = response.json()
            print(f"   ├─ Healthy: {data['stats']['healthy_pct']}%")
            print(f"   ├─ At Risk: {data['stats']['at_risk_pct']}%")
            print(f"   ├─ Alert: {data['alert']['level']} ({data['alert']['score']}/100)")
            print(f"   └─ NDVI: {data['ndvi_mean']}")
            return elapsed
        else:
            print(f"   ✗ Status: {response.status_code}")
            print(f"   Error: {response.text}")
            return None
    except Exception as e:
        print(f"   ✗ Error: {e}")
        return None

def test_compare(lat, lng, year_a, year_b, radius_km, label=""):
    """Test compare endpoint and measure response time"""
    payload = {
        "lat": lat,
        "lng": lng,
        "year_a": year_a,
        "year_b": year_b,
        "radius_km": radius_km
    }
    
    print(f"\n📊 Testing Compare {label}")
    print(f"   Location: {lat}°N, {lng}°E | Years: {year_a} → {year_b} | Radius: {radius_km}km")
    
    start = time.time()
    try:
        response = requests.post(f"{BASE_URL}/compare", json=payload)
        elapsed = time.time() - start
        
        if response.status_code == 200:
            print(f"   ✓ Status: 200 | Time: {elapsed:.2f}s")
            data = response.json()
            print(f"   ├─ Forest Lost: {data['forest_lost_pct']}% ({data['forest_lost_ha']}ha)")
            print(f"   ├─ Alert: {data['alert']['level']} ({data['alert']['score']}/100)")
            print(f"   └─ {data['change_summary'][:60]}...")
            return elapsed
        else:
            print(f"   ✗ Status: {response.status_code}")
            return None
    except Exception as e:
        print(f"   ✗ Error: {e}")
        return None

def test_tiles(lat, lng, year_a, year_b, radius_km, label=""):
    """Test tiles endpoint and measure response time"""
    payload = {
        "lat": lat,
        "lng": lng,
        "year_a": year_a,
        "year_b": year_b,
        "radius_km": radius_km
    }
    
    print(f"\n📊 Testing Tiles {label}")
    print(f"   Location: {lat}°N, {lng}°E | Years: {year_a} → {year_b}")
    
    start = time.time()
    try:
        response = requests.post(f"{BASE_URL}/tiles", json=payload)
        elapsed = time.time() - start
        
        if response.status_code == 200:
            print(f"   ✓ Status: 200 | Time: {elapsed:.2f}s")
            data = response.json()
            print(f"   ├─ NDVI URL: {data['ndvi'][:50]}...")
            print(f"   ├─ Change URL: {data['change'][:50]}...")
            print(f"   ├─ Risk URL: {data['risk'][:50]}...")
            print(f"   └─ Years: {data['year_a']} → {data['year_b']}")
            return elapsed
        else:
            print(f"   ✗ Status: {response.status_code}")
            return None
    except Exception as e:
        print(f"   ✗ Error: {e}")
        return None

def main():
    """Run performance tests"""
    print("\n" + "="*60)
    print("Canopy AI Backend Performance Tests")
    print("="*60)
    
    # Test data - Uganda forest locations
    forests = {
        "Mabira": {"lat": 0.45, "lng": 32.95},
        "Budongo": {"lat": 1.73, "lng": 31.55},
        "Kibale": {"lat": 0.50, "lng": 30.36},
    }
    
    times = {
        "analyze": [],
        "compare": [],
        "tiles": []
    }
    
    print("\n🔥 CACHE WARMING - First requests (will be slower)")
    print("-" * 60)
    
    for name, coords in forests.items():
        t = test_analyze(coords["lat"], coords["lng"], 2024, 5, f"- {name} (warm)")
        if t: times["analyze"].append(t)
    
    print("\n✅ CACHE TEST - Repeat requests (should be instant)")
    print("-" * 60)
    
    for name, coords in forests.items():
        t = test_analyze(coords["lat"], coords["lng"], 2024, 5, f"- {name} (cached)")
        if t: times["analyze"].append(t)
    
    print("\n📊 COMPARE TEST - Year-over-year analysis")
    print("-" * 60)
    
    for name, coords in forests.items():
        t = test_compare(coords["lat"], coords["lng"], 2020, 2024, 5, f"- {name}")
        if t: times["compare"].append(t)
    
    print("\n🗺️ TILES TEST - Map layer generation")
    print("-" * 60)
    
    for name, coords in forests.items():
        t = test_tiles(coords["lat"], coords["lng"], 2020, 2024, 5, f"- {name}")
        if t: times["tiles"].append(t)
    
    # Summary
    print("\n" + "="*60)
    print("📈 Performance Summary")
    print("="*60)
    
    if times["analyze"]:
        avg_analyze = sum(times["analyze"]) / len(times["analyze"])
        first_analyze = times["analyze"][0]
        cached_analyze = times["analyze"][-1] if len(times["analyze"]) > 1 else None
        print(f"\n📊 Analyze Requests:")
        print(f"   First request: {first_analyze:.2f}s")
        if cached_analyze:
            print(f"   Cached request: {cached_analyze:.2f}s (Speedup: {first_analyze/max(cached_analyze, 0.01):.0f}x)")
        print(f"   Average: {avg_analyze:.2f}s")
    
    if times["compare"]:
        avg_compare = sum(times["compare"]) / len(times["compare"])
        print(f"\n📊 Compare Requests:")
        print(f"   Average: {avg_compare:.2f}s")
    
    if times["tiles"]:
        avg_tiles = sum(times["tiles"]) / len(times["tiles"])
        print(f"\n📊 Tiles Requests:")
        print(f"   Average: {avg_tiles:.2f}s")
    
    print("\n✅ Performance tests complete!")
    print("="*60 + "\n")

if __name__ == "__main__":
    try:
        # Check if backend is running
        response = requests.get(f"{BASE_URL}/health", timeout=2)
        if response.status_code == 200:
            main()
        else:
            print("❌ Backend not responding with healthy status")
    except requests.exceptions.ConnectionError:
        print("❌ Cannot connect to backend at " + BASE_URL)
        print("   Make sure the backend is running:")
        print("   cd forestwatch-backend && python -m uvicorn main:app --reload --port 8000")
    except Exception as e:
        print(f"❌ Error: {e}")
