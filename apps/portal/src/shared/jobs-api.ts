import { ProUploadJob } from '@clickco/contracts';
import { z } from 'zod';
import { api } from './api';

const ProUploadJobs = z.array(ProUploadJob);

/** GET /pro/upload-jobs — shoots awaiting (or past) their upload, most urgent first. */
export const listUploadJobs = () =>
  api({ method: 'GET', path: '/pro/upload-jobs', schema: ProUploadJobs, auth: true });

/** One job by booking id (null when it is not this photographer's or no longer listed). */
export async function findUploadJob(bookingId: string): Promise<ProUploadJob | null> {
  return (await listUploadJobs()).find((j) => j.bookingId === bookingId) ?? null;
}
