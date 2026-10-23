import { useMutation, useQuery } from '@tanstack/react-query';
import { DEFAULT_CITY_NAME, DEFAULT_PINCODE } from '@/shared/config';
import { checkPincode, joinWaitlist } from './api';
import { useLocation } from './store';

const SERVICEABILITY_STALE_MS = 10 * 60_000;

export function useServiceability(pincode: string | null) {
  return useQuery({
    queryKey: ['serviceability', pincode],
    queryFn: () => checkPincode(pincode as string),
    enabled: pincode !== null,
    staleTime: SERVICEABILITY_STALE_MS,
  });
}

export function useJoinWaitlist() {
  return useMutation({ mutationFn: joinWaitlist });
}

export interface ShootLocation {
  /** The pincode prices and bookings use: the client's own, else the Surat default. */
  readonly pincode: string;
  readonly label: string;
  readonly isDefault: boolean;
}

export function useShootLocation(): ShootLocation {
  const { pincode, label } = useLocation();
  return pincode && label
    ? { pincode, label, isDefault: false }
    : { pincode: DEFAULT_PINCODE, label: DEFAULT_CITY_NAME, isDefault: true };
}
