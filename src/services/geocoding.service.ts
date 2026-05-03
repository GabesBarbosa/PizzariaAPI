import axios from 'axios';
import logger from '../utils/logger';

/* ─── Tipos ─── */

export interface ViaCepResult {
  cep: string;
  street: string;
  neighborhood: string;
  city: string;
  uf: string;
}

export interface GeocodeInput {
  street: string;
  number?: string;
  neighborhood?: string;
  city: string;
  uf: string;
  cep?: string;
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

/* ─── ViaCEP ─── */

export async function lookupCep(rawCep: string): Promise<ViaCepResult | null> {
  const cep = rawCep.replace(/\D/g, '');
  if (cep.length !== 8) return null;

  try {
    const { data } = await axios.get(`https://viacep.com.br/ws/${cep}/json/`, { timeout: 5000 });
    if (data.erro) return null;
    return {
      cep: data.cep,
      street: data.logradouro || '',
      neighborhood: data.bairro || '',
      city: data.localidade || '',
      uf: data.uf || '',
    };
  } catch (err: any) {
    logger.warn(`[Geocoding] ViaCEP falhou para ${cep}: ${err.message}`);
    return null;
  }
}

/* ─── Nominatim (OpenStreetMap) ─── */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = process.env.NOMINATIM_USER_AGENT || 'PizzariaSPA/1.0 (contato@pizzaria.local)';

export async function geocodeAddress(input: GeocodeInput): Promise<GeocodeResult | null> {
  const attempts = [
    // 1. Endereço completo com número
    [input.street && input.number ? `${input.street}, ${input.number}` : input.street, input.neighborhood, input.city, input.uf, 'Brasil'],
    // 2. Sem número (Nominatim frequentemente não tem numeração)
    [input.street, input.neighborhood, input.city, input.uf, 'Brasil'],
    // 3. Só CEP + cidade
    [input.cep, input.city, input.uf, 'Brasil'],
    // 4. Só cidade + UF
    [input.city, input.uf, 'Brasil'],
  ];

  for (const parts of attempts) {
    const query = parts.filter(Boolean).join(', ');
    if (!query) continue;

    try {
      const { data } = await axios.get(NOMINATIM_URL, {
        params: { q: query, format: 'json', limit: 1, countrycodes: 'br' },
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pt-BR' },
        timeout: 7000,
      });

      if (Array.isArray(data) && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
          if (parts !== attempts[0]) {
            logger.info(`[Geocoding] Resolvido com fallback: "${query}"`);
          }
          return { latitude: lat, longitude: lon };
        }
      }
    } catch (err: any) {
      logger.warn(`[Geocoding] Nominatim falhou para "${query}": ${err.message}`);
    }
  }

  return null;
}
