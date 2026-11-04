/**
 * MSG91 Flow API (POST /api/v5/flow) responses as recorded from MSG91's documented examples, shared
 * by the OTP SMS and the lifecycle SMS tests. Numbers are fakes; the request id keeps MSG91's shape.
 * MSG91 answers HTTP 200 with `type: "error"` for a request it rejects after authenticating.
 */
export const MSG91_FIXTURES = {
  sent: { status: 200, body: { message: '3763646c3058373530393831', type: 'success' } },
  rejected: {
    status: 200,
    body: { message: 'Invalid mobile number 919812345678', type: 'error' },
  },
  unauthorised: { status: 401, body: { message: 'Authentication failure', type: 'error' } },
  templateInvalid: {
    status: 400,
    body: { message: 'Template ID Missing or Invalid Template', type: 'error' },
  },
  rateLimited: { status: 429, body: { message: 'Too Many Requests', type: 'error' } },
  outage: { status: 503, raw: 'Service Unavailable' },
  badGateway: { status: 502, raw: '<html><body>502 Bad Gateway</body></html>' },
} as const;
