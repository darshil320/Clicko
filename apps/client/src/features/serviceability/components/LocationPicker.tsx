import { Button } from '@clickco/ui';
import MapPin from 'lucide-react-native/icons/map-pin';
import { useState } from 'react';
import { useShootLocation } from '../hooks';
import { PincodeSheet } from './PincodeSheet';

export interface LocationPickerProps {
  /** "pill" for the Home header; "change" for the configurator's location card. */
  readonly variant?: 'pill' | 'change';
}

/** The location pill: shows the saved area and opens the pincode check. */
export function LocationPicker({ variant = 'pill' }: LocationPickerProps) {
  const [open, setOpen] = useState(false);
  const location = useShootLocation();
  const label =
    variant === 'change' ? 'Change' : location.isDefault ? 'Set pincode' : location.label;

  return (
    <>
      <Button
        label={label}
        icon={variant === 'pill' ? MapPin : undefined}
        variant={variant === 'pill' ? 'secondary' : 'ghost'}
        size="compact"
        onPress={() => setOpen(true)}
        accessibilityLabel={
          location.isDefault ? 'Set your pincode' : `Location ${location.label}, change`
        }
        testID="location-pill"
      />
      <PincodeSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
