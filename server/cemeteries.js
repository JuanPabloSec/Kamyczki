/**
 * Fetch cemeteries from OpenStreetMap Overpass API → GeoJSON.
 * Uses real footprints (way/relation geometry) when mode=full.
 */

const OVERPASS_URLS = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const cache = new Map();
const CACHE_TTL_MS = 20 * 60 * 1000;
const MAX_CACHE = 100;

function cacheKey(south, west, north, east, mode) {
  const r = (n) => Math.round(n * 80) / 80;
  return `${mode}:${r(south)},${r(west)},${r(north)},${r(east)}`;
}

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.geojson;
}

function setCache(key, geojson) {
  if (cache.size >= MAX_CACHE) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, { at: Date.now(), geojson });
}

function ringFromGeometry(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 3) return null;
  const ring = geometry.map((p) => [p.lon, p.lat]);
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  if (fx !== lx || fy !== ly) ring.push([fx, fy]);
  return ring.length >= 4 ? ring : null;
}

function featureFromElement(el) {
  const tags = el.tags || {};
  const name =
    tags.name || tags["name:pl"] || tags.official_name || tags.alt_name || null;
  const props = {
    id: `${el.type}/${el.id}`,
    name,
    religion: tags.religion || null,
    osmType: el.type,
    osmId: el.id,
  };

  // out center → center object on way/relation
  if (el.center && Number.isFinite(el.center.lat) && Number.isFinite(el.center.lon)) {
    return {
      type: "Feature",
      properties: { ...props, approx: true },
      geometry: {
        type: "Point",
        coordinates: [el.center.lon, el.center.lat],
      },
    };
  }

  if (el.type === "node" && Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
    return {
      type: "Feature",
      properties: props,
      geometry: { type: "Point", coordinates: [el.lon, el.lat] },
    };
  }

  if (el.type === "way" && el.geometry) {
    const ring = ringFromGeometry(el.geometry);
    if (!ring) return null;
    return {
      type: "Feature",
      properties: props,
      geometry: { type: "Polygon", coordinates: [ring] },
    };
  }

  if (el.type === "relation" && Array.isArray(el.members)) {
    const outers = [];
    const inners = [];
    for (const m of el.members) {
      if (!m.geometry) continue;
      const ring = ringFromGeometry(m.geometry);
      if (!ring) continue;
      if (m.role === "inner") inners.push(ring);
      else outers.push(ring);
    }
    if (!outers.length) return null;
    const polygons = outers.map((outer, i) =>
      i === 0 && inners.length ? [outer, ...inners] : [outer]
    );
    return {
      type: "Feature",
      properties: props,
      geometry:
        polygons.length === 1
          ? { type: "Polygon", coordinates: polygons[0] }
          : { type: "MultiPolygon", coordinates: polygons },
    };
  }

  return null;
}

function elementsToGeoJSON(elements) {
  const features = [];
  const seen = new Set();
  for (const el of elements || []) {
    if (!el.tags) continue;
    const isCemetery =
      el.tags.landuse === "cemetery" || el.tags.amenity === "grave_yard";
    if (!isCemetery) continue;
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    const f = featureFromElement(el);
    if (!f) continue;
    seen.add(key);
    features.push(f);
  }
  return { type: "FeatureCollection", features };
}

function buildQuery(south, west, north, east, mode) {
  const pad = mode === "full" ? 0.0015 : 0.01;
  const s = south - pad;
  const w = west - pad;
  const n = north + pad;
  const e = east + pad;
  const out = mode === "full" ? "out geom;" : "out center;";
  // ways + relations for shapes; nodes only as fallback points
  return `
[out:json][timeout:50];
(
  way["landuse"="cemetery"](${s},${w},${n},${e});
  relation["landuse"="cemetery"](${s},${w},${n},${e});
  way["amenity"="grave_yard"](${s},${w},${n},${e});
  relation["amenity"="grave_yard"](${s},${w},${n},${e});
  node["landuse"="cemetery"](${s},${w},${n},${e});
  node["amenity"="grave_yard"](${s},${w},${n},${e});
);
${out}
`.trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchOverpass(query) {
  let lastErr;
  for (let i = 0; i < OVERPASS_URLS.length; i++) {
    const url = OVERPASS_URLS[i];
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 55000);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Accept: "application/json",
          "User-Agent": "KamyczkiApp/1.0 (cemetery layer; educational hobby map)",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429 || res.status === 504 || res.status === 502) {
        lastErr = new Error(`Overpass ${res.status} (${url})`);
        await sleep(800 + i * 600);
        continue;
      }
      if (!res.ok) {
        lastErr = new Error(`Overpass ${res.status}`);
        continue;
      }
      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        lastErr = new Error("Overpass zwrócił nieprawidłowy JSON");
        continue;
      }
    } catch (err) {
      lastErr = err.name === "AbortError" ? new Error("Overpass timeout") : err;
      await sleep(400);
    }
  }
  throw lastErr || new Error("Overpass niedostępny");
}

/**
 * @param {{south:number,west:number,north:number,east:number,mode?:'full'|'points'}} bbox
 */
async function getCemeteriesGeoJSON(bbox) {
  const { south, west, north, east } = bbox;
  const mode = bbox.mode === "points" ? "points" : "full";

  if (
    ![south, west, north, east].every(Number.isFinite) ||
    south >= north ||
    west >= east
  ) {
    const err = new Error("Nieprawidłowy zakres mapy (bbox).");
    err.status = 400;
    throw err;
  }

  const area = (north - south) * (east - west);
  const maxArea = mode === "full" ? 2.5 : 12;
  if (area > maxArea) {
    const err = new Error(
      "Obszar jest za duży. Przybliż mapę, aby wczytać cmentarze."
    );
    err.status = 400;
    throw err;
  }

  const key = cacheKey(south, west, north, east, mode);
  const cached = getCached(key);
  if (cached) {
    return { geojson: cached, cached: true, count: cached.features.length, mode };
  }

  const data = await fetchOverpass(buildQuery(south, west, north, east, mode));
  const geojson = elementsToGeoJSON(data.elements || []);
  setCache(key, geojson);
  return { geojson, cached: false, count: geojson.features.length, mode };
}

module.exports = { getCemeteriesGeoJSON };
