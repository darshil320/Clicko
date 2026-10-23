import type { JoinWaitlistBody } from '@clickco/contracts';
import { api } from '@/shared/api';

export const checkPincode = (pincode: string) => api.serviceability.check(pincode);

export const joinWaitlist = (body: JoinWaitlistBody) => api.serviceability.joinWaitlist(body);
