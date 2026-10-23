import '../global.css';
import { color } from '@clickco/design-tokens';
import { FONT_FACES, fontFaceFor } from '@clickco/ui';
// Per-weight subpaths: the package index requires all 18 faces, which Metro would bundle.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { InterTight_600SemiBold } from '@expo-google-fonts/inter-tight/600SemiBold';
import { InterTight_700Bold } from '@expo-google-fonts/inter-tight/700Bold';
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { clearBookingDraft } from '@/features/booking';
import { createQueryClient } from '@/shared/query';
import { onSessionEnd } from '@/shared/session/reset';
import { useIsSignedIn } from '@/shared/session/store';
import { syncSessionAcrossTabs } from '@/shared/session/sync';

/** One file per face the primitives request (packages/ui FONT_FACES). */
const FONT_FILES: Readonly<Record<string, number>> = {
  'Inter-Regular': Inter_400Regular,
  'Inter-Medium': Inter_500Medium,
  'Inter-SemiBold': Inter_600SemiBold,
  'InterTight-SemiBold': InterTight_600SemiBold,
  'InterTight-Bold': InterTight_700Bold,
};
const missingFaces = FONT_FACES.filter((face) => !(face in FONT_FILES));
if (missingFaces.length > 0) throw new Error(`Font files missing for: ${missingFaces.join(', ')}`);

const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: color.accent.default,
    background: color.surface.base,
    card: color.surface.base,
    text: color.text.primary,
    border: color.border.subtle,
  },
};

const screenOptions = {
  headerStyle: { backgroundColor: color.surface.base },
  headerTintColor: color.text.primary,
  headerTitleStyle: { fontFamily: fontFaceFor('h3') },
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal' as const,
  contentStyle: { backgroundColor: color.surface.base },
};

function useAppFocus(): void {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (state) =>
      focusManager.setFocused(state === 'active'),
    );
    return () => sub.remove();
  }, []);
}

/** Sign-out and session expiry leave nothing behind for the next person on the device. */
function useSessionEndResets(queryClient: ReturnType<typeof createQueryClient>): void {
  useEffect(
    () =>
      onSessionEnd(() => {
        clearBookingDraft();
        queryClient.clear();
      }),
    [queryClient],
  );
}

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  useSessionEndResets(queryClient);
  useEffect(syncSessionAcrossTabs, []);
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  const signedIn = useIsSignedIn();
  useAppFocus();

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={navigationTheme}>
          <StatusBar style="light" />
          <Stack screenOptions={screenOptions}>
            <Stack.Protected guard={signedIn}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="plan/[tier]" options={{ title: 'Plan' }} />
              <Stack.Screen name="book/configure" options={{ title: 'Your shoot' }} />
              <Stack.Screen name="book/review" options={{ title: 'Review' }} />
              <Stack.Screen name="book/pay/[id]" options={{ title: 'Payment' }} />
              <Stack.Screen
                name="book/confirmed/[id]"
                options={{ headerShown: false, gestureEnabled: false }}
              />
              <Stack.Screen name="bookings/[id]" options={{ title: 'Booking' }} />
            </Stack.Protected>
            <Stack.Protected guard={!signedIn}>
              <Stack.Screen name="sign-in" options={{ headerShown: false }} />
            </Stack.Protected>
          </Stack>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
