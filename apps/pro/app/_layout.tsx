import '../global.css';
import { FONT_FACES, fontFaceFor, palette } from '@clickco/ui';
// Per-weight subpaths: the package index requires all 18 faces, which Metro would bundle.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { InterTight_600SemiBold } from '@expo-google-fonts/inter-tight/600SemiBold';
import { InterTight_700Bold } from '@expo-google-fonts/inter-tight/700Bold';
import { focusManager, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { onOnsiteSettled } from '@/shared/offline/runner';
import { useQueueRunner } from '@/shared/offline/use-queue-runner';
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

/** White theme (ADR-0017). `primary` tints navigator controls, so it is ink — never amber text. */
const navigationTheme = {
  ...DefaultTheme,
  dark: false,
  colors: {
    ...DefaultTheme.colors,
    primary: palette.text.primary,
    background: palette.surface.base,
    card: palette.surface.base,
    text: palette.text.primary,
    border: palette.border.subtle,
    notification: palette.accent.default,
  },
};

const screenOptions = {
  headerStyle: { backgroundColor: palette.surface.base },
  headerTintColor: palette.text.primary,
  headerTitleStyle: { fontFamily: fontFaceFor('h3') },
  headerShadowVisible: false,
  headerBackButtonDisplayMode: 'minimal' as const,
  contentStyle: { backgroundColor: palette.surface.base },
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

type QueryClientT = ReturnType<typeof createQueryClient>;

/** Sign-out and expiry leave nothing behind: venue addresses live only in this cache (ADR-0024 D6). */
function useSessionEndResets(queryClient: QueryClientT): void {
  useEffect(() => onSessionEnd(() => queryClient.clear()), [queryClient]);
}

/** Whenever an on-site action reaches the server (now or from the queue), refresh what shows it. */
function useRefreshOnSync(queryClient: QueryClientT): void {
  useEffect(() => onOnsiteSettled(() => void queryClient.invalidateQueries()), [queryClient]);
}

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  useSessionEndResets(queryClient);
  useRefreshOnSync(queryClient);
  useEffect(syncSessionAcrossTabs, []);
  useQueueRunner();
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  const signedIn = useIsSignedIn();
  useAppFocus();

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={navigationTheme}>
          <StatusBar style="dark" />
          <Stack screenOptions={screenOptions}>
            <Stack.Protected guard={signedIn}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Jobs' }} />
              <Stack.Screen name="offers/[attemptId]" options={{ title: 'New job' }} />
              <Stack.Screen name="jobs/[assignmentId]" options={{ title: 'Job' }} />
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
