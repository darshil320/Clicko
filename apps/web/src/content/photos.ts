import type { CategoryCode } from './rate-card';

/**
 * Licensed sample photographs (ADR-0019): Unsplash or Pexels licence, self-hosted under
 * public/photos (1600 px, metadata stripped) and credited here. The footer says they are samples;
 * the hero and the larger frames caption them so. Clickco's own shoots replace them file for file.
 */
export interface SitePhoto {
  readonly src: string;
  /** What is actually in the picture, for screen readers where the photo carries meaning. */
  readonly alt: string;
  readonly credit: { readonly photographer: string; readonly page: string };
}

const photo = (file: string, alt: string, photographer: string, page: string): SitePhoto => ({
  src: `/photos/${file}`,
  alt,
  credit: { photographer, page },
});

export const CATEGORY_PHOTOS: Readonly<Record<CategoryCode, SitePhoto>> = {
  FOOD: photo(
    'food.jpg',
    'Overhead view of a steel thali with appam, papad and small bowls of curries and chutneys on a banana leaf, resting on a stone surface.',
    'Zoshua Colah / Unsplash',
    'https://unsplash.com/photos/indian-thali-plate-with-assorted-curries-TYv-KuWYYsA',
  ),
  WEDDING: photo(
    'wedding.jpg',
    'A bride in a veil and embroidered lehenga and a groom in a cream sherwani with a flower garland face each other as rose petals fall during their wedding ceremony.',
    'Rupinder Singh / Unsplash',
    'https://unsplash.com/photos/a-man-and-a-woman-standing-next-to-each-other-M8YKi58QKrM',
  ),
  PORTRAIT: photo(
    'portrait.jpg',
    'A smiling woman in a pink silk saree with a gold necklace and jhumka earrings looks over her shoulder at the camera, with green foliage behind her.',
    'Subhrajyoti Paul / Pexels',
    'https://www.pexels.com/photo/smiling-woman-in-traditional-attire-outdoors-40407265/',
  ),
  PRODUCT: photo(
    'product.jpg',
    'A pair of gold heart-shaped earrings set with green stones and small crystals displayed on white blocks beside sprigs of dried gypsophila.',
    'Basic Productions / Unsplash',
    'https://unsplash.com/photos/elegant-earrings-with-green-stones-and-gold-trim-W3bZJ0numwE',
  ),
  EVENT: photo(
    'event.jpg',
    'A woman in a yellow lehenga with haldi paste on her face and flower jewellery dances under a pink tent with friends in yellow kurtas around her.',
    'Deepak Sharma / Pexels',
    'https://www.pexels.com/photo/vibrant-indian-wedding-dance-celebration-35328204/',
  ),
  REAL_ESTATE: photo(
    'real-estate.jpg',
    'A bright, high-ceilinged living room with a glass chandelier, wooden armchairs with patterned cushions, table lamps, sheer curtains and a black-and-white striped marble floor.',
    'Megha / Pexels',
    'https://www.pexels.com/photo/shot-of-living-room-14197309/',
  ),
  CORPORATE: photo(
    'corporate.jpg',
    'A man in a cream linen suit types on a laptop at a standing desk while a woman in a green top leans in to look at the screen in an office.',
    'Fahad Puthawala / Pexels',
    'https://www.pexels.com/photo/business-meeting-collaboration-in-ahmedabad-office-31786661/',
  ),
};

/** By city slug. Each one was taken in that city. */
export const CITY_PHOTOS: Readonly<Record<string, SitePhoto>> = {
  surat: photo(
    'surat.jpg',
    'An orange wooden ferry boat with flags moored on the Tapi River in Surat, with a road bridge and city buildings in the hazy background.',
    'VD Photography / Unsplash',
    'https://unsplash.com/photos/a-boat-floating-on-top-of-a-river-next-to-a-bridge-TQKqt6ZHfIc',
  ),
  mumbai: photo(
    'mumbai.jpg',
    'An aerial view of Marine Drive in Mumbai at dusk, its curve of street lights reflecting on the water under a purple, cloudy sky.',
    'Nishith Parikh / Unsplash',
    'https://unsplash.com/photos/a-body-of-water-with-a-city-in-the-background-nsunJX3Q9lg',
  ),
  vadodara: photo(
    'vadodara.jpg',
    'The ornate sandstone facade and domes of Laxmi Vilas Palace in Vadodara, lit by warm sunlight against a blue sky.',
    'Karan Suthar / Unsplash',
    'https://unsplash.com/photos/a-large-building-with-a-clock-on-the-front-of-it-XYT0pxF1j7o',
  ),
};

/** In HOW_IT_WORKS order: booking, the match, the shoot, delivery. */
export const STEP_PHOTOS: readonly SitePhoto[] = [
  photo(
    'step-book.jpg',
    'A smiling woman in a red-and-white checked kurta looks at her smartphone while a laughing man in a turban sits beside her holding a mug.',
    'Ketut Subiyanto / Pexels',
    'https://www.pexels.com/photo/laughing-couple-in-casual-indian-wear-using-smartphone-4307708/',
  ),
  photo(
    'step-assigned.jpg',
    'A smiling young photographer in a brown corduroy shirt stands on a tree-lined road holding a DSLR camera with a long zoom lens.',
    'Sanket Mishra / Pexels',
    'https://www.pexels.com/photo/young-indian-photographer-holding-his-professional-dslr-camera-and-clicking-pictures-15594934/',
  ),
  photo(
    'step-shoot.jpg',
    'A photographer in a black T-shirt frames a shot with a camera in a sunny garden, with a tent canopy and plastic chairs behind him.',
    'Iqbal farooz / Pexels',
    'https://www.pexels.com/photo/man-while-photographing-17115390/',
  ),
  photo(
    'step-delivery.jpg',
    'A smiling woman on a sofa looks at a laptop on her lap while a man in a turban leans over her shoulder and reaches toward the keyboard.',
    'Ketut Subiyanto / Pexels',
    'https://www.pexels.com/photo/happy-ethnic-couple-using-laptop-in-living-room-together-4308010/',
  ),
];

export const PRE_WEDDING_PHOTO = photo(
  'pre-wedding.jpg',
  'A couple in festive Indian outfits, he in a dark patterned sherwani and she in a sequinned beige lehenga with mehendi on her hand, pose cheek to cheek outdoors in golden-hour backlight.',
  'Royal Photography / Unsplash',
  'https://unsplash.com/photos/a-couple-embracing-outdoors-during-golden-hour-BaZ-QDAuooM',
);
