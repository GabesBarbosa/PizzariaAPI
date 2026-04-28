import {
  getBusinessOrigin,
  getDeliveryZones,
  type BusinessOrigin,
  type DeliveryZone,
} from '../repositories/settings.repository';
import { getDrivingDistanceKm, type LatLng } from './routing.service';
import { geocodeAddress, lookupCep, type GeocodeInput } from './geocoding.service';

export interface ShippingRequest {
  cep: string;
  number?: string;
  street?: string;
  neighborhood?: string;
  city?: string;
  uf?: string;
}

export interface ShippingQuote {
  distanceKm: number;
  fee: number;
  destination: LatLng;
  origin: LatLng;
  zone: DeliveryZone | null;
  outOfRange: boolean;
}

/**
 * Dada uma localização do cliente (via CEP + número), calcula a taxa de entrega
 * baseado na origem cadastrada do estabelecimento e nas faixas configuradas.
 */
export async function quoteShipping(req: ShippingRequest): Promise<ShippingQuote> {
  const origin = await getBusinessOrigin();
  if (!origin) {
    throw new Error('Origem do estabelecimento não configurada. Peça ao administrador para cadastrar o endereço da loja.');
  }

  const zones = await getDeliveryZones();

  const cepInfo = await lookupCep(req.cep);
  const address: GeocodeInput = {
    cep: req.cep,
    street:       req.street       || cepInfo?.street       || '',
    number:       req.number,
    neighborhood: req.neighborhood || cepInfo?.neighborhood || '',
    city:         req.city         || cepInfo?.city         || '',
    uf:           req.uf           || cepInfo?.uf           || '',
  };

  if (!address.street || !address.city || !address.uf) {
    throw new Error('Endereço incompleto: CEP não localizado.');
  }

  const destination = await geocodeAddress(address);
  if (!destination) {
    throw new Error('Não foi possível localizar o endereço no mapa.');
  }

  const distanceKm = await getDrivingDistanceKm(
    { latitude: origin.latitude, longitude: origin.longitude },
    destination,
  );

  const zone = findZone(zones, distanceKm);

  return {
    distanceKm,
    fee: zone?.fee ?? 0,
    destination,
    origin: { latitude: origin.latitude, longitude: origin.longitude },
    zone,
    outOfRange: zone === null,
  };
}

function findZone(zones: DeliveryZone[], km: number): DeliveryZone | null {
  for (const z of zones) {
    if (km >= z.minKm && km < z.maxKm) return z;
  }
  // Permite zona que vai até Infinity (representada por maxKm muito grande)
  const last = zones[zones.length - 1];
  if (last && km >= last.minKm && last.maxKm === Infinity) return last;
  return null;
}

export type { BusinessOrigin };
