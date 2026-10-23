/**
 * One short, specific paragraph per city × category page, so the 21 programmatic pages each say
 * something true and local instead of swapping a city name into a template.
 * Key: `${citySlug}/${categorySlug}`. content.test.ts fails if any combination is missing.
 */
export const LOCAL_ANGLES: Readonly<Record<string, string>> = {
  'surat/food':
    'From farsan counters in Varachha to the cafés opening along VIP Road in Vesu, Surat eats out ' +
    'and orders in constantly. If the shoot is for delivery-app listings or a menu reprint, say ' +
    'so when you book — square crops and overhead angles need planning before the first dish.',
  'surat/wedding':
    'Surat weddings often spread across a farmhouse on Dumas Road, a banquet hall in Adajan or ' +
    'Vesu, and a separate reception night. Wedding season and Navratri are both Peak Season here, ' +
    'so book early and book each function separately.',
  'surat/portrait':
    'Golden hour at Dumas beach, the Tapi riverfront and Gopi Talav are favourite outdoor spots, ' +
    'and many families prefer a relaxed shoot at home. Tell us the location so we can plan around ' +
    'light, crowds and any permission the spot needs.',
  'surat/product':
    'Surat runs on catalogues: sarees and dress material from the Ring Road textile markets, and ' +
    'jewellery for online stores. For large catalogues, Professional keeps the light identical ' +
    'from the first SKU to the last.',
  'surat/event':
    'From Navratri garba nights to store launches and housewarming pujas, Surat’s calendar is ' +
    'full. Navratri dates carry festival pricing and Peak Season terms here, so confirm early ' +
    'for anything in that week.',
  'surat/real-estate':
    'New towers in Vesu, Pal and Althan often sell before they are finished, so show flats and ' +
    'sample interiors do the selling. We shoot those, resale homes and commercial floors for ' +
    'builders and brokers.',
  'surat/corporate':
    'Textile traders, diamond firms and the newer offices near the Surat Diamond Bourse all need ' +
    'consistent team headshots and workplace photos. Book a meeting room as a studio and we ' +
    'photograph the whole team in one visit.',
  'mumbai/food':
    'Restaurants in Bandra, Lower Parel and Colaba compete on delivery apps as much as on ' +
    'footfall, and menus change often. Book a weekday morning before service starts to get the ' +
    'kitchen’s full attention.',
  'mumbai/wedding':
    'Mumbai weddings run to strict venue slots at hotels and banquet halls, often with a hard stop. ' +
    'Book a buffer hour: extensions need your approval in the app and depend on the venue letting ' +
    'the shoot run on.',
  'mumbai/portrait':
    'Marine Drive at dawn, Bandstand at sunset and the old façades of Fort are classic Mumbai ' +
    'backdrops. Some public spots need permission for professional gear, so share the location ' +
    'when you book and we plan around it.',
  'mumbai/product':
    'Mumbai’s D2C brands shoot constantly for websites and marketplaces, often from small studios ' +
    'and home offices in Andheri and Lower Parel. Group your products by size and colour and a ' +
    '2-hour slot covers far more.',
  'mumbai/event':
    'Launch nights, college fests, society functions and Ganesh Chaturthi gatherings keep Mumbai ' +
    'busy year-round. Ganesh Chaturthi dates carry festival pricing in Mumbai, shown before you ' +
    'pay.',
  'mumbai/real-estate':
    'In Mumbai, listings live or die on how spacious a 1BHK looks. Wide lenses and bracketed ' +
    'exposures keep rooms honest but bright, with the view through the window still visible.',
  'mumbai/corporate':
    'From BKC to Lower Parel and Powai, book team headshots, offsite coverage and leadership ' +
    'portraits for your office. Tell us about building security in advance — waiting on a gate ' +
    'pass can eat into your booked hours.',
  'vadodara/food':
    'Vadodara’s food scene runs from sev usal and farsan shops to cafés in Alkapuri and ' +
    'Sayajigunj. We are in pilot here, so book a few days ahead for menu and listing shoots.',
  'vadodara/wedding':
    'Wedding season in Vadodara opens soon after Navratri and Diwali, when demand for ' +
    'photographers is at its peak. With pilot-stage availability, book as early as you can and ' +
    'book each function as its own shoot.',
  'vadodara/portrait':
    'Sayaji Baug, the lakeside at Sursagar and the city’s palace-era architecture make striking ' +
    'backdrops where photography is permitted. Home shoots work well for families and newborns.',
  'vadodara/product':
    'Manufacturers around Makarpura and the city’s industrial estates need clean product and ' +
    'packaging shots for catalogues and trade fairs. Professional adds lighting for metal, glass ' +
    'and other reflective surfaces.',
  'vadodara/event':
    'Vadodara’s Navratri is one of Gujarat’s biggest, with garba grounds busy every night. ' +
    'Festival pricing and Peak Season terms apply to those dates — and in pilot, booking early ' +
    'matters even more.',
  'vadodara/real-estate':
    'Gotri, Vasna-Bhayli and Sevasi are growing fast, with new projects and show flats to market. ' +
    'Daylight shoots with every light on give buyers an honest, bright view of each room.',
  'vadodara/corporate':
    'Engineering, pharma and chemicals firms around Vadodara book headshots and plant photography ' +
    'for websites and tenders. Share safety rules for factory floors in advance so the ' +
    'photographer comes prepared.',
};

export function localAngle(citySlug: string, categorySlug: string): string | undefined {
  return LOCAL_ANGLES[`${citySlug}/${categorySlug}`];
}
