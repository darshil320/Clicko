import { Alert, Linking } from 'react-native';
import { LEGAL_URLS, type LegalPage } from './legal-urls';

export { LEGAL_URLS, type LegalPage };

/** Opens a legal page in the browser; says so plainly if the device cannot. */
export function openLegal(page: LegalPage): void {
  const url = LEGAL_URLS[page];
  Linking.openURL(url).catch(() => {
    Alert.alert("Couldn't open the page", `Visit ${url} in your browser.`);
  });
}
