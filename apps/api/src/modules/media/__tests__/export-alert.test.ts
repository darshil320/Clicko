import { describe, expect, it, vi } from 'vitest';
import { JpegExportService } from '../jpeg-export.service';
import type { MediaAssetRecord, UploadBookingFacts } from '../media.types';

const BOOKING = '11111111-1111-4111-8111-111111111111';
const RAW = { id: 'raw-1', bookingId: BOOKING, originalFilename: 'IMG_1.CR3' } as MediaAssetRecord;

/** The export's failure alert, with the booking's status at the time of the failure. */
function setup(statusAtFailure: string) {
  const begin = vi.fn(async () => undefined);
  const facts = { bookingId: BOOKING, status: statusAtFailure } as UploadBookingFacts;
  const service = new JpegExportService(
    { begin } as never,
    () => new Date('2026-12-07T04:30:00Z'),
    {} as never,
    {} as never,
    {} as never,
    { one: async () => facts } as never,
    {} as never,
  );
  const alert = (
    service as unknown as {
      alertFailure(b: string, r: MediaAssetRecord, e: unknown): Promise<void>;
    }
  ).alertFailure.bind(service);
  return { begin, alert };
}

describe('JPEG export failure alerts', () => {
  it('raise a HIGH alert while the booking is still being processed', async () => {
    const { begin, alert } = setup('PROCESSING');
    await alert(BOOKING, RAW, new Error('darktable crashed'));
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('stay quiet when the booking left PROCESSING (a lost shoot purged the RAW mid-export)', async () => {
    const { begin, alert } = setup('DATA_LOSS');
    await alert(BOOKING, RAW, new Error('object not found'));
    expect(begin).not.toHaveBeenCalled();
  });
});
