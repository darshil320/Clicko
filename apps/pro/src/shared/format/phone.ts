/** "+919800000777" → "+91 98000 00777" (DESIGN.md: +91 followed by 10 digits). */
export function formatPhone(e164: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return match ? `+91 ${match[1]} ${match[2]}` : e164;
}
