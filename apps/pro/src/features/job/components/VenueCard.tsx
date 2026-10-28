import type { ProAssignmentDetail } from '@clickco/contracts';
import { Button, Card, Icon, Section, Text } from '@clickco/ui';
import MapPin from 'lucide-react-native/icons/map-pin';
import Navigation from 'lucide-react-native/icons/navigation';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { navigateUrl } from '../lib/bodies';
import { ErrorText } from './FlowStatus';

/**
 * The venue, straight from the API response (ADR-0024 D6: never persisted; the API hides the
 * address once the job is completed). "Navigate" hands the address to Google Maps.
 */
export function VenueCard({ venue }: { venue: ProAssignmentDetail['venue'] }) {
  const [error, setError] = useState<string | null>(null);
  const url = navigateUrl(venue);
  const place = [venue.areaName, venue.cityName, venue.pincode].filter(Boolean).join(', ');

  const navigate = () => {
    if (!url) return;
    setError(null);
    Linking.openURL(url).catch(() => setError("Couldn't open maps on this phone."));
  };

  return (
    <Section title="Venue">
      <Card className="gap-4">
        <View className="flex-row gap-3">
          <Icon icon={MapPin} />
          <View className="flex-1 gap-1">
            <Text variant="bodyStrong" selectable>
              {venue.address ?? 'The address is hidden after the shoot'}
            </Text>
            {venue.landmark ? (
              <Text variant="caption" tone="secondary">
                {venue.landmark}
              </Text>
            ) : null}
            <Text variant="caption" tone="secondary">
              {place}
            </Text>
          </View>
        </View>
        {url ? (
          <Button
            label="Navigate"
            icon={Navigation}
            variant="secondary"
            onPress={navigate}
            accessibilityHint="Opens directions in Google Maps"
            testID="navigate"
          />
        ) : null}
        <ErrorText message={error} />
      </Card>
    </Section>
  );
}
