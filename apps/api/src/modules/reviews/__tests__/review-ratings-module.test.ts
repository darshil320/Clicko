import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { ReviewRatingsModule } from '../review-ratings.module';
import { ReviewRatings } from '../review-ratings.reader';

describe('ReviewRatingsModule (ADR-0027 D4)', () => {
  it('gives other modules the rating reader only — nothing that can write reviews', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, ReviewRatingsModule)).toEqual([
      ReviewRatings,
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ReviewRatingsModule)).toEqual([
      ReviewRatings,
    ]);
  });
});
