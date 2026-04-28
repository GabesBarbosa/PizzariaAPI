import axios from 'axios';
import logger from '../utils/logger';

/* ─── Distância de rota via OSRM público ─── */

const OSRM_BASE = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';

export interface LatLng {
  latitude: number;
  longitude: number;
}

/**
 * Retorna distância de rota em km entre origem e destino.
 * Em caso de falha da API, faz fallback para distância Haversine.
 */
export async function getDrivingDistanceKm(origin: LatLng, destination: LatLng): Promise<number> {
  const coords = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const url = `${OSRM_BASE}/route/v1/driving/${coords}`;

  try {
    const { data } = await axios.get(url, {
      params: { overview: 'false', alternatives: 'false', steps: 'false' },
      timeout: 7000,
    });
    const meters = data?.routes?.[0]?.distance;
    if (typeof meters === 'number' && meters >= 0) {
      return Math.round((meters / 1000) * 100) / 100;
    }
    throw new Error('Resposta OSRM sem distância');
  } catch (err: any) {
    logger.warn(`[Routing] OSRM falhou (${err.message}) — fallback Haversine`);
    return haversineKm(origin, destination);
  }
}

/* ─── Fallback: distância em linha reta (Haversine) ─── */

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(R * c * 100) / 100;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
