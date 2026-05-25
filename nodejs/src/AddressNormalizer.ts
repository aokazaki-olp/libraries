import { normalize as njaNormalize } from '@geolonia/normalize-japanese-addresses';
import { createHash } from 'node:crypto';

type AddressPoint = {
  lat: number;
  lng: number;
  level: number;
};

export type AddressNormalizeResult = {
  original: string;
  hash: string;
  pref: string;
  city: string;
  town: string;
  addr: string;
  other: string;
  level: number;
  point: AddressPoint | null;
};

const sha256 = (input: string): string =>
  createHash('sha256').update(input).digest('hex');

const normalizeAddress = async (address: string): Promise<AddressNormalizeResult> => {
  if (typeof address !== 'string' || address.trim() === '') {
    throw new TypeError('address には空でない文字列を指定してください');
  }
  const trimmed = address.trim();
  const result = await njaNormalize(trimmed);

  return {
    original: trimmed,
    hash: sha256(trimmed),
    pref: result.pref ?? '',
    city: result.city ?? '',
    town: result.town ?? '',
    addr: result.addr ?? '',
    other: result.other,
    level: result.level,
    point: result.point ?? null,
  };
};

export const AddressNormalizer = { normalize: normalizeAddress };
