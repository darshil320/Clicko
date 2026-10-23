import { create } from 'zustand';

/** The in-progress sign-in (phone → code). Ephemeral: never persisted. */
interface SignInFlowState {
  readonly phone: string | null;
  readonly challengeId: string | null;
  /** Epoch ms when "Resend code" unlocks. */
  readonly resendAt: number | null;
  challengeSent(input: { phone: string; challengeId: string; resendAfterSeconds: number }): void;
  reset(): void;
}

const EMPTY = { phone: null, challengeId: null, resendAt: null } as const;

export const useSignInFlow = create<SignInFlowState>()((set) => ({
  ...EMPTY,
  challengeSent: ({ phone, challengeId, resendAfterSeconds }) =>
    set({ phone, challengeId, resendAt: Date.now() + resendAfterSeconds * 1000 }),
  reset: () => set(EMPTY),
}));
